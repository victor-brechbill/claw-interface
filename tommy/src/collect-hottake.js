#!/usr/bin/env node

/**
 * Tommy Collect Hot Take — Fetch inspiration for Hot Take sessions
 * 
 * Modes:
 *   --mode x_trending     Fetch trending topics from X
 *   --mode owner_archive   Search owner's recent posts
 *   --mode web_search      Placeholder (agent handles via web_search tool)
 * 
 * Output: /tmp/tommy-hottake-inspiration.json
 */

const fs = require('fs');
const config = require('./config');
const { initSession } = require('./session-helper');

const outFile = '/tmp/tommy-hottake-inspiration.json';

// Parse --mode argument or auto-rotate
const modeArg = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : null;

function getMode() {
  if (modeArg) return modeArg;
  const sources = config.HOT_TAKE_CONFIG.INSPIRATION_ROTATION;
  const dayIndex = Math.floor(Date.now() / 86400000) % sources.length;
  return sources[dayIndex];
}

function today() {
  return new Date().toISOString().split('T')[0];
}

async function collectTrending(xClient) {
  console.error('📈 Fetching trending topics...');

  let trends = [];

  // Try personalized trends first
  try {
    const resp = await xClient.getPersonalizedTrends();
    if (resp.data && Array.isArray(resp.data)) {
      trends = resp.data.map(t => ({
        trend_name: t.trend_name || t.name || t.query,
        tweet_count: t.tweet_count || t.volume || 0,
      }));
      console.error(`✅ Personalized trends: ${trends.length} topics`);
    }
  } catch (err) {
    console.error(`⚠️ Personalized trends failed: ${err.message}`);
  }

  // Fallback to WOEID-based trends
  if (trends.length === 0) {
    try {
      console.error('🔄 Falling back to WOEID 23424977 (US)...');
      const resp = await xClient.getTrendsByWoeid(23424977);
      if (resp.data && Array.isArray(resp.data)) {
        trends = resp.data.map(t => ({
          trend_name: t.trend_name || t.name || t.query,
          tweet_count: t.tweet_count || t.volume || 0,
        }));
      }
      console.error(`✅ WOEID trends: ${trends.length} topics`);
    } catch (err) {
      console.error(`❌ WOEID trends also failed: ${err.message}`);
    }
  }

  const output = {
    source: 'x_trending',
    date: today(),
    trends,
    posts: [],
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`📁 Output written to ${outFile}`);
}

async function collectOwnerArchive(xClient) {
  const ownerUsername = config.HOT_TAKE_CONFIG.OWNER_USERNAME;
  console.error(`🔍 Searching owner's archive (@${ownerUsername})...`);

  const queries = [
    `from:${ownerUsername}`,
    `from:${ownerUsername} (idea OR think OR future OR should)`,
  ];

  // Randomize: pick 1-2 queries
  const shuffled = queries.sort(() => Math.random() - 0.5);
  const toUse = shuffled.slice(0, Math.random() > 0.5 ? 2 : 1);

  const allPosts = [];
  const seenIds = new Set();

  for (const query of toUse) {
    try {
      console.error(`  🔎 Query: "${query}"`);
      const resp = await xClient.searchRecent(query, 20);
      const users = {};
      for (const u of (resp.includes?.users || [])) {
        users[u.id] = u;
      }
      for (const post of (resp.data || [])) {
        if (seenIds.has(post.id)) continue;
        seenIds.add(post.id);
        const author = users[post.author_id];
        allPosts.push({
          id: post.id,
          text: (post.text || '').slice(0, 500),
          authorUsername: author?.username || ownerUsername,
          metrics: {
            likes: post.public_metrics?.like_count || 0,
            retweets: post.public_metrics?.retweet_count || 0,
            replies: post.public_metrics?.reply_count || 0,
          },
        });
      }
      console.error(`  ✅ Got ${resp.data?.length || 0} results`);
    } catch (err) {
      console.error(`  ❌ Query failed: ${err.message}`);
    }
  }

  const output = {
    source: 'owner_archive',
    date: today(),
    posts: allPosts,
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`📁 Output written to ${outFile} (${allPosts.length} posts)`);
}

function collectWebSearch() {
  console.error('🌐 Web search mode — agent handles this directly');
  const output = {
    source: 'web_search',
    date: today(),
    note: 'Agent performs web search directly using web_search tool',
  };
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.error(`📁 Placeholder written to ${outFile}`);
}

async function main() {
  const mode = getMode();
  console.error(`🔥 Hot Take Collection — mode: ${mode}`);

  // For web_search mode, no DB/API needed
  if (mode === 'web_search') {
    collectWebSearch();
    return;
  }

  const { xClient, database, runtimeConfig } = await initSession({ sessionType: 'hottake' });

  try {
    // Check if hot takes are enabled
    if (runtimeConfig?.hotTake?.enabled === false || !config.HOT_TAKE_CONFIG.ENABLED) {
      console.error('⏸️ Hot Take sessions are disabled — exiting');
      await database.disconnect();
      return;
    }

    if (mode === 'x_trending') {
      await collectTrending(xClient);
    } else if (mode === 'owner_archive') {
      await collectOwnerArchive(xClient);
    } else {
      console.error(`❌ Unknown mode: ${mode}`);
      process.exit(1);
    }

    await database.disconnect();
  } catch (err) {
    console.error(`❌ Hot Take collection failed: ${err.message}`);
    await database.disconnect();
    process.exit(1);
  }
}

main();
