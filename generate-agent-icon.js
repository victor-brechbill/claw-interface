// Generate Agent Avatar SVG using the exact same algorithms from AgentAvatar.tsx
// VERSION 4

const width = 512;
const height = 512;
const centerX = width / 2;
const centerY = height / 2 - height * 0.05;
const faceRadius = Math.min(width, height) * 0.35;

const teal = { r: 64, g: 224, b: 208 };

let seed = 12345;
function seededRandom() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function generateRingStars() {
  const stars = [];
  
  for (let layer = 0; layer < 4; layer++) {
    const layerRadius = faceRadius - layer * 8 + (seededRandom() - 0.5) * 4;
    const pointCount = 55 - layer * 10;
    
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2 + layer * 0.1;
      const radiusVariation = (seededRandom() - 0.5) * 12;
      const r = layerRadius + radiusVariation;
      
      stars.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
        size: seededRandom() * 2 + 1,
        brightness: 0.7 + seededRandom() * 0.3,
        layer
      });
    }
  }
  
  for (let i = 0; i < 50; i++) {
    const angle = seededRandom() * Math.PI * 2;
    const distFromRing = seededRandom() * 30 + 5;
    const r = faceRadius + distFromRing;
    
    stars.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r,
      size: seededRandom() * 1.5 + 0.5,
      brightness: 0.4 + seededRandom() * 0.4,
      layer: 4
    });
  }
  
  return stars;
}

function generateStaticConnections() {
  const connections = [];
  const points = [];
  
  for (let i = 0; i < 160; i++) {
    const angle = seededRandom() * Math.PI * 2;
    const radiusMultiplier = 0.85 + seededRandom() * 0.5;
    const r = faceRadius * radiusMultiplier;
    points.push({
      x: centerX + Math.cos(angle) * r,
      y: centerY + Math.sin(angle) * r
    });
  }
  
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > 12 && dist < 70 && seededRandom() < 0.36) {
        connections.push({
          x1: points[i].x,
          y1: points[i].y,
          x2: points[j].x,
          y2: points[j].y,
          opacity: 0.3 + seededRandom() * 0.2
        });
      }
    }
  }
  
  return { connections, points };
}

function generateAnimatedConnections(stars) {
  const connections = [];
  
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      const dx = stars[i].x - stars[j].x;
      const dy = stars[i].y - stars[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist > 10 && dist < 40 && seededRandom() < 0.25) {
        connections.push({
          from: i,
          to: j,
          opacity: 0.4 + seededRandom() * 0.3
        });
      }
    }
  }
  
  return connections;
}

function generateMouthStars() {
  const stars = [];
  const mouthY = centerY + faceRadius * 0.2;
  const mouthWidth = faceRadius * 0.18;
  const mouthDepth = faceRadius * 0.12;
  
  for (let i = 0; i < 10; i++) {
    const t = i / 9 - 0.5;
    const x = centerX + t * mouthWidth * 2;
    const y = mouthY + (1 - Math.pow(t * 2, 2)) * mouthDepth;
    stars.push({
      x,
      y,
      size: seededRandom() * 1 + 0.6,
      brightness: 0.45 + seededRandom() * 0.25
    });
  }
  
  return stars;
}

