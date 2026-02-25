#!/usr/bin/env node

/**
 * Tommy Hot Take — Engagement Execution Engine
 * 
 * Reads a hot take plan and executes each engagement action:
 * - image_post: Generate image + post with caption
 * - quote_rt: Find high-engagement post + quote-RT with hot take angle
 * - thread_reply: Find active thread + reply with hot take
 * 
 * Retry strategy (per engagement):
 *   1. Try the engagement as planned
 *   2. On failure, retry with broader parameters (up to MAX_RETRIES)
 *   3. If all retries fail, fall back to a plain text post
 *   4. If fallback also fails, log and move on (never loop endlessly)
 * 
 * Usage: node src/execute-hottake.js --plan /tmp/tommy-hottake-plan.json
 * Output: Results written to /tmp/tommy-hottake-results.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const { initSession } = require('./session-helper');

const MAX_RETRIES = 2; // Max retry attempts per engagement (so 3 total: 1 original + 2 retries)

async function executePlan() {
  const args = process.argv.slice(2);
  const planIdx = args.indexOf('--plan');

  if (planIdx === -1 || !args[planIdx + 1]) {
    console.error('❌ Usage: node src/execute-hottake.js --plan /tmp/tommy-hottake-plan.json');
    process.exit(1);
  }

  const planPath = args[planIdx + 1];

  // Load plan
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (err) {
    console.error(`❌ Failed to read plan: ${err.message}`);
    process.exit(1);
  }

  if (!plan.engagementPlan || !Array.isArray(plan.engagementPlan)) {
    console.error('❌ Plan must contain an engagementPlan array');
    process.exit(1);
  }

  console.log(`📋 Hot Take: "${plan.shortTake || plan.hotTake}"`);
  console.log(`📋 Engagements planned: ${plan.engagementPlan.length}`);

  // Initialize session
  const { xClient, database, runtimeConfig } = await initSession({ sessionType: 'hot_take' });

  const results = [];
  let executed = 0;
  const maxEngagements = config.HOT_TAKE_CONFIG.MAX_ENGAGEMENTS || 3;
  const minLikesForQuoteRT = config.HOT_TAKE_CONFIG.MIN_FOLLOWERS_FOR_QUOTE_RT || 5000;
  const postingEnabled = runtimeConfig?.posting?.enabled ?? config.POSTING_CONFIG.ENABLED;

  if (!postingEnabled) {
    console.log('⏸️ Posting is disabled — dry run only');
  }

  try {
    // Check daily caps
    const today = new Date().toISOString().split('T')[0];
    let quoteRTsToday = await database.countPostsToday('quote_rt', today);
    const maxQuoteRTs = runtimeConfig?.posting?.maxQuoteRTsPerDay ?? config.POSTING_CONFIG.MAX_QUOTE_RTS_PER_DAY;

    console.log(`📊 Today's caps — Quote-RTs: ${quoteRTsToday}/${maxQuoteRTs}`);

    for (const engagement of plan.engagementPlan) {
      if (executed >= maxEngagements) {
        console.log(`⏸️ Max engagements reached (${maxEngagements})`);
        break;
      }

      console.log(`\n━━━ Executing: ${engagement.type} ━━━`);

      const result = await executeWithRetry(
        engagement, plan, xClient, database,
        postingEnabled, today, { quoteRTsToday, maxQuoteRTs, minLikesForQuoteRT },
        results
      );

      if (result.success && !result.dryRun && engagement.type === 'quote_rt') {
        quoteRTsToday++;
      }

      results.push({ type: engagement.type, ...result });
      if (result.success) executed++;
    }

    // Write results
    const resultsPath = '/tmp/tommy-hottake-results.json';
    const output = {
      hotTake: plan.hotTake,
      shortTake: plan.shortTake,
      executedAt: new Date().toISOString(),
      totalPlanned: plan.engagementPlan.length,
      totalExecuted: executed,
      results,
    };
    fs.writeFileSync(resultsPath, JSON.stringify(output, null, 2));
    console.log(`\n📄 Results written to ${resultsPath}`);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`\n✅ Hot Take Engagement Complete: ${succeeded} succeeded, ${failed} failed out of ${results.length} attempted`);

    if (database.endSession) await database.endSession();
    await database.disconnect();
  } catch (err) {
    console.error(`❌ Execution failed: ${err.message}`);
    if (database.endSession) await database.endSession();
    await database.disconnect();
    process.exit(1);
  }
}

/**
 * Universal retry wrapper for any engagement type.
 * Attempts the engagement, retries with broader params, then falls back to text post.
 */
