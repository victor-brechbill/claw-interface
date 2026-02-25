#!/usr/bin/env node

/**
 * Tommy Collect Market — Fetch market-specific posts from X API
 * 
 * Fetches watchlist from Nova Dashboard, searches for each ticker,
 * fetches today's DSP pick + social image path.
 * Writes JSON to /tmp/tommy-market-collected.json
 */

const config = require('./config');
const { initSession } = require('./session-helper');
const fs = require('fs');
const https = require('https');
const http = require('http');

const outFile = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/tommy-market-collected.json';

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        res.resume();
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
      file.on('error', (err) => { fs.unlink(destPath, () => {}); reject(err); });
    }).on('error', reject);
  });
}

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    }).on('error', reject);
  });
}

async function collect() {
  const collectedPosts = [];
  const userIndex = {};

  const { xClient, database, session, runtimeConfig } = await initSession({ sessionType: 'market' });

  try {
    if (runtimeConfig?.market) {
      if (runtimeConfig.market.maxSearches != null) config.MARKET_SESSION.MAX_SEARCHES = runtimeConfig.market.maxSearches;
      if (runtimeConfig.market.maxSearchResults != null) config.MARKET_SESSION.MAX_SEARCH_RESULTS = runtimeConfig.market.maxSearchResults;
    }
    console.error(`📋 Runtime config loaded: maxSearches=${config.MARKET_SESSION.MAX_SEARCHES}, maxResults=${config.MARKET_SESSION.MAX_SEARCH_RESULTS}`);

    // Fetch watchlist from Nova Dashboard
    console.error('📋 Fetching watchlist from dashboard...');
    let tickers = [];
    const watchlistData = await fetchJSON('http://localhost:3080/api/stocks/watchlist');
    if (!Array.isArray(watchlistData) || watchlistData.length === 0) {
      throw new Error('Failed to fetch watchlist from dashboard Stocks tab — no tickers available');
    }
    tickers = watchlistData.map(w => w.symbol).filter(Boolean);
    console.error(`📋 Watchlist: ${tickers.join(', ')}`);

    // Fetch today's DSP pick
    let dspPick = null;
    let socialImagePath = null; // Tommy generates this himself now via image-gen skill
    console.error('🎯 Fetching DSP pick...');
    try {
      const pickData = await fetchJSON(`${config.DSP_API_URL}/api/stock/today`);
      if (pickData && pickData.ticker) {
        dspPick = pickData;
        if (!tickers.includes(pickData.ticker)) {
          tickers.push(pickData.ticker);
        }
        console.error(`🎯 Today's DSP pick: $${pickData.ticker}`);
        // Note: socialImagePath stays null. Tommy generates the image himself
        // using the image-gen skill + overlay-branding.js during the market session.
      }
    } catch (err) {
      console.error(`⚠️ No DSP pick today: ${err.message}`);
    }

    // Search X for each ticker
    console.error('🔍 Searching X for tickers...');
    for (const ticker of tickers.slice(0, config.MARKET_SESSION.MAX_SEARCHES)) {
      try {
        // Alternate: verified financial content + niche discovery
        const isDiscovery = tickers.indexOf(ticker) % 2 === 1;
        const query = isDiscovery
          ? `$${ticker} -is:retweet`                       // niche: catch foreign analysts, small accounts
          : `$${ticker} is:verified -is:retweet lang:en`;  // quality: verified English finance content
        const searchResponse = await xClient.searchRecent(query, config.MARKET_SESSION.MAX_SEARCH_RESULTS);
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
          post._ticker = ticker;
          if (!collectedPosts.find(p => p.id === post.id)) {
            collectedPosts.push(post);
          }
          if (post._authorUsername) {
            userIndex[post.author_id] = { username: post._authorUsername, name: post._authorName || '' };
          }
        }
        console.error(`  🔎 $${ticker}: ${results.length} results`);
        await new Promise(r => setTimeout(r, config.RATE_LIMITS.SEARCH_DELAY_MS));
      } catch (err) {
        console.error(`  ❌ $${ticker} search failed: ${err.message}`);
      }
    }

    console.error(`✅ Collection complete: ${collectedPosts.length} posts across ${tickers.length} tickers`);

    const output = {
      sessionId: session.sessionId,
      sessionType: 'market',
      collectedAt: new Date().toISOString(),
      tickers,
      postCount: collectedPosts.length,
      dspPick: dspPick ? { ticker: dspPick.ticker, company: dspPick.companyName || dspPick.company, thesis: dspPick.thesis } : null,
      socialImagePath,
      posts: collectedPosts.map((p, i) => ({
        i,
        id: p.id,
        text: (p.text || '').slice(0, 500),
        ticker: p._ticker,
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
    };

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
