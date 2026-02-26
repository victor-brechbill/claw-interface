import React, { useRef, useEffect, useCallback, useState } from "react";

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

interface ConnectionLine {
  from: number;
  to: number;
  baseOpacity: number;
  drawPhase: number; // Current phase in the draw animation (0-2: 0-1 drawing, 1-2 retracting)
  drawSpeed: number; // How fast this line draws
  drawDirection: number; // 1 = forward, -1 = backward (which end draws first)
}

export type Expression = "neutral" | "happy" | "busy" | "curious" | "sleepy";

interface AgentAvatarProps {
  width?: number;
  height?: number;
  expression?: Expression;
}

const AgentAvatar: React.FC<AgentAvatarProps> = ({
  width = 400,
  height = 400,
  expression = "neutral",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);

  interface StaticConnection {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    opacity: number;
  }

  interface BackgroundStar {
    x: number;
    y: number;
    size: number;
    brightness: number;
  }

  const stateRef = useRef({
    ringStars: [] as Star[],
    mouthStars: [] as Star[],
    connections: [] as ConnectionLine[],
    mouthConnections: [] as ConnectionLine[],
    staticConnections: [] as StaticConnection[], // Fixed background layer
    backgroundStars: [] as BackgroundStar[], // Stars at connection nodes
    blinkState: 1,
    lastBlink: 0, // Will be initialized in useEffect
    nextBlinkAt: 0, // Will be initialized in useEffect
    initialized: false,
    // Animation state for smooth transitions
    currentOffsetX: 0,
    currentOffsetY: 0,
    targetOffsetX: 0,
    targetOffsetY: 0,
    currentExpression: "neutral" as Expression,
    transitionProgress: 1, // 0 = start of transition, 1 = complete
  });

  // Load background image
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      setBgLoaded(true);
    };
    img.src = "/agent-bg.jpg";
  }, []);

  // Initialize timing values on mount
  useEffect(() => {
    const now = Date.now();
    stateRef.current.lastBlink = now;
    stateRef.current.nextBlinkAt = now + 3000 + Math.random() * 4000;
  }, []);

  // Generate mouth stars based on expression
  const generateMouthStars = useCallback(
    (
      centerX: number,
      centerY: number,
      faceRadius: number,
      expr: Expression,
    ): { stars: Star[]; connections: ConnectionLine[] } => {
      const stars: Star[] = [];
      const connections: ConnectionLine[] = [];
      const mouthY = centerY + faceRadius * 0.2; // Adjusted for face shift

      switch (expr) {
        case "happy": {
          // Same tight U-shape as neutral, but position will be shifted up in drawing
          const mouthWidth = faceRadius * 0.2;
          const mouthDepth = faceRadius * 0.14;
          for (let i = 0; i < 12; i++) {
            const t = i / 11 - 0.5;
            const x = centerX + t * mouthWidth * 2;
            const y = mouthY + (1 - Math.pow(t * 2, 2)) * mouthDepth;
            stars.push({
              x,
              y,
              size: Math.random() * 1.2 + 0.8,
              brightness: 0.5 + Math.random() * 0.3,
              twinkleSpeed: Math.random() * 0.002 + 0.001,
              twinklePhase: Math.random() * Math.PI * 2,
            });
          }
          break;
        }

        case "busy": {
          for (let i = 0; i < 6; i++) {
            const t = i / 5 - 0.5;
            stars.push({
              x: centerX + t * faceRadius * 0.25,
              y: mouthY + 5,
              size: Math.random() * 1 + 0.6,
              brightness: 0.4 + Math.random() * 0.2,
              twinkleSpeed: Math.random() * 0.002 + 0.001,
              twinklePhase: Math.random() * Math.PI * 2,
            });
          }
          break;
        }

        case "curious": {
          for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            const radius = 6;
            stars.push({
              x: centerX + Math.cos(angle) * radius,
              y: mouthY + 8 + Math.sin(angle) * radius,
              size: Math.random() * 0.8 + 0.5,
              brightness: 0.4 + Math.random() * 0.2,
              twinkleSpeed: Math.random() * 0.002 + 0.001,
              twinklePhase: Math.random() * Math.PI * 2,
            });
          }
          break;
        }

        case "sleepy": {
          for (let i = 0; i < 5; i++) {
            const t = i / 4 - 0.5;
            stars.push({
              x: centerX + t * faceRadius * 0.2,
              y: mouthY + 5 + Math.abs(t) * 3,
              size: Math.random() * 0.8 + 0.4,
              brightness: 0.3 + Math.random() * 0.2,
              twinkleSpeed: Math.random() * 0.002 + 0.001,
              twinklePhase: Math.random() * Math.PI * 2,
            });
          }
          break;
        }

        case "neutral":
        default: {
          // Tighter U-shaped smile - more kawaii
          const mouthWidth = faceRadius * 0.18; // Narrower
          const mouthDepth = faceRadius * 0.12; // Deeper U
          for (let i = 0; i < 10; i++) {
            const t = i / 9 - 0.5;
            const x = centerX + t * mouthWidth * 2;
            const y = mouthY + (1 - Math.pow(t * 2, 2)) * mouthDepth;
            stars.push({
              x,
              y,
              size: Math.random() * 1 + 0.6,
              brightness: 0.45 + Math.random() * 0.25,
              twinkleSpeed: Math.random() * 0.002 + 0.001,
              twinklePhase: Math.random() * Math.PI * 2,
            });
          }
          break;
        }
      }

      // Generate connections between mouth stars
      for (let i = 0; i < stars.length - 1; i++) {
        connections.push({
          from: i,
          to: i + 1,
          baseOpacity: 0.3 + Math.random() * 0.2,
          drawPhase: Math.random() * 2,
          drawSpeed: 0.003 + Math.random() * 0.002,
          drawDirection: Math.random() > 0.5 ? 1 : -1,
        });
      }

      return { stars, connections };
    },
    [],
  );

  // Initialize ring stars and connections
  const initialize = useCallback(() => {
    const centerX = width / 2;
    const centerY = height / 2 - height * 0.05; // Shift face up 5%
    const faceRadius = Math.min(width, height) * 0.35;

    // Ring stars - dense perimeter
    const rStars: Star[] = [];

    for (let layer = 0; layer < 4; layer++) {
      const layerRadius = faceRadius - layer * 8 + (Math.random() - 0.5) * 4;
      const pointCount = 55 - layer * 10;

      for (let i = 0; i < pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2 + layer * 0.1;
        const radiusVariation = (Math.random() - 0.5) * 12;
        const r = layerRadius + radiusVariation;

        rStars.push({
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r,
          size: Math.random() * 2 + 1,
          brightness: 0.7 + Math.random() * 0.3,
          twinkleSpeed: Math.random() * 0.003 + 0.001,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
    }

    // Outer aura
    for (let i = 0; i < 50; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distFromRing = Math.random() * 30 + 5;
      const r = faceRadius + distFromRing;

      rStars.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
        size: Math.random() * 1.5 + 0.5,
        brightness: 0.4 + Math.random() * 0.4,
        twinkleSpeed: Math.random() * 0.004 + 0.001,
        twinklePhase: Math.random() * Math.PI * 2,
      });
    }

    // Generate STATIC connections layer - background web outside face area
    // These create a background web, with stars at nodes
    interface StaticConnection {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      opacity: number;
    }
    const staticConns: StaticConnection[] = [];

    // Generate points for static layer - keep away from face (0.85 to 1.35 of faceRadius)
    const staticPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < 160; i++) {
      // Slightly fewer points
      const angle = Math.random() * Math.PI * 2;
      const radiusMultiplier = 0.85 + Math.random() * 0.5; // 0.85 to 1.35 of faceRadius
      const r = faceRadius * radiusMultiplier;
      staticPoints.push({
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
      });
    }

    // Track which points are used in connections (for star rendering)
    const usedPoints = new Set<number>();

    // Connect nearby static points - reduced by 20% (0.45 -> 0.36)
    for (let i = 0; i < staticPoints.length; i++) {
      for (let j = i + 1; j < staticPoints.length; j++) {
        const dx = staticPoints[i].x - staticPoints[j].x;
        const dy = staticPoints[i].y - staticPoints[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 12 && dist < 70 && Math.random() < 0.36) {
          // Reduced by 20%
          staticConns.push({
            x1: staticPoints[i].x,
            y1: staticPoints[i].y,
            x2: staticPoints[j].x,
            y2: staticPoints[j].y,
            opacity: 0.3 + Math.random() * 0.2,
          });
          usedPoints.add(i);
          usedPoints.add(j);
        }
      }
    }

    // Create background stars at connection nodes
    interface BackgroundStar {
      x: number;
      y: number;
      size: number;
      brightness: number;
    }
    const bgStars: BackgroundStar[] = [];
    usedPoints.forEach((idx) => {
      const pt = staticPoints[idx];
      bgStars.push({
        x: pt.x,
        y: pt.y,
        size: 0.8 + Math.random() * 1.2,
        brightness: 0.25 + Math.random() * 0.2,
      });
    });

    // Generate ANIMATED connections with draw animation properties
    const conns: ConnectionLine[] = [];
    for (let i = 0; i < rStars.length; i++) {
      for (let j = i + 1; j < rStars.length; j++) {
        const dx = rStars[i].x - rStars[j].x;
        const dy = rStars[i].y - rStars[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 10 && dist < 40 && Math.random() < 0.25) {
          conns.push({
            from: i,
            to: j,
            baseOpacity: 0.4 + Math.random() * 0.3, // Brighter base opacity
            drawPhase: Math.random() * 2, // Random starting phase
            drawSpeed: 0.002 + Math.random() * 0.003, // Variable speeds
            drawDirection: Math.random() > 0.5 ? 1 : -1,
          });
        }
      }
    }

    // Generate mouth
    const mouth = generateMouthStars(centerX, centerY, faceRadius, expression);

    stateRef.current = {
      ringStars: rStars,
      mouthStars: mouth.stars,
      connections: conns,
      mouthConnections: mouth.connections,
      staticConnections: staticConns,
      backgroundStars: bgStars,
      blinkState: 1,
      lastBlink: Date.now(),
      nextBlinkAt: Date.now() + 3000 + Math.random() * 4000,
      initialized: true,
      currentOffsetX: 0,
      currentOffsetY: 0,
      targetOffsetX: 0,
      targetOffsetY: 0,
      currentExpression: expression,
      transitionProgress: 1,
    };
  }, [width, height, expression, generateMouthStars]);

  // Reinitialize mouth when expression changes
  useEffect(() => {
    if (stateRef.current.initialized) {
      const centerX = width / 2;
      const centerY = height / 2 - height * 0.05; // Shift face up 5%
      const faceRadius = Math.min(width, height) * 0.35;
      const mouth = generateMouthStars(
        centerX,
        centerY,
        faceRadius,
        expression,
      );
      stateRef.current.mouthStars = mouth.stars;
      stateRef.current.mouthConnections = mouth.connections;
    }
  }, [expression, width, height, generateMouthStars]);

  // Main animation loop
  useEffect(() => {
    if (!stateRef.current.initialized) {
      initialize();
    }

    const animate = (timestamp: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const state = stateRef.current;
      const centerX = width / 2;
      const centerY = height / 2 - height * 0.05; // Shift face up 5%
      const faceRadius = Math.min(width, height) * 0.35;

      // Clear and draw background
      ctx.clearRect(0, 0, width, height);

      if (bgImageRef.current && bgLoaded) {
        const img = bgImageRef.current;
        const scale = Math.max(width / img.width, height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        ctx.drawImage(img, x, y, w, h);

        // Darken center area
        const vignette = ctx.createRadialGradient(
          centerX,
          centerY,
          0,
          centerX,
          centerY,
          faceRadius * 1.5,
        );
        vignette.addColorStop(0, "rgba(0, 0, 0, 0.3)");
        vignette.addColorStop(0.7, "rgba(0, 0, 0, 0.1)");
        vignette.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, width, height);
      }

      // Handle expression transitions
      // Calculate target offsets based on expression
      let targetX = 0;
      let targetY = 0;
      if (expression === "happy") {
        targetY = -height * 0.05;
      } else if (expression === "curious") {
        targetX = width * 0.05;
        targetY = -height * 0.05;
      }

      // Detect expression change and start transition
      if (state.currentExpression !== expression) {
        state.currentExpression = expression;
        state.targetOffsetX = targetX;
        state.targetOffsetY = targetY;
        state.transitionProgress = 0;
      }

      // Smoothly animate toward target (ease-out)
      const transitionSpeed = 0.04; // Adjust for faster/slower transitions
      if (state.transitionProgress < 1) {
        state.transitionProgress = Math.min(
          1,
          state.transitionProgress + transitionSpeed,
        );
        const easeOut = 1 - Math.pow(1 - state.transitionProgress, 3); // Cubic ease-out

        state.currentOffsetX =
          state.currentOffsetX +
          (state.targetOffsetX - state.currentOffsetX) * easeOut * 0.1;
        state.currentOffsetY =
          state.currentOffsetY +
          (state.targetOffsetY - state.currentOffsetY) * easeOut * 0.1;
      } else {
        // Snap to target when transition complete
        state.currentOffsetX +=
          (state.targetOffsetX - state.currentOffsetX) * 0.1;
        state.currentOffsetY +=
          (state.targetOffsetY - state.currentOffsetY) * 0.1;
      }

      // Handle blinking
      const now = Date.now();
      if (expression !== "happy" && expression !== "sleepy") {
        if (now >= state.nextBlinkAt) {
          state.blinkState = 0;
          setTimeout(
            () => {
              state.blinkState = 1;
            },
            120 + Math.random() * 60,
          );
          state.nextBlinkAt = now + 2500 + Math.random() * 4000;
        }
      }

      // Subtle drift for ring (NOT affected by expression)
      const driftX = Math.sin(timestamp * 0.0004) * 2;
      const driftY = Math.cos(timestamp * 0.0003) * 1.5;

      // Expression offset for eyes and mouth only
      const exprOffsetX = state.currentOffsetX;
      const exprOffsetY = state.currentOffsetY;

      const teal = { r: 64, g: 224, b: 208 };

      // Draw STATIC connection lines first (background layer)
      state.staticConnections.forEach((conn) => {
        ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${conn.opacity})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(conn.x1 + driftX, conn.y1 + driftY);
        ctx.lineTo(conn.x2 + driftX, conn.y2 + driftY);
        ctx.stroke();
      });

      // Draw background stars at connection nodes
      state.backgroundStars.forEach((star) => {
        const x = star.x + driftX;
        const y = star.y + driftY;

        // Subtle glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, star.size * 3);
        gradient.addColorStop(
          0,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${star.brightness})`,
        );
        gradient.addColorStop(1, `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, star.size * 3, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${star.brightness * 0.8})`;
        ctx.beginPath();
        ctx.arc(x, y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw ANIMATED connection lines with "drawing" animation
      state.connections.forEach((conn) => {
        if (
          conn.from >= state.ringStars.length ||
          conn.to >= state.ringStars.length
        )
          return;

        const fromStar = state.ringStars[conn.from];
        const toStar = state.ringStars[conn.to];

        // Update draw phase
        conn.drawPhase += conn.drawSpeed;
        if (conn.drawPhase >= 2) conn.drawPhase = 0;

        // Calculate how much of the line to draw
        // Phase 0-1: drawing (0% to 100%)
        // Phase 1-2: retracting (100% to 0%)
        let drawProgress: number;
        let startOffset: number;

        if (conn.drawPhase < 1) {
          // Drawing phase: line grows from start to end
          drawProgress = conn.drawPhase;
          startOffset = 0;
        } else {
          // Retracting phase: line shrinks from start
          drawProgress = 1;
          startOffset = conn.drawPhase - 1;
        }

        if (drawProgress <= startOffset) return; // Nothing to draw

        const x1 = fromStar.x + driftX;
        const y1 = fromStar.y + driftY;
        const x2 = toStar.x + driftX;
        const y2 = toStar.y + driftY;

        // Calculate actual line segment to draw
        let startX, startY, endX, endY;
        if (conn.drawDirection > 0) {
          startX = x1 + (x2 - x1) * startOffset;
          startY = y1 + (y2 - y1) * startOffset;
          endX = x1 + (x2 - x1) * drawProgress;
          endY = y1 + (y2 - y1) * drawProgress;
        } else {
          startX = x2 + (x1 - x2) * startOffset;
          startY = y2 + (y1 - y2) * startOffset;
          endX = x2 + (x1 - x2) * drawProgress;
          endY = y2 + (y1 - y2) * drawProgress;
        }

        ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${conn.baseOpacity})`;
        ctx.lineWidth = 1;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      });

      // Draw ring stars
      state.ringStars.forEach((star) => {
        const x = star.x + driftX;
        const y = star.y + driftY;
        const twinkle =
          Math.sin(timestamp * star.twinkleSpeed + star.twinklePhase) * 0.2 +
          0.8;
        const alpha = star.brightness * twinkle;

        // Glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, star.size * 4);
        gradient.addColorStop(
          0,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha})`,
        );
        gradient.addColorStop(
          0.5,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha * 0.3})`,
        );
        gradient.addColorStop(1, `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, star.size * 4, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw mouth connections with same animation
      // Mouth uses drift + expression offset
      state.mouthConnections.forEach((conn) => {
        if (
          conn.from >= state.mouthStars.length ||
          conn.to >= state.mouthStars.length
        )
          return;

        const fromStar = state.mouthStars[conn.from];
        const toStar = state.mouthStars[conn.to];

        conn.drawPhase += conn.drawSpeed;
        if (conn.drawPhase >= 2) conn.drawPhase = 0;

        let drawProgress: number;
        let startOffset: number;

        if (conn.drawPhase < 1) {
          drawProgress = conn.drawPhase;
          startOffset = 0;
        } else {
          drawProgress = 1;
          startOffset = conn.drawPhase - 1;
        }

        if (drawProgress <= startOffset) return;

        const x1 = fromStar.x + driftX + exprOffsetX;
        const y1 = fromStar.y + driftY + exprOffsetY;
        const x2 = toStar.x + driftX + exprOffsetX;
        const y2 = toStar.y + driftY + exprOffsetY;

        let startX, startY, endX, endY;
        if (conn.drawDirection > 0) {
          startX = x1 + (x2 - x1) * startOffset;
          startY = y1 + (y2 - y1) * startOffset;
          endX = x1 + (x2 - x1) * drawProgress;
          endY = y1 + (y2 - y1) * drawProgress;
        } else {
          startX = x2 + (x1 - x2) * startOffset;
          startY = y2 + (y1 - y2) * startOffset;
          endX = x2 + (x1 - x2) * drawProgress;
          endY = y2 + (y1 - y2) * drawProgress;
        }

        ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${conn.baseOpacity})`;
        ctx.lineWidth = 0.8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      });

      // Draw mouth stars (with expression offset)
      state.mouthStars.forEach((star) => {
        const x = star.x + driftX + exprOffsetX;
        const y = star.y + driftY + exprOffsetY;
        const twinkle =
          Math.sin(timestamp * star.twinkleSpeed + star.twinklePhase) * 0.2 +
          0.8;
        const alpha = star.brightness * twinkle;

        const gradient = ctx.createRadialGradient(x, y, 0, x, y, star.size * 3);
        gradient.addColorStop(
          0,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha})`,
        );
        gradient.addColorStop(1, `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, star.size * 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.arc(x, y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // Draw eyes - positioned higher and wider apart
      // Eyes use drift + expression offset
      const eyeY = centerY - faceRadius * 0.15 + driftY + exprOffsetY;
      const eyeSpacing = faceRadius * 0.38; // Wider apart
      const leftEyeX = centerX - eyeSpacing + driftX + exprOffsetX;
      const rightEyeX = centerX + eyeSpacing + driftX + exprOffsetX;

      // Improved eye glow: friendly larger center, smooth gradient from 100% to 0%
      const drawEyeGlow = (
        x: number,
        y: number,
        coreSize: number,
        glowSize: number,
        alpha: number = 1,
      ) => {
        // Outer glow - starts at full opacity, fades to 0
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
        gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`); // Bright white center
        gradient.addColorStop(0.2, `rgba(220, 255, 250, ${alpha * 0.9})`);
        gradient.addColorStop(0.4, `rgba(150, 240, 230, ${alpha * 0.6})`);
        gradient.addColorStop(
          0.6,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha * 0.35})`,
        );
        gradient.addColorStop(
          0.8,
          `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${alpha * 0.15})`,
        );
        gradient.addColorStop(1, `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Larger friendly bright core
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, coreSize, 0, Math.PI * 2);
        ctx.fill();
      };

      switch (expression) {
        case "happy": {
          // Happy: semi-circle eyes (position animated via driftX/driftY)
          const happyBlinkCycle = (timestamp * 0.0001) % 1;
          const happyBlink = happyBlinkCycle > 0.95 ? 0.6 : 1;

          // Draw semi-circle eyes (curved arcs, not dots)
          [leftEyeX, rightEyeX].forEach((ex) => {
            // Glow behind the arc
            const gradient = ctx.createRadialGradient(
              ex,
              eyeY,
              0,
              ex,
              eyeY,
              20,
            );
            gradient.addColorStop(
              0,
              `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${0.4 * happyBlink})`,
            );
            gradient.addColorStop(
              1,
              `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`,
            );
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(ex, eyeY, 20, 0, Math.PI * 2);
            ctx.fill();

            // Semi-circle arc (upside-down U shape ^_^)
            ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, ${0.9 * happyBlink})`;
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.arc(ex, eyeY + 4, 10, Math.PI, 0, false); // Semi-circle
            ctx.stroke();
          });
          break;
        }

        case "busy": {
          // Slow, subtle pulse when concentrated - not intimidating
          const busyPulse = Math.sin(timestamp * 0.001) * 0.15 + 0.85;
          [leftEyeX, rightEyeX].forEach((ex) => {
            drawEyeGlow(ex, eyeY, 5, 22, busyPulse);
          });
          break;
        }

        case "curious": {
          // Curious: eyes closer together (position animated via exprOffset)
          const curiousEyeSpacing = faceRadius * 0.25; // Closer together
          const curiousLeftX =
            centerX - curiousEyeSpacing + driftX + exprOffsetX;
          const curiousRightX =
            centerX + curiousEyeSpacing + driftX + exprOffsetX;

          [curiousLeftX, curiousRightX].forEach((ex, i) => {
            const yOffset = i === 1 ? -3 : 0; // Right eye slightly raised
            drawEyeGlow(ex, eyeY + yOffset, 5.5, 24, 1);
          });
          break;
        }

        case "sleepy":
          // Sleepy: horizontal lines (not star segments)
          [leftEyeX, rightEyeX].forEach((ex) => {
            // Subtle glow behind
            const gradient = ctx.createRadialGradient(
              ex,
              eyeY,
              0,
              ex,
              eyeY,
              18,
            );
            gradient.addColorStop(
              0,
              `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0.25)`,
            );
            gradient.addColorStop(
              1,
              `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0)`,
            );
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(ex, eyeY, 18, 0, Math.PI * 2);
            ctx.fill();

            // Simple horizontal line
            ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0.7)`;
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(ex - 12, eyeY);
            ctx.lineTo(ex + 12, eyeY);
            ctx.stroke();
          });
          break;

        case "neutral":
        default: {
          const blink = state.blinkState;
          if (blink > 0.5) {
            [leftEyeX, rightEyeX].forEach((ex) => {
              drawEyeGlow(ex, eyeY, 5.5, 26, 1);
            });
          } else {
            // Closed eyes - horizontal lines
            [leftEyeX, rightEyeX].forEach((ex) => {
              ctx.strokeStyle = `rgba(${teal.r}, ${teal.g}, ${teal.b}, 0.7)`;
              ctx.lineWidth = 2;
              ctx.lineCap = "round";
              ctx.beginPath();
              ctx.moveTo(ex - 10, eyeY);
              ctx.lineTo(ex + 10, eyeY);
              ctx.stroke();
            });
          }
          break;
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [width, height, expression, initialize, bgLoaded]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        borderRadius: "12px",
      }}
    />
  );
};

export default AgentAvatar;