async function executeWithRetry(engagement, plan, xClient, database, postingEnabled, today, caps, previousResults) {
  const attempts = [];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`🔄 Retry ${attempt}/${MAX_RETRIES} for ${engagement.type}...`);
    }

    try {
      let result;

      switch (engagement.type) {
        case 'image_post':
          result = await executeImagePost(engagement, plan, xClient, database, postingEnabled, today, attempt);
          break;
        case 'quote_rt':
          result = await executeQuoteRT(engagement, plan, xClient, database, postingEnabled, today, caps, attempt);
          break;
        case 'thread_reply':
          result = await executeThreadReply(engagement, plan, xClient, database, postingEnabled, today, attempt);
          break;
        default:
          console.log(`⚠️ Unknown engagement type: ${engagement.type}`);
          return { success: false, error: `Unknown type: ${engagement.type}` };
      }

      if (result.success) {
        if (attempt > 0) console.log(`✅ Succeeded on retry ${attempt}`);
        return result;
      }

      // Duplicate detected — don't retry, don't fallback
      if (result.skipRetries) {
        return result;
      }

      // Not successful but didn't throw — log and continue to next attempt
      attempts.push(result.error || 'Unknown failure');
      console.log(`⚠️ Attempt ${attempt + 1} failed: ${result.error}`);

    } catch (err) {
      attempts.push(err.message);
      console.error(`❌ Attempt ${attempt + 1} threw: ${err.message}`);
    }
  }

  // All retries exhausted — try text-only fallback
  console.log(`🔄 All ${MAX_RETRIES + 1} attempts failed. Trying text-only fallback...`);

  // Check if shortTake was already posted by a previous engagement (avoid duplicate)
  const alreadyPostedShortTake = (previousResults || []).some(r =>
    r.success && !r.dryRun && (r.type === 'image_post' || r.fallback === 'text_post')
  );

  if (alreadyPostedShortTake) {
    console.log(`⏭️ Skipping text fallback — shortTake already posted by a previous engagement`);
    return { success: false, error: 'All attempts failed; text fallback skipped (already posted)', attempts };
  }

  if (postingEnabled) {
    try {
      // Always use shortTake for text fallback — angle/replyText are contextual
      // and don't make sense as standalone posts
      const fallbackText = plan.shortTake;
      const fbResult = await xClient.post(fallbackText, {});
      const fbPostId = fbResult?.data?.id;

      if (fbPostId) {
        console.log(`✅ Fallback text post: https://x.com/i/status/${fbPostId}`);
        await database.savePost({ postId: fbPostId, text: fallbackText, type: 'hot_take_text' });
        return {
          success: true,
          postId: fbPostId,
          postUrl: `https://x.com/i/status/${fbPostId}`,
          fallback: 'text_post',
          originalType: engagement.type,
          attempts: attempts,
        };
      }
    } catch (fbErr) {
      console.error(`❌ Text fallback also failed: ${fbErr.message}`);
      attempts.push(`fallback: ${fbErr.message}`);
    }
  }

  // Everything failed
  console.log(`💀 Giving up on ${engagement.type} after ${attempts.length} total attempts`);
  return { success: false, error: 'All attempts and fallback exhausted', attempts };
}