function generateSVG() {
  const ringStars = generateRingStars();
  const { connections: staticConns, points: staticPoints } = generateStaticConnections();
  const animatedConns = generateAnimatedConnections(ringStars);
  const mouthStars = generateMouthStars();
  
  const eyeY = centerY - faceRadius * 0.15;
  const eyeSpacing = faceRadius * 0.38;
  const leftEyeX = centerX - eyeSpacing;
  const rightEyeX = centerX + eyeSpacing;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <!-- Radial gradient: large black center (encompassing eyes), teal at edges only -->
    <radialGradient id="bgGrad" cx="50%" cy="45%" r="75%">
      <stop offset="0%" style="stop-color:#050D12"/>
      <stop offset="55%" style="stop-color:#050D12"/>
      <stop offset="75%" style="stop-color:#102C2E"/>
      <stop offset="100%" style="stop-color:#1B5353"/>
    </radialGradient>
    <radialGradient id="eyeGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#ffffff"/>
      <stop offset="20%" style="stop-color:#dcfffa"/>
      <stop offset="40%" style="stop-color:#96f0e6"/>
      <stop offset="60%" style="stop-color:rgba(64,224,208,0.35)"/>
      <stop offset="80%" style="stop-color:rgba(64,224,208,0.15)"/>
      <stop offset="100%" style="stop-color:rgba(64,224,208,0)"/>
    </radialGradient>
    <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:rgba(64,224,208,1)"/>
      <stop offset="50%" style="stop-color:rgba(64,224,208,0.3)"/>
      <stop offset="100%" style="stop-color:rgba(64,224,208,0)"/>
    </radialGradient>
    <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="1.5" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <rect width="${width}" height="${height}" rx="96" fill="url(#bgGrad)"/>
  
  <!-- Background stars -->
  <g fill="white">
`;

  // Generate background stars (light speckling)
  for (let i = 0; i < 45; i++) {
    const x = seededRandom() * width;
    const y = seededRandom() * height;
    const size = seededRandom() * 1.2 + 0.3;
    const opacity = seededRandom() * 0.4 + 0.15;
    svg += `    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size.toFixed(1)}" opacity="${opacity.toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g stroke="rgb(${teal.r},${teal.g},${teal.b})" stroke-width="0.5" fill="none">
`;

  for (const conn of staticConns) {
    svg += `    <line x1="${conn.x1.toFixed(1)}" y1="${conn.y1.toFixed(1)}" x2="${conn.x2.toFixed(1)}" y2="${conn.y2.toFixed(1)}" opacity="${conn.opacity.toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g fill="rgb(${teal.r},${teal.g},${teal.b})">
`;

  const usedIndices = new Set();
  for (const conn of staticConns) {
    for (let i = 0; i < staticPoints.length; i++) {
      if (Math.abs(staticPoints[i].x - conn.x1) < 1 && Math.abs(staticPoints[i].y - conn.y1) < 1) usedIndices.add(i);
      if (Math.abs(staticPoints[i].x - conn.x2) < 1 && Math.abs(staticPoints[i].y - conn.y2) < 1) usedIndices.add(i);
    }
  }
  for (const idx of usedIndices) {
    const pt = staticPoints[idx];
    const size = 0.8 + seededRandom() * 1.2;
    svg += `    <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${size.toFixed(1)}" opacity="${(0.25 + seededRandom() * 0.2).toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g stroke="rgb(${teal.r},${teal.g},${teal.b})" stroke-width="1" fill="none" stroke-linecap="round">
`;

  for (const conn of animatedConns) {
    const from = ringStars[conn.from];
    const to = ringStars[conn.to];
    svg += `    <line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" opacity="${conn.opacity.toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g fill="rgb(${teal.r},${teal.g},${teal.b})" filter="url(#glow)">
`;

  for (const star of ringStars) {
    svg += `    <circle cx="${star.x.toFixed(1)}" cy="${star.y.toFixed(1)}" r="${star.size.toFixed(1)}" opacity="${star.brightness.toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g stroke="rgb(${teal.r},${teal.g},${teal.b})" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.5">
`;

  for (let i = 0; i < mouthStars.length - 1; i++) {
    const from = mouthStars[i];
    const to = mouthStars[i + 1];
    svg += `    <line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g fill="rgb(${teal.r},${teal.g},${teal.b})" filter="url(#glow)">
`;

  for (const star of mouthStars) {
    svg += `    <circle cx="${star.x.toFixed(1)}" cy="${star.y.toFixed(1)}" r="${star.size.toFixed(1)}" opacity="${star.brightness.toFixed(2)}"/>\n`;
  }
  
  svg += `  </g>
  
  <g>
    <circle cx="${leftEyeX.toFixed(1)}" cy="${eyeY.toFixed(1)}" r="33" fill="url(#eyeGlow)"/>
    <circle cx="${leftEyeX.toFixed(1)}" cy="${eyeY.toFixed(1)}" r="7" fill="#ffffff"/>
    <circle cx="${rightEyeX.toFixed(1)}" cy="${eyeY.toFixed(1)}" r="33" fill="url(#eyeGlow)"/>
    <circle cx="${rightEyeX.toFixed(1)}" cy="${eyeY.toFixed(1)}" r="7" fill="#ffffff"/>
  </g>
</svg>`;

  return svg;
}

seed = 12345;
console.log(generateSVG());
