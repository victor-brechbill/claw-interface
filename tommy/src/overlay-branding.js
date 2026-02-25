#!/usr/bin/env node

/**
 * Tommy Overlay Branding — Add ticker + DailyStockPick logo to images
 * 
 * Analyzes image brightness per quadrant to pick contrasting text/logo placement.
 * 
 * Usage: node src/overlay-branding.js --input /tmp/base.png --ticker RKLB --output /tmp/branded.png
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, '..', 'assets', 'dsp-logo.png');
const WATERMARK_TEXT = 'dailystockpick.ai';

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return (idx !== -1 && args[idx + 1]) ? args[idx + 1] : null;
}

/**
 * Analyze average brightness in each quadrant of the image.
 * Returns object with quadrant brightness values (0-255).
 */
async function analyzeQuadrants(imgPath) {
  const { data, info } = await sharp(imgPath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const midX = Math.floor(info.width / 2);
  const midY = Math.floor(info.height / 2);
  const channels = info.channels;

  const sums = { tl: 0, tr: 0, bl: 0, br: 0 };
  const counts = { tl: 0, tr: 0, bl: 0, br: 0 };

  // Sample every 4th pixel for speed
  for (let y = 0; y < info.height; y += 4) {
    for (let x = 0; x < info.width; x += 4) {
      const idx = (y * info.width + x) * channels;
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;

      const quadrant = (y < midY ? 't' : 'b') + (x < midX ? 'l' : 'r');
      sums[quadrant] += brightness;
      counts[quadrant] += 1;
    }
  }

  return {
    'top-left': sums.tl / (counts.tl || 1),
    'top-right': sums.tr / (counts.tr || 1),
    'bottom-left': sums.bl / (counts.bl || 1),
    'bottom-right': sums.br / (counts.br || 1),
  };
}

/**
 * Pick best quadrants for ticker and logo based on brightness contrast.
 */
function pickPlacements(quadrants) {
  // Sort quadrants by brightness
  const sorted = Object.entries(quadrants).sort((a, b) => a[1] - b[1]);

  // Ticker goes in darkest quadrant (white text), logo in lightest (or opposite corner)
  const tickerQuadrant = sorted[0][0]; // darkest
  const tickerBrightness = sorted[0][1];

  // Logo goes in opposite corner
  const opposites = {
    'top-left': 'bottom-right',
    'top-right': 'bottom-left',
    'bottom-left': 'top-right',
    'bottom-right': 'top-left',
  };
  const logoQuadrant = opposites[tickerQuadrant];
  const logoBrightness = quadrants[logoQuadrant];

  return {
    ticker: {
      quadrant: tickerQuadrant,
      textColor: tickerBrightness < 128 ? 'white' : 'black',
    },
    logo: {
      quadrant: logoQuadrant,
      textColor: logoBrightness < 128 ? 'white' : 'black',
    },
  };
}

/**
 * Get x,y position for a quadrant with padding.
 */
function getPosition(quadrant, imgWidth, imgHeight, elementWidth, elementHeight, padding = 40) {
  const positions = {
    'top-left': { x: padding, y: padding },
    'top-right': { x: imgWidth - elementWidth - padding, y: padding },
    'bottom-left': { x: padding, y: imgHeight - elementHeight - padding },
    'bottom-right': { x: imgWidth - elementWidth - padding, y: imgHeight - elementHeight - padding },
  };
  return positions[quadrant] || positions['top-left'];
}

/**
 * Create an SVG text element for the ticker.
 */
function createTickerSVG(ticker, color, width, height) {
  const fontSize = Math.min(width * 0.12, 160);
  const shadowColor = color === 'white' ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)';

  return Buffer.from(`
    <svg width="${width}" height="${Math.floor(fontSize * 1.4)}">
      <style>
        .ticker {
          font-family: Arial, Helvetica, sans-serif;
          font-weight: 900;
          font-size: ${fontSize}px;
          letter-spacing: 4px;
        }
      </style>
      <text x="4" y="${Math.floor(fontSize * 1.05)}" class="ticker" fill="${shadowColor}">$${ticker}</text>
      <text x="0" y="${Math.floor(fontSize * 1.0)}" class="ticker" fill="${color}">$${ticker}</text>
    </svg>
  `);
}