// ─── ENGAGEMENT EXECUTORS ───────────────────────────────────────────────

/**
 * Image post: generate AI image + post tweet with media.
 * Retry strategy: attempt 0 = normal, attempt 1 = simplified prompt, attempt 2 = caption-only (no image)
 */
async function executeImagePost(engagement, plan, xClient, database, postingEnabled, today, attempt) {
  const caption = engagement.caption || plan.shortTake;

  // Duplicate prevention: skip if exact same text already posted
  if (attempt === 0 && await database.hasPostedExactText(caption)) {
    console.log(`⚠️ Exact duplicate detected — "${caption.substring(0, 60)}..." already posted. Skipping.`);
    return { success: false, error: 'duplicate_text', skipRetries: true };
  }

  if (!config.HOT_TAKE_CONFIG.IMAGE_GEN_ENABLED && attempt === 0) {
    console.log('⏸️ Image generation disabled, will try text-only');
    return { success: false, error: 'Image generation disabled' };
  }

  // On later attempts, simplify the prompt to reduce API failures
  let imagePrompt = engagement.imagePrompt;
  if (attempt === 1) {
    // Simplify: take first sentence only, add safe style keywords
    imagePrompt = imagePrompt.split(/[.!?]/)[0] + '. Abstract digital art, minimal.';
    console.log(`🎨 Simplified prompt: "${imagePrompt.substring(0, 80)}..."`);
  } else if (attempt >= 2) {
    // Give up on image, post caption as text only
    console.log(`📝 Skipping image gen, posting caption as text...`);
    if (!postingEnabled) {
      return { success: true, dryRun: true, caption };
    }
    const textResult = await xClient.post(caption, {});
    const postId = textResult?.data?.id;
    if (!postId) throw new Error('Text post returned no post ID');

    console.log(`✅ Text-only post: https://x.com/i/status/${postId}`);
    await database.savePost({ postId, text: caption, type: 'hot_take_text' });
    return { success: true, postId, postUrl: `https://x.com/i/status/${postId}`, fallback: 'text_only' };
  }

  // Use pre-generated image if available, otherwise generate new one
  let imagePath = engagement.imagePath;
  if (imagePath && fs.existsSync(imagePath)) {
    console.log(`📸 Using pre-generated image: ${imagePath}`);
  } else {
    console.log(`🎨 Generating image (attempt ${attempt + 1})...`);
    const genScript = path.join(__dirname, 'gen-image.js');

    const output = execFileSync(
      'node', [genScript, '--prompt', imagePrompt],
      { encoding: 'utf8', timeout: 300000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    imagePath = output.trim().split('\n').pop().trim();

    if (!imagePath || !fs.existsSync(imagePath)) {
      throw new Error(`Image not found at: ${imagePath}`);
    }

    console.log(`📸 Image ready: ${imagePath}`);
  }

  if (!postingEnabled) {
    return { success: true, dryRun: true, imagePath, caption };
  }

  const mediaId = await xClient.uploadMedia(imagePath);
  console.log(`✅ Media uploaded: ${mediaId}`);

  const tweetResult = await xClient.createTweetWithMedia(caption, [mediaId]);
  const postId = tweetResult?.data?.id;
  if (!postId) throw new Error('Tweet creation returned no post ID');

  console.log(`✅ Image post: https://x.com/i/status/${postId}`);
  await database.savePost({ postId, text: caption, type: 'hot_take_image', socialImagePath: imagePath });
  return { success: true, postId, postUrl: `https://x.com/i/status/${postId}`, imagePath };
}

/**
 * Quote-RT: search for popular post + quote with unique angle.
 * Retry strategy: attempt 0 = exact query, attempt 1 = broader query, attempt 2 = broadest + relaxed threshold
 */
async function executeQuoteRT(engagement, plan, xClient, database, postingEnabled, today, caps, attempt) {
  if (caps.quoteRTsToday >= caps.maxQuoteRTs) {
    console.log(`⏸️ Quote-RT daily cap reached (${caps.quoteRTsToday}/${caps.maxQuoteRTs})`);
    return { success: false, error: 'Daily quote-RT cap reached' };
  }

  const angle = engagement.angle || plan.shortTake;
  const queries = buildRetryQueries(engagement.searchQuery);

  // Progressive search strategy:
  // Attempt 0: exact query + is:verified + has:media (highest quality visual content)
  // Attempt 1: broader query + is:verified (relax topic & media requirement)
  // Attempt 2: broadest query, no filters (cast widest net, discover niche content)
  const queryIdx = Math.min(attempt, queries.length - 1);
  const baseQuery = queries[queryIdx];
  const filters = attempt === 0
    ? ' is:verified has:media -is:retweet lang:en'
    : attempt === 1
      ? ' is:verified -is:retweet lang:en'
      : ' -is:retweet lang:en';
  const minLikes = attempt >= 2 ? 0 : attempt >= 1 ? Math.floor(caps.minLikesForQuoteRT / 5) : caps.minLikesForQuoteRT;

  const query = baseQuery + filters;
  console.log(`🔍 Search: "${query}" (min likes: ${minLikes}, sort: relevancy)`);
  const searchResult = await xClient.searchRecent(query, 20, { sortOrder: 'relevancy' });
  const tweets = searchResult?.data || [];

  if (tweets.length === 0) {
    return { success: false, error: `No tweets found for "${query}"` };
  }

  // Score tweets by engagement quality, preferring verified/high-follower authors
  const scored = tweets
    .map(t => ({
      tweet: t,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      authorFollowers: t._author?.public_metrics?.followers_count || 0,
      isVerified: t._author?.is_identity_verified || false,
      verifiedFollowers: t._author?.verified_followers_count || 0,
    }))
    .map(s => ({
      ...s,
      // Composite score: likes matter most, but boost verified & high-follower authors
      score: s.likes + (s.retweets * 2) + (s.isVerified ? 50 : 0) + Math.min(s.authorFollowers / 100, 100),
    }))
    .sort((a, b) => b.score - a.score);

  const qualifying = scored.filter(s => s.likes >= minLikes || s.score >= 50);
  if (qualifying.length === 0) {
    const best = scored[0];
    return { success: false, error: `Best tweet: ${best.likes} likes, score ${Math.round(best.score)} (need ${minLikes} likes or 50 score)` };
  }

  // Find first qualifying target not already quoted in the past 7 days
  let target = null;
  let targetLikes = 0;
  let targetInfo = null;
  for (const candidate of qualifying) {
    if (await database.hasQuotedRecently(candidate.tweet.id)) {
      console.log(`⏭️ Skipping already-quoted post: "${candidate.tweet.text?.substring(0, 60)}..."`);
      continue;
    }
    target = candidate.tweet;
    targetLikes = candidate.likes;
    targetInfo = candidate;
    break;
  }

  if (!target) {
    return { success: false, error: `All ${qualifying.length} qualifying tweets already quoted recently` };
  }

  const authorInfo = target._author ? ` by @${target._author.username} (${targetInfo.authorFollowers} followers${targetInfo.isVerified ? ', ✓' : ''})` : '';

  console.log(`🎯 Target: "${target.text?.substring(0, 80)}..."${authorInfo} (${targetLikes} likes, score: ${Math.round(targetInfo.score)})`);

  if (!postingEnabled) {
    return { success: true, dryRun: true, targetPostId: target.id, angle };
  }

  const result = await xClient.createQuoteRepost(angle, target.id);
  const postId = result?.data?.id;
  if (!postId) throw new Error('Quote-RT returned no post ID');

  console.log(`✅ Quote-RT: https://x.com/i/status/${postId}`);
  await database.savePost({ postId, text: angle, type: 'quote_rt', quotedPostId: target.id, quotedAuthor: target.author_id });
  return { success: true, postId, postUrl: `https://x.com/i/status/${postId}`, quotedPostId: target.id };
}

/**
 * Thread reply: find active conversation + contribute the hot take.
 * Retry strategy: attempt 0 = exact query, attempt 1 = broader, attempt 2 = broadest + lower reply threshold
 */
async function executeThreadReply(engagement, plan, xClient, database, postingEnabled, today, attempt) {
  const replyText = engagement.replyText || plan.shortTake;
  const queries = buildRetryQueries(engagement.searchQuery);

  // Progressive: verified first, then open discovery
  const queryIdx = Math.min(attempt, queries.length - 1);
  const baseQuery = queries[queryIdx];
  const filters = attempt === 0
    ? ' is:verified -is:retweet lang:en'
    : ' -is:retweet';
  const minReplies = attempt >= 2 ? 0 : attempt >= 1 ? 3 : 10;

  const query = baseQuery + filters;
  console.log(`🔍 Search threads: "${query}" (min replies: ${minReplies}, sort: relevancy)`);
  const searchResult = await xClient.searchRecent(query, 20, { sortOrder: 'relevancy' });
  const tweets = searchResult?.data || [];

  if (tweets.length === 0) {
    return { success: false, error: `No tweets found for "${query}"` };
  }

  tweets.sort((a, b) => (b.public_metrics?.reply_count || 0) - (a.public_metrics?.reply_count || 0));

  // Find first thread not already replied to in past 7 days
  let best = null;
  for (const t of tweets) {
    const replies = t.public_metrics?.reply_count || 0;
    if (replies < minReplies) break; // sorted desc, no point continuing
    if (await database.hasQuotedRecently(t.id)) {
      console.log(`⏭️ Skipping already-replied thread: "${t.text?.substring(0, 60)}..."`);
      continue;
    }
    best = t;
    break;
  }

  if (!best) {
    return { success: false, error: `No un-replied threads with ${minReplies}+ replies found` };
  }

  return await postReply(best, replyText, xClient, database, postingEnabled);
}

// ─── HELPERS ────────────────────────────────────────────────────────────

/**
 * Build progressively broader search queries for retry.
 * "Anthropic $30 billion valuation" → ["Anthropic $30 billion valuation", "Anthropic valuation", "Anthropic"]
 */
function buildRetryQueries(query) {
  // Strip $ signs — X interprets $word as cashtag search which returns wrong results
  const sanitized = query.replace(/\$/g, '');
  const queries = [sanitized];
  const words = sanitized.split(/\s+/).filter(w => w.length > 2);
  
  if (words.length > 3) {
    const keyWords = words.filter(w => !/^[\d%]+$/.test(w));
    if (keyWords.length >= 2) queries.push(keyWords.slice(0, 3).join(' '));
    if (keyWords.length >= 1) queries.push(keyWords[0]);
  } else if (words.length > 1) {
    queries.push(words[0]);
  }
  
  return [...new Set(queries)];
}

async function postReply(target, replyText, xClient, database, postingEnabled) {
  const replyCount = target.public_metrics?.reply_count || 0;
  console.log(`🎯 Thread: "${target.text?.substring(0, 80)}..." (${replyCount} replies)`);

  if (!postingEnabled) {
    return { success: true, dryRun: true, targetPostId: target.id, replyText };
  }

  const result = await xClient.post(replyText, { replyTo: target.id });
  const postId = result?.data?.id;
  if (!postId) throw new Error('Reply returned no post ID');

  console.log(`✅ Reply: https://x.com/i/status/${postId}`);
  await database.savePost({ postId, text: replyText, type: 'hot_take_reply', quotedPostId: target.id });
  return { success: true, postId, postUrl: `https://x.com/i/status/${postId}`, targetPostId: target.id };
}

executePlan();
