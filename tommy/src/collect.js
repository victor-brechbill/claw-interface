#!/usr/bin/env node

/**
 * Tommy Collect — Phase 1: Fetch posts from X API
 * 
 * Collects timeline + search posts and outputs JSON to stdout.
 * The Tommy agent scores them directly, then feeds scores to engage.js.
 * 
 * Usage: node src/collect.js [--type explore|market]
 * Output: JSON object with { posts: [...], session: {...}, victorActivity: {...} }
 */

const InterestMatcher = require('./interest-matcher');
const config = require('./config');
const { initSession } = require('./session-helper');

const sessionType = process.argv.includes('--type') 
  ? process.argv[process.argv.indexOf('--type') + 1] 
  : 'explore';

async function collect() {
  const interestMatcher = new InterestMatcher();
  
  const collectedPosts = [];
  const userIndex = {};
  let victorActivity = { topics: [], authors: [], tickers: [] };
  let exclusionSet = new Set();

  const { xClient, database, session, runtimeConfig } = await initSession({ sessionType });

  try {
    await interestMatcher.loadInterests();
    const sessionConfig = runtimeConfig?.explore;
    if (sessionConfig) {
      if (sessionConfig.maxSearches != null) config.SESSION_LIMITS.MAX_SEARCHES = sessionConfig.maxSearches;
      if (sessionConfig.maxSearchResults != null) config.SESSION_LIMITS.MAX_SEARCH_RESULTS = sessionConfig.maxSearchResults;
      if (sessionConfig.maxTimelinePosts != null) config.SESSION_LIMITS.MAX_TIMELINE_POSTS = sessionConfig.maxTimelinePosts;
    }
    if (runtimeConfig?.victorProfile) {
      if (runtimeConfig.victorProfile.maxLikesToScan != null) config.VICTOR_PROFILE.MAX_LIKES_TO_SCAN = runtimeConfig.victorProfile.maxLikesToScan;
      if (runtimeConfig.victorProfile.maxTweetsToScan != null) config.VICTOR_PROFILE.MAX_TWEETS_TO_SCAN = runtimeConfig.victorProfile.maxTweetsToScan;
    }
    console.error(`📋 Runtime config loaded: maxSearches=${config.SESSION_LIMITS.MAX_SEARCHES}, maxTimeline=${config.SESSION_LIMITS.MAX_TIMELINE_POSTS}`);

    // Phase 0: Victor activity scan
    console.error('📡 Phase 0: Victor activity scan...');
    try {
      const victorResp = await xClient.getUserByUsername(config.VICTOR_PROFILE.USERNAME);
      const victorUser = victorResp?.data;
      if (victorUser && victorUser.id) {
        // Get Victor's recent likes for exclusion
        const likesResp = await xClient.getUserLikes(victorUser.id, config.VICTOR_PROFILE.MAX_LIKES_TO_SCAN);
        for (const post of (likesResp.data || [])) {
          exclusionSet.add(post.id);
        }
        
        // Get Victor's recent tweets for topic signals
        const tweetsResp = await xClient.getUserTweets(victorUser.id, config.VICTOR_PROFILE.MAX_TWEETS_TO_SCAN);
        const signals = interestMatcher.extractSignals(tweetsResp.data || []);
        victorActivity.topics = signals.topics || [];
        victorActivity.tickers = signals.tickers || [];
        victorActivity.authors = signals.authors || [];
        
        console.error(`✅ Victor scan: ${exclusionSet.size} exclusions, ${victorActivity.topics.length} topics`);
      }
    } catch (err) {
      console.error(`⚠️ Victor scan failed: ${err.message}`);
    }

    // Phase 1: Timeline
    console.error('📱 Phase 1: Timeline collection...');
    try {
      const timelineResponse = await xClient.getHomeTimeline(config.SESSION_LIMITS.MAX_TIMELINE_POSTS);
      const posts = timelineResponse.data || [];
      const users = {};
      for (const u of (timelineResponse.includes?.users || [])) {
        users[u.id] = u;
      }
      
      for (const post of posts) {
        if (exclusionSet.has(post.id)) continue;
        const author = users[post.author_id];
        if (author) {
          post._authorUsername = author.username;
          post._authorName = author.name;
        }
        collectedPosts.push(post);
        if (post._authorUsername) {
          userIndex[post.author_id] = { username: post._authorUsername, name: post._authorName || '' };
        }
      }
      console.error(`✅ Phase 1: ${posts.length} timeline posts, ${collectedPosts.length} after exclusions`);
    } catch (err) {
      console.error(`❌ Timeline failed: ${err.message}`);
    }

    // Phase 2: Search (mixed strategy: quality + discovery)
    console.error('🔍 Phase 2: Search...');
    // Use interests-based queries
    const searchQueries = interestMatcher.interests?.tickers?.map(t => `$${t}`) || ['SpaceX OR "Rocket Lab"', 'AI startup'];
    
    for (let qi = 0; qi < Math.min(searchQueries.length, config.SESSION_LIMITS.MAX_SEARCHES); qi++) {
      const rawQuery = searchQueries[qi];
      // Alternate strategy: even queries = verified+relevancy, odd = niche discovery (no lang filter)
      const isDiscovery = qi % 2 === 1;
      const query = isDiscovery
        ? rawQuery + ' -is:retweet'                    // niche/foreign: wide net, relevancy sort still applied by default
        : rawQuery + ' is:verified -is:retweet lang:en'; // quality: verified English content
      try {
        const searchResponse = await xClient.searchRecent(query, config.SESSION_LIMITS.MAX_SEARCH_RESULTS);
        const results = searchResponse.data || [];
        const searchUsers = {};
        for (const u of (searchResponse.includes?.users || [])) {
          searchUsers[u.id] = u;
        }
        for (const post of results) {
          const author = searchUsers[post.author_id];
          if (author) {
            post._authorUsername = author.username;
            post._authorName = author.name;
          }
          if (!exclusionSet.has(post.id) && !collectedPosts.find(p => p.id === post.id)) {
            collectedPosts.push(post);
          }
          if (post._authorUsername) {
            userIndex[post.author_id] = { username: post._authorUsername, name: post._authorName || '' };
          }
        }
        console.error(`  🔎 "${query}": ${results.length} results`);
        await new Promise(r => setTimeout(r, config.RATE_LIMITS.SEARCH_DELAY_MS));
      } catch (err) {
        console.error(`  ❌ Search "${query}" failed: ${err.message}`);
      }
    }

    console.error(`✅ Collection complete: ${collectedPosts.length} posts total`);

    // Output JSON to stdout — this is what the agent reads
    const output = {
      sessionId: session.sessionId,
      sessionType,
      collectedAt: new Date().toISOString(),
      postCount: collectedPosts.length,
      posts: collectedPosts.map((p, i) => ({
        i,
        id: p.id,
        text: (p.text || '').slice(0, 500),
        authorId: p.author_id,
        authorUsername: p._authorUsername || userIndex[p.author_id]?.username || 'unknown',
        authorName: p._authorName || userIndex[p.author_id]?.name || '',
        metrics: {
          likes: p.public_metrics?.like_count || 0,
          retweets: p.public_metrics?.retweet_count || 0,
          replies: p.public_metrics?.reply_count || 0,
        },
        createdAt: p.created_at,
      })),
      victorActivity,
    };

    // Write output to file (stdout is polluted by library console.log calls)
    const outFile = process.argv.includes('--out') 
      ? process.argv[process.argv.indexOf('--out') + 1]
      : '/tmp/tommy-collected.json';
    const fs = require('fs');
    fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
    console.error(`📁 Output written to ${outFile}`);

    await database.disconnect();
  } catch (err) {
    console.error(`❌ Collection failed: ${err.message}`);
    await database.disconnect();
    process.exit(1);
  }
}

collect();