/**
 * Create an SVG watermark for dailystockpick.ai
 */
function createWatermarkSVG(color, width) {
  const fontSize = Math.min(width * 0.03, 32);
  const opacity = color === 'white' ? '0.8' : '0.6';

  return Buffer.from(`
    <svg width="${width}" height="${Math.floor(fontSize * 1.8)}">
      <style>
        .watermark {
          font-family: Arial, Helvetica, sans-serif;
          font-weight: 600;
          font-size: ${fontSize}px;
          opacity: ${opacity};
        }
      </style>
      <text x="0" y="${Math.floor(fontSize * 1.2)}" class="watermark" fill="${color}">${WATERMARK_TEXT}</text>
    </svg>
  `);
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = getArg(args, '--input');
  const ticker = getArg(args, '--ticker');
  const outputPath = getArg(args, '--output');

  if (!inputPath || !ticker || !outputPath) {
    console.error('❌ Usage: node src/overlay-branding.js --input base.png --ticker RKLB --output branded.png');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Input file not found: ${inputPath}`);
    process.exit(1);
  }

  console.error(`🎨 Overlaying branding on ${inputPath}...`);
  console.error(`📊 Ticker: $${ticker}`);

  // Get image dimensions
  const metadata = await sharp(inputPath).metadata();
  const { width, height } = metadata;
  console.error(`📐 Image: ${width}x${height}`);

  // Analyze brightness
  const quadrants = await analyzeQuadrants(inputPath);
  console.error(`💡 Brightness: TL=${quadrants['top-left'].toFixed(0)} TR=${quadrants['top-right'].toFixed(0)} BL=${quadrants['bottom-left'].toFixed(0)} BR=${quadrants['bottom-right'].toFixed(0)}`);

  const placements = pickPlacements(quadrants);
  console.error(`📍 Ticker: ${placements.ticker.quadrant} (${placements.ticker.textColor}), Logo: ${placements.logo.quadrant} (${placements.logo.textColor})`);

  // Create ticker overlay
  const tickerSVG = createTickerSVG(ticker, placements.ticker.textColor, width, height);
  const tickerMeta = await sharp(tickerSVG).metadata();
  const tickerPos = getPosition(placements.ticker.quadrant, width, height, tickerMeta.width, tickerMeta.height);

  // Create watermark overlay
  const watermarkSVG = createWatermarkSVG(placements.logo.textColor, width);
  const watermarkMeta = await sharp(watermarkSVG).metadata();
  const watermarkPos = getPosition(placements.logo.quadrant, width, height, watermarkMeta.width, watermarkMeta.height);

  // Build composite layers
  const composites = [
    { input: tickerSVG, left: tickerPos.x, top: tickerPos.y },
    { input: watermarkSVG, left: watermarkPos.x, top: watermarkPos.y },
  ];

  // Add logo if available
  if (fs.existsSync(LOGO_PATH)) {
    const logoSize = Math.min(width * 0.08, 80);
    const logoBuffer = await sharp(LOGO_PATH)
      .resize(logoSize, logoSize, { fit: 'inside' })
      .toBuffer();
    const logoMeta = await sharp(logoBuffer).metadata();

    // Position logo next to watermark text
    const logoPos = getPosition(placements.logo.quadrant, width, height, logoMeta.width + watermarkMeta.width + 10, logoMeta.height);

    composites.push({
      input: logoBuffer,
      left: Math.max(0, watermarkPos.x - logoMeta.width - 10),
      top: watermarkPos.y,
    });
  }

  // Composite everything
  await sharp(inputPath)
    .composite(composites)
    .png()
    .toFile(outputPath);

  console.error(`✅ Branded image saved: ${outputPath}`);
  console.log(outputPath);
}

main().catch(err => {
  console.error(`❌ Overlay failed: ${err.message}`);
  process.exit(1);
});
