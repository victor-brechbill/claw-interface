#!/usr/bin/env node

/**
 * Tommy Image Generation — Thin wrapper around OpenAI Images API
 * 
 * No style injection. Tommy's prompt IS the prompt. Creative decisions
 * belong to Tommy, not this script.
 * 
 * Usage: node src/gen-image.js --prompt "Your full prompt" [--size 1024x1024] [--output /tmp/my-image.png]
 * 
 * Output: Prints the saved image file path to stdout.
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return (idx !== -1 && args[idx + 1]) ? args[idx + 1] : null;
}

async function generateImage() {
  const args = process.argv.slice(2);
  const prompt = getArg(args, '--prompt');
  const size = getArg(args, '--size') || '1024x1024';
  const output = getArg(args, '--output');

  if (!prompt) {
    console.error('❌ Usage: node src/gen-image.js --prompt "Your prompt" [--size 1024x1024] [--output /tmp/image.png]');
    process.exit(1);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not set in environment');
    process.exit(1);
  }

  const model = 'gpt-image-1';

  console.error(`🎨 Generating image with ${model} (${size})...`);
  console.error(`📝 Prompt: ${prompt.substring(0, 200)}${prompt.length > 200 ? '...' : ''}`);

  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt,
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
    const b64Data = result.data?.[0]?.b64_json
      || result.data?.[0]?.b64
      || (typeof result.data?.[0] === 'string' ? result.data[0] : null);

    if (!b64Data) {
      throw new Error('No image data returned from OpenAI API');
    }

    const today = new Date().toISOString().split('T')[0];
    const ts = Date.now();
    const outputPath = output || `/tmp/tommy-image-${today}-${ts}.png`;

    const imageBuffer = Buffer.from(b64Data, 'base64');
    fs.writeFileSync(outputPath, imageBuffer);

    console.error(`✅ Image saved: ${outputPath} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
    console.log(outputPath);
  } catch (err) {
    console.error(`❌ Image generation failed: ${err.message}`);
    process.exit(1);
  }
}

generateImage();
