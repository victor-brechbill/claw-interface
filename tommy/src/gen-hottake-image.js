#!/usr/bin/env node

/**
 * Tommy Hot Take — Image Generation
 * 
 * Generates a visually striking image for the hot take using OpenAI Images API.
 * 
 * Usage: node src/gen-hottake-image.js --prompt "Your image prompt here"
 * 
 * Output: Prints the saved image file path to stdout.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const config = require('./config');

async function generateImage() {
  const args = process.argv.slice(2);
  const promptIdx = args.indexOf('--prompt');

  if (promptIdx === -1 || !args[promptIdx + 1]) {
    console.error('❌ Usage: node src/gen-hottake-image.js --prompt "Your image prompt"');
    process.exit(1);
  }

  const prompt = args[promptIdx + 1];
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not set in environment');
    process.exit(1);
  }

  const model = config.HOT_TAKE_CONFIG.IMAGE_MODEL || 'gpt-image-1';
  const size = config.HOT_TAKE_CONFIG.IMAGE_SIZE || '1024x1024';
  const imageStyle = config.HOT_TAKE_CONFIG.IMAGE_STYLE || 'abstract, futuristic, dark, thought-provoking';

  // Enhance prompt with style guidance
  const fullPrompt = `${prompt}. Style: ${imageStyle}. No text in the image.`;

  console.error(`🎨 Generating image with ${model} (${size})...`);
  console.error(`📝 Prompt: ${fullPrompt}`);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: fullPrompt,
        n: 1,
        size,
        output_format: 'png',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${error}`);
    }

    const result = await response.json();
    // gpt-image-1 returns base64 in result.data[0].b64_json (png/webp/jpeg output_format)
    const b64Data = result.data?.[0]?.b64_json || result.data?.[0]?.b64 || result.data?.[0]?.url || (typeof result.data?.[0] === 'string' ? result.data[0] : null);

    if (!b64Data) {
      throw new Error('No image data returned from OpenAI API');
    }

    // Save to /tmp with date-stamped filename
    const today = new Date().toISOString().split('T')[0];
    const outputPath = `/tmp/tommy-hottake-image-${today}.png`;

    const imageBuffer = Buffer.from(b64Data, 'base64');
    fs.writeFileSync(outputPath, imageBuffer);

    console.error(`✅ Image saved: ${outputPath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);

    // Output ONLY the file path to stdout (for piping)
    console.log(outputPath);
  } catch (err) {
    console.error(`❌ Image generation failed: ${err.message}`);
    process.exit(1);
  }
}

generateImage();
