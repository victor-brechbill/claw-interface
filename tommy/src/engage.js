#!/usr/bin/env node

/**
 * Tommy Engage — Phase 3: Execute engagement based on agent scores
 * 
 * Reads a scores JSON file (from Tommy agent's direct scoring),
 * then likes, follows, saves finds to MongoDB, and optionally quote-RTs.
 * 
 * Usage: node src/engage.js <scores-file> <collected-file> [--quote-rt "text" --quote-rt-post-id "id"]
 * 
 * scores-file: JSON array of {i, score, reason}
 * collected-file: JSON output from collect.js
 */

const fs = require('fs');
const config = require('./config');
const { initSession } = require('./session-helper');

async function engage() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: node src/engage.js <scores-file> <collected-file> [--quote-rt "text" --quote-rt-post-id "id"]');
    process.exit(1);
  }

  const scoresFile = args[0];
  const collectedFile = args[1];

  // Parse optional quote-RT args (single or batch)
  let quoteRts = []; // Array of {text, postId}
  const qrtsFileIdx = args.indexOf('--quote-rts-file');
  if (qrtsFileIdx !== -1 && args[qrtsFileIdx + 1]) {
    try {
      quoteRts = JSON.parse(fs.readFileSync(args[qrtsFileIdx + 1], 'utf8'));
      if (!Array.isArray(quoteRts)) quoteRts = [quoteRts];
    } catch (e) {
      console.error(`⚠️ Failed to read quote-RTs file: ${e.message}`);
    }
  }
  // Legacy single quote-RT args
  const qrtIdx = args.indexOf('--quote-rt');
  const qrtIdIdx = args.indexOf('--quote-rt-post-id');
  if (qrtIdx !== -1 && args[qrtIdx + 1] && qrtIdIdx !== -1 && args[qrtIdIdx + 1]) {
    quoteRts.push({ text: args[qrtIdx + 1], postId: args[qrtIdIdx + 1] });
  }

  // Load files
  let scores, collected;
  try {
    scores = JSON.parse(fs.readFileSync(scoresFile, 'utf8'));
    collected = JSON.parse(fs.readFileSync(collectedFile, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to read input files: ${err.message}`);
    process.exit(1);
  }

  const sessionId = collected.sessionId;
  const sessionType = collected.sessionType || 'explore';
  const posts = collected.posts || [];

  const { xClient, database, runtimeConfig } = await initSession();
  xClient.currentSessionId = sessionId;

  try {
    let maxQuoteRTsPerDay = config.POSTING_CONFIG.MAX_QUOTE_RTS_PER_DAY;
    let maxWords = config.POSTING_CONFIG.MAX_WORDS;
    let postingEnabled = config.POSTING_CONFIG.ENABLED;

    if (runtimeConfig?.ai) {
      if (runtimeConfig.ai.minScoreToLike != null) config.AI_CONFIG.MIN_SCORE_TO_LIKE = runtimeConfig.ai.minScoreToLike;
      if (runtimeConfig.ai.minScoreToFollow != null) config.AI_CONFIG.MIN_SCORE_TO_FOLLOW = runtimeConfig.ai.minScoreToFollow;
      if (runtimeConfig.ai.minScoreToPost != null) config.AI_CONFIG.MIN_SCORE_TO_POST = runtimeConfig.ai.minScoreToPost;
      if (runtimeConfig.ai.minScoreToSave != null) config.AI_CONFIG.MIN_SCORE_TO_SAVE = runtimeConfig.ai.minScoreToSave;
    }
    if (runtimeConfig?.posting) {
      if (runtimeConfig.posting.enabled != null) postingEnabled = runtimeConfig.posting.enabled;
      if (runtimeConfig.posting.maxQuoteRTsPerDay != null) maxQuoteRTsPerDay = runtimeConfig.posting.maxQuoteRTsPerDay;
      if (runtimeConfig.posting.maxWords != null) maxWords = runtimeConfig.posting.maxWords;
    }

    // Override session limits from runtime config based on session type
    const sessionConfig = sessionType === 'market' ? runtimeConfig?.market : runtimeConfig?.explore;
    if (sessionConfig) {
      if (sessionConfig.maxLikes != null) config.SESSION_LIMITS.MAX_LIKES = sessionConfig.maxLikes;
      if (sessionConfig.maxFollows != null) config.SESSION_LIMITS.MAX_FOLLOWS = sessionConfig.maxFollows;
    }
    if (runtimeConfig?.maxLikesPerAuthor != null) config.MAX_LIKES_PER_AUTHOR = runtimeConfig.maxLikesPerAuthor;

    console.log(`📋 Config: minScoreToSave=${config.AI_CONFIG.MIN_SCORE_TO_SAVE}, minScoreToPost=${config.AI_CONFIG.MIN_SCORE_TO_POST}, maxLikes=${config.SESSION_LIMITS.MAX_LIKES}, maxFollows=${config.SESSION_LIMITS.MAX_FOLLOWS}, maxQuoteRTs/day=${maxQuoteRTsPerDay}, maxWords=${maxWords}`);

    // Sort scores descending
    scores.sort((a, b) => b.score - a.score);

    let liked = 0, followed = 0, saved = 0;
    const authorLikeCounts = {};

    console.log(`📊 Processing ${scores.length} scored posts...`);

    for (const s of scores) {
      const post = posts.find(p => p.i === s.i);
      if (!post) continue;

      let didLike = false, didFollow = false;

      // Engage with high-scored posts
      if (s.score >= config.AI_CONFIG.MIN_SCORE_TO_LIKE) {
        const authorId = post.authorId;
        authorLikeCounts[authorId] = authorLikeCounts[authorId] || 0;

        // Like
        if (liked < config.SESSION_LIMITS.MAX_LIKES &&
            authorLikeCounts[authorId] < config.MAX_LIKES_PER_AUTHOR) {
          try {
            await xClient.likePost(post.id);
            liked++;
            didLike = true;
            authorLikeCounts[authorId]++;
            console.log(`❤️ Liked: ${post.id} [${s.score}] ${s.reason}`);
            await new Promise(r => setTimeout(r, config.RATE_LIMITS.ENGAGEMENT_DELAY_MS));
          } catch (err) {
            console.error(`❌ Like failed for ${post.id}: ${err.message}`);
          }
        }

        // Follow for 8+ scores
        if (s.score >= config.AI_CONFIG.MIN_SCORE_TO_FOLLOW &&
            followed < config.SESSION_LIMITS.MAX_FOLLOWS) {
          try {
            await xClient.followUser(post.authorId);
            followed++;
            didFollow = true;
            console.log(`👤 Followed: @${post.authorUsername}`);
            await new Promise(r => setTimeout(r, config.RATE_LIMITS.ENGAGEMENT_DELAY_MS));
          } catch (err) {
            console.error(`❌ Follow failed: ${err.message}`);
          }
        }
      }

      // Only save finds that meet minimum score threshold
      if (s.score >= (config.AI_CONFIG.MIN_SCORE_TO_SAVE || 5)) {
        try {
          await database.saveFinding(
            { id: post.id, text: post.text, author_id: post.authorId, created_at: post.createdAt, 
              public_metrics: { like_count: post.metrics?.likes, retweet_count: post.metrics?.retweets, reply_count: post.metrics?.replies },
              _authorUsername: post.authorUsername },
            { username: post.authorUsername, name: post.authorName || '', id: post.authorId },
            { score: s.score, reason: s.reason, matchedTopics: [], matchedTickers: [] },
            sessionId,
            { liked: didLike, followed: didFollow, sessionType }
          );
          saved++;
        } catch (err) {
          console.error(`❌ DB save failed for ${post.id}: ${err.message}`);
        }
      }
    }

    // Quote-RTs — process all provided quote-RTs up to daily limit
    if (quoteRts.length > 0) {
      if (!postingEnabled) {
        console.log('⏸️ Quote-RTs skipped: posting is disabled');
      } else {
        const today = new Date().toISOString().split('T')[0];
        let quoteRTsToday = await database.countPostsToday('quote_rt', today);

        for (const qrt of quoteRts) {
          if (quoteRTsToday >= maxQuoteRTsPerDay) {
            console.log(`⏸️ Quote-RT skipped: already posted ${quoteRTsToday}/${maxQuoteRTsPerDay} quote-RTs today`);
            break;
          }

          let quoteRtPostId = qrt.postId;

          // Resolve array index to actual tweet ID if needed
          // (agents sometimes pass the post index instead of the tweet ID)
          if (/^\d{1,4}$/.test(quoteRtPostId) && posts.length > 0) {
            const idx = parseInt(quoteRtPostId, 10);
            const resolvedPost = posts.find(p => p.i === idx);
            if (resolvedPost && resolvedPost.id) {
              console.log(`🔄 Resolved post index ${idx} to tweet ID ${resolvedPost.id}`);
              quoteRtPostId = resolvedPost.id;
            } else {
              console.log(`⚠️ Could not resolve post index ${idx} — no matching post found. Skipping quote-RT.`);
              continue;
            }
          }

          // Dedup: skip if we already quoted this post in the past 7 days
          if (await database.hasQuotedRecently(quoteRtPostId)) {
            console.log(`⏭️ Skipping quote-RT: already quoted post ${quoteRtPostId} recently`);
            continue;
          }

          // Content review: code validation first, then LLM editorial review
          let finalText = qrt.text;
          let approved = false;
          const maxRetries = 2;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const wordCount = finalText.trim().split(/\s+/).length;
            const charCount = finalText.length;
            const codeIssues = [];
            if (wordCount > maxWords) codeIssues.push(`Word count ${wordCount} exceeds max ${maxWords}`);
            if (charCount > 280) codeIssues.push(`Char count ${charCount} exceeds 280`);
            if (finalText.includes('#')) codeIssues.push('Contains hashtags');
            if (/not financial advice/i.test(finalText)) codeIssues.push('Contains disclaimer');

            if (codeIssues.length > 0) {
              console.log(`⚠️ Code validation FAILED (attempt ${attempt + 1}): ${codeIssues.join('; ')}`);
              if (attempt >= maxRetries) break;
            }

            console.log(`📝 Review attempt ${attempt + 1}/${maxRetries + 1}: "${finalText}"`);
            const review = await reviewPost(finalText, 'TommyPickles', 'quote_rt', maxWords);

            if (review.approved && codeIssues.length === 0) {
              approved = true;
              const wc = finalText.trim().split(/\s+/).length;
              console.log(`✅ Content review PASSED (${wc}/${maxWords} words, ${charCount}/280 chars)`);
              break;
            } else {
              const allIssues = [...codeIssues, ...(review.issues || [])];
              console.log(`⚠️ Review FAILED: ${allIssues.join('; ')}`);
              if (review.revisedText && attempt < maxRetries) {
                finalText = review.revisedText;
                console.log(`📝 Using editor's revision: "${finalText}"`);
              } else if (attempt < maxRetries) {
                console.log(`⚠️ No revision suggested, stopping retries`);
                break;
              }
            }
          }

          if (approved) {
            const wordCount = finalText.trim().split(/\s+/).length;
            console.log(`📝 Posting quote-RT (${wordCount} words): "${finalText}" on post ${quoteRtPostId}`);
            try {
              const result = await xClient.createQuoteRepost(finalText, quoteRtPostId);
              const postId = result?.data?.id || result?.id;
              if (postId) {
                console.log(`✅ Quote-RT posted: https://x.com/i/status/${postId}`);
                quoteRTsToday++;
                
                const quotedPost = posts.find(p => p.id === quoteRtPostId);
                await database.savePost({
                  postId: postId,
                  text: finalText,
                  type: 'quote_rt',
                  quotedPostId: quoteRtPostId,
                  quotedPostUrl: quotedPost ? `https://x.com/${quotedPost.authorUsername}/status/${quoteRtPostId}` : null,
                  quotedAuthor: quotedPost?.authorUsername || null,
                });
              }
            } catch (err) {
              console.error(`❌ Quote-RT failed: ${err.message}`);
            }
          } else {
            console.log(`🚫 Quote-RT abandoned after review failures`);
          }

          // Delay between quote-RTs
          if (quoteRts.indexOf(qrt) < quoteRts.length - 1) {
            await new Promise(r => setTimeout(r, config.RATE_LIMITS.ENGAGEMENT_DELAY_MS));
          }
        }
      }
    }

    // Complete session
    await database.completeSession(sessionId, {
      'stats.postsLiked': liked,
      'stats.usersFollowed': followed,
      'stats.findingsSaved': saved,
    });

    console.log(`\n✅ Engagement complete: ${liked} liked, ${followed} followed, ${saved} saved to DB`);

    await database.disconnect();
  } catch (err) {
    console.error(`❌ Engagement failed: ${err.message}`);
    await database.disconnect();
    process.exit(1);
  }
}

/**
 * Review a post via the content-editor agent (review-post.js → openclaw agent CLI)
 * Returns { approved, issues, suggestions, revisedText }
 */
async function reviewPost(text, author, type, maxWords) {
  const { execSync } = require('child_process');
  const path = require('path');
  const reviewScript = path.join(__dirname, 'review-post.js');
  
  try {
    const cmd = `node "${reviewScript}" --text "${text.replace(/"/g, '\\"')}" --author "${author}" --type "${type}" --max-words ${maxWords}`;
    const stdout = execSync(cmd, { timeout: 120000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    
    const lines = stdout.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    return JSON.parse(jsonLine);
  } catch (err) {
    if (err.stdout) {
      try {
        const lines = err.stdout.trim().split('\n');
        const jsonLine = lines[lines.length - 1];
        return JSON.parse(jsonLine);
      } catch {}
    }
    console.error(`⚠️ Content review error: ${err.message}`);
    return { approved: false, issues: ['Review system unavailable'], suggestions: [], revisedText: null };
  }
}

engage();
