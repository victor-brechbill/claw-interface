#!/usr/bin/env node
// retro.js — Gathers Tommy's past-week posts + engagement metrics for weekly retrospective
// Output: /tmp/tommy-retro-data.json

const { MongoClient } = require('mongodb');
const XAPIClient = require('./x-client');
const fs = require('fs');

const TOMMY_USERNAME = 'TommyPickles999';
const OUTPUT_PATH = '/tmp/tommy-retro-data.json';

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27018';
  const dbName = process.env.MONGODB_DATABASE || 'nova_dashboard_prod';

  const client = await MongoClient.connect(mongoUri);
  const db = client.db(dbName);

  console.log('📊 Tommy Weekly Retro — Data Gathering');

  // 1. Get all posts from past 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const posts = await db.collection('tommy_posts')
    .find({ postedAt: { $gte: weekAgo } })
    .sort({ postedAt: 1 })
    .toArray();

  console.log(`Found ${posts.length} posts from the past 7 days`);

  // 2. Fetch engagement metrics for each post
  const xClient = new XAPIClient();
  const enrichedPosts = [];

  for (const post of posts) {
    if (!post.postId) {
      enrichedPosts.push({ ...post, metrics: null });
      continue;
    }

    try {
      const metrics = await xClient.getTweetMetrics(post.postId);
      enrichedPosts.push({ ...post, metrics });

      if (metrics) {
        console.log(`  ✅ ${post.postId}: ${metrics.like_count}❤️  ${metrics.retweet_count}🔁  ${metrics.impression_count}👁️`);
      }
    } catch (err) {
      console.error(`  ❌ ${post.postId}: ${err.message}`);
      enrichedPosts.push({ ...post, metrics: null });
    }

    // Rate limit: respect API delay
    await new Promise(r => setTimeout(r, 1000));
  }

  // 3. Get current follower count
  let followerCount = null;
  try {
    followerCount = await xClient.getFollowerCount(TOMMY_USERNAME);
    console.log(`👤 Follower count: ${followerCount}`);
  } catch (err) {
    console.error(`Failed to get follower count: ${err.message}`);
  }

  // 4. Update engagementSnapshot in DB
  let updatedCount = 0;
  for (const post of enrichedPosts) {
    if (post.metrics && post.postId) {
      await db.collection('tommy_posts').updateOne(
        { postId: post.postId },
        { $set: { engagementSnapshot: post.metrics, engagementSnapshotAt: new Date() } }
      );
      updatedCount++;
    }
  }
  console.log(`💾 Updated ${updatedCount} posts with engagement snapshots`);

  // 5. Output JSON
  const output = {
    weekStart: weekAgo.toISOString(),
    weekEnd: new Date().toISOString(),
    followerCount,
    postCount: enrichedPosts.length,
    posts: enrichedPosts.map(p => ({
      postId: p.postId,
      postUrl: p.postUrl,
      text: p.text,
      type: p.type,
      ticker: p.ticker,
      postedAt: p.postedAt,
      quotedAuthor: p.quotedAuthor,
      metrics: p.metrics,
    })),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\n📝 Output written to ${OUTPUT_PATH}`);
  console.log(JSON.stringify({ postCount: output.postCount, followerCount }, null, 2));

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
