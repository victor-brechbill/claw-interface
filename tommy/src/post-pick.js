#!/usr/bin/env node

/**
 * Tommy Post Pick — Post a DSP pick tweet with social image
 * 
 * Usage: node src/post-pick.js --text "post text" --image-path "/path/to/image.png"
 * 
 * RULE: No image = no post. If --image-path is missing or file doesn't exist, exit.
 */

const XAPIClient = require('./x-client');
const TommyDatabase = require('./db');
const config = require('./config');
const fs = require('fs');

async function postPick() {
  const args = process.argv.slice(2);
  
  const textIdx = args.indexOf('--text');
  const imageIdx = args.indexOf('--image-path');
  
  if (textIdx === -1 || !args[textIdx + 1]) {
    console.error('❌ --text is required');
    process.exit(1);
  }
  
  if (imageIdx === -1 || !args[imageIdx + 1]) {
    console.error('❌ --image-path is required. No image = no post.');
    process.exit(1);
  }
  
  const text = args[textIdx + 1];
  const imagePath = args[imageIdx + 1];
  
  if (!fs.existsSync(imagePath)) {
    console.error(`❌ Image not found: ${imagePath}. No image = no post.`);
    process.exit(1);
  }

  if (!config.POSTING_CONFIG.ENABLED) {
    console.error('⚠️ Posting is disabled (POSTING_ENABLED=false)');
    process.exit(0);
  }

  const xClient = new XAPIClient();
  const database = new TommyDatabase();

  try {
    await database.connect();
    xClient.setDatabase(database);

    // Load runtime config
    const runtimeConfig = await config.loadRuntimeConfig(database.db);
    let maxPickPostsPerDay = config.POSTING_CONFIG.MAX_PICK_POSTS_PER_DAY;
    let maxWords = config.POSTING_CONFIG.MAX_WORDS;
    if (runtimeConfig?.posting) {
      if (runtimeConfig.posting.enabled === false) {
        console.log('⏸️ Posting disabled via dashboard config');
        process.exit(0);
      }
      if (runtimeConfig.posting.maxPickPostsPerDay != null) maxPickPostsPerDay = runtimeConfig.posting.maxPickPostsPerDay;
      if (runtimeConfig.posting.maxWords != null) maxWords = runtimeConfig.posting.maxWords;
    }

    // Check daily pick post limit
    const today = new Date().toISOString().split('T')[0];
    const pickPostsToday = await database.countPostsToday('dsp_pick', today);
    if (pickPostsToday >= maxPickPostsPerDay) {
      console.log(`⏸️ Already posted ${pickPostsToday}/${maxPickPostsPerDay} pick posts today, skipping`);
      process.exit(0);
    }

    // Validate word count
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount > maxWords) {
      console.error(`⚠️ Post REJECTED: ${wordCount} words exceeds max of ${maxWords} — "${text}"`);
      process.exit(1);
    }
    console.log(`📝 Post validated: ${wordCount}/${maxWords} words`);

    console.log(`📸 Uploading image: ${imagePath}`);
    const mediaResult = await xClient.uploadMedia(imagePath);
    
    // uploadMedia returns mediaId string directly, not an object
    const mediaId = typeof mediaResult === 'string' ? mediaResult : mediaResult?.media_id_string;
    if (!mediaId) {
      console.error('❌ Media upload failed — no media_id returned. Aborting post.');
      process.exit(1);
    }
    
    console.log(`✅ Media uploaded: ${mediaId}`);
    console.log(`📝 Posting: "${text}"`);
    
    const tweetResult = await xClient.createTweetWithMedia(text, [mediaId]);
    
    if (tweetResult && tweetResult.data?.id) {
      const postId = tweetResult.data.id;
      console.log(`✅ Posted! https://x.com/i/status/${postId}`);
      
      // Save to DB
      await database.savePost({
        postId,
        text,
        type: 'dsp_pick',
        socialImagePath: imagePath,
        ticker: text.match(/\$([A-Z]{1,5})/)?.[1] || null,
      });

      // Self-reply with thesis link (best-effort, don't fail the flow)
      try {
        const todayDate = new Date().toISOString().split('T')[0];
        const replyText = `To read my full investment thesis visit: https://dailystockpick.ai/pick/${todayDate}`;
        const replyResult = await xClient.post(replyText, { replyTo: postId });
        if (replyResult?.data?.id) {
          console.log(`🔗 Self-reply posted: https://x.com/i/status/${replyResult.data.id}`);
        } else {
          console.warn('⚠️ Self-reply returned unexpected response:', JSON.stringify(replyResult));
        }
      } catch (replyErr) {
        console.error(`⚠️ Self-reply failed (non-fatal): ${replyErr.message}`);
      }
    } else {
      console.error('❌ Tweet creation failed — unexpected response:', JSON.stringify(tweetResult));
      process.exit(1);
    }

    await database.disconnect();
  } catch (err) {
    console.error(`❌ Post failed: ${err.message}`);
    await database.disconnect();
    process.exit(1);
  }
}

postPick();
