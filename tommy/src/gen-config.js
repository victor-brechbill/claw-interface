#!/usr/bin/env node

/**
 * gen-config.js — Dump runtime config from MongoDB as simple key=value pairs.
 * 
 * Tommy's cron job runs this first and reads the output to get current thresholds.
 * This way cron job instructions don't need to hardcode any values.
 * 
 * Usage: node src/gen-config.js
 * Output: /tmp/tommy-config.txt (key=value pairs)
 * 
 * Also outputs JSON to /tmp/tommy-config.json for programmatic use.
 */

const config = require('./config');
const { MongoClient } = require('mongodb');
const fs = require('fs');

async function main() {
  const client = new MongoClient(config.MONGODB.URI);
  
  try {
    await client.connect();
    const db = client.db(config.MONGODB.DATABASE);
    const runtimeConfig = await config.loadRuntimeConfig(db);
    
    // Merge runtime config over defaults
    const merged = {
      minScoreToLike: runtimeConfig?.ai?.minScoreToLike ?? config.AI_CONFIG.MIN_SCORE_TO_LIKE,
      minScoreToFollow: runtimeConfig?.ai?.minScoreToFollow ?? config.AI_CONFIG.MIN_SCORE_TO_FOLLOW,
      minScoreToPost: runtimeConfig?.ai?.minScoreToPost ?? config.AI_CONFIG.MIN_SCORE_TO_POST,
      minScoreToSave: runtimeConfig?.ai?.minScoreToSave ?? config.AI_CONFIG.MIN_SCORE_TO_SAVE,
      maxLikes: runtimeConfig?.explore?.maxLikes ?? config.SESSION_LIMITS.MAX_LIKES,
      maxFollows: runtimeConfig?.explore?.maxFollows ?? config.SESSION_LIMITS.MAX_FOLLOWS,
      maxSearches: runtimeConfig?.explore?.maxSearches ?? config.SESSION_LIMITS.MAX_SEARCHES,
      postingEnabled: runtimeConfig?.posting?.enabled ?? config.POSTING_CONFIG.ENABLED,
      maxQuoteRTsPerDay: runtimeConfig?.posting?.maxQuoteRTsPerDay ?? config.POSTING_CONFIG.MAX_QUOTE_RTS_PER_DAY,
      maxPickPostsPerDay: runtimeConfig?.posting?.maxPickPostsPerDay ?? config.POSTING_CONFIG.MAX_PICK_POSTS_PER_DAY,
      maxWords: runtimeConfig?.posting?.maxWords ?? config.POSTING_CONFIG.MAX_WORDS,
      // Market-specific
      marketMinScoreToLike: runtimeConfig?.market?.minScoreToLike ?? config.MARKET_SESSION.MIN_SCORE_TO_LIKE,
      marketMinScoreToDigest: runtimeConfig?.market?.minScoreToDigest ?? config.MARKET_SESSION.MIN_SCORE_TO_DIGEST,
      marketMaxSearches: runtimeConfig?.market?.maxSearches ?? config.MARKET_SESSION.MAX_SEARCHES,
      marketMaxLikes: runtimeConfig?.market?.maxLikes ?? config.MARKET_SESSION.MAX_LIKES,
      marketMinScoreToQuoteRT: runtimeConfig?.market?.minScoreToQuoteRT ?? config.MARKET_SESSION.MIN_SCORE_TO_QUOTE_RT,
      marketMaxQuoteRTs: runtimeConfig?.market?.maxQuoteRTs ?? config.MARKET_SESSION.MAX_QUOTE_RTS,
    };
    
    // Write key=value text file
    const lines = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync('/tmp/tommy-config.txt', lines + '\n');
    
    // Write JSON file
    fs.writeFileSync('/tmp/tommy-config.json', JSON.stringify(merged, null, 2) + '\n');
    
    // Print summary for cron job to capture
    console.log('📋 Tommy Config Loaded:');
    for (const [k, v] of Object.entries(merged)) {
      console.log(`  ${k}: ${v}`);
    }
    
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('❌ Failed to load config:', err.message);
  process.exit(1);
});
