"use client";

import { useEffect, useRef } from "react";

const W = 360;
const H = 640;
const DURATION_MS = 5_000;

const CONFETTI = Array.from({ length: 58 }, (_, i) => ({
  x: (i * 83 + 17) % W,
  y: (i * 47 + 11) % 360,
  speed: 38 + (i % 7) * 9,
  color: ["#ff4fd8", "#4ff0ff", "#ffd166", "#ffffff"][i % 4],
  tilt: (i * 0.71) % Math.PI,
}));

function drawDancer(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  phase: number,
  accent: string,
): void {
  const bounce = Math.abs(Math.sin(phase)) * 4;
  const arm = Math.sin(phase * 1.4) * 0.75;
  g.save();
  g.translate(x, y - bounce);
  g.strokeStyle = "#f5d0b5";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-5, 6);
  g.lineTo(-16 - arm * 8, 20 - Math.abs(arm) * 8);
  g.moveTo(5, 6);
  g.lineTo(16 + arm * 8, 20 - Math.abs(arm) * 8);
  g.stroke();
  g.fillStyle = accent;
  g.beginPath();
  g.roundRect(-10, 3, 20, 30, 6);
  g.fill();
  g.strokeStyle = "#101028";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(-5, 31);
  g.lineTo(-9 - arm * 4, 47);
  g.moveTo(5, 31);
  g.lineTo(9 + arm * 4, 47);
  g.stroke();
  g.fillStyle = "#f5d0b5";
  g.beginPath();
  g.arc(0, -5, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#171126";
  g.beginPath();
  g.arc(0, -8, 9, Math.PI, Math.PI * 2);
  g.lineTo(8, -1);
  g.lineTo(-8, -2);
  g.fill();
  g.restore();
}

function drawCelebration(g: CanvasRenderingContext2D, elapsedMs: number): void {
  const t = elapsedMs / 1_000;
  const pulse = 1 + Math.sin(t * 5) * 0.055;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1b0636");
  bg.addColorStop(0.6, "#320b55");
  bg.addColorStop(1, "#090116");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // LED wall + the pulsing heart from DaiDai's finish reference.
  g.fillStyle = "#16052f";
  g.fillRect(18, 28, W - 36, 170);
  g.strokeStyle = "rgba(79,240,255,.5)";
  g.lineWidth = 2;
  g.strokeRect(18, 28, W - 36, 170);
  g.save();
  g.translate(W / 2, 108);
  g.scale(pulse, pulse);
  g.fillStyle = "#ff69d7";
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 26;
  g.beginPath();
  g.moveTo(0, 36);
  g.bezierCurveTo(-62, 0, -42, -48, 0, -18);
  g.bezierCurveTo(42, -48, 62, 0, 0, 36);
  g.fill();
  g.restore();

  // Moving concert spotlights.
  g.save();
  g.globalCompositeOperation = "screen";
  for (const [originX, color, dir] of [
    [45, "rgba(255,79,216,.32)", 1],
    [315, "rgba(79,240,255,.32)", -1],
  ] as const) {
    const sway = Math.sin(t * 1.7) * 42 * dir;
    const beam = g.createLinearGradient(originX, 0, W / 2 + sway, 300);
    beam.addColorStop(0, color);
    beam.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = beam;
    g.beginPath();
    g.moveTo(originX - 18, 0);
    g.lineTo(originX + 18, 0);
    g.lineTo(W / 2 + sway + 58, 320);
    g.lineTo(W / 2 + sway - 58, 320);
    g.fill();
  }
  g.restore();

  // Stage and generic synchronized performers; no member likenesses.
  g.fillStyle = "#17072c";
  g.fillRect(0, 220, W, 96);
  g.fillStyle = "#ff4fd8";
  g.fillRect(0, 310, W, 4);
  const accents = ["#7b2ff7", "#4ff0ff", "#ff4fd8"];
  for (let i = 0; i < 7; i++) {
    drawDancer(
      g,
      45 + i * 45,
      268 + (i % 2) * 8,
      t * 4 + i * 0.72,
      accents[i % accents.length],
    );
  }

  // Crowd silhouettes, lightsticks and the celebrating fan in front.
  g.fillStyle = "#0b0318";
  for (let i = 0; i < 18; i++) {
    const x = 4 + i * 21;
    const y = 468 + (i % 3) * 12;
    g.beginPath();
    g.arc(x, y, 13, 0, Math.PI * 2);
    g.fill();
    g.fillRect(x - 13, y + 8, 27, H - y);
    g.save();
    g.translate(x + Math.sin(t * 4 + i) * 3, y - 34);
    g.rotate(Math.sin(t * 5 + i) * 0.25);
    g.fillStyle = i % 2 ? "#4ff0ff" : "#ff7ddb";
    g.shadowColor = g.fillStyle;
    g.shadowBlur = 9;
    g.fillRect(-2, -20, 4, 24);
    g.restore();
    g.fillStyle = "#0b0318";
  }

  g.save();
  g.translate(W / 2, 430 + Math.sin(t * 5) * 3);
  g.fillStyle = "#30151e";
  g.beginPath();
  g.arc(0, -18, 17, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#ff4f8b";
  g.beginPath();
  g.roundRect(-15, -6, 30, 42, 8);
  g.fill();
  g.strokeStyle = "#f4d2bd";
  g.lineWidth = 7;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(-9, 2);
  g.lineTo(-25, -27 - Math.sin(t * 4) * 5);
  g.moveTo(9, 2);
  g.lineTo(25, -27 + Math.sin(t * 4) * 5);
  g.stroke();
  g.restore();

  for (const piece of CONFETTI) {
    const y = (piece.y + t * piece.speed) % 370;
    g.save();
    g.translate(piece.x, y);
    g.rotate(piece.tilt + t * 2);
    g.fillStyle = piece.color;
    g.fillRect(-2, -4, 4, 8);
    g.restore();
  }

  for (let i = 0; i < 5; i++) {
    const phase = t * 2.5 + i * 1.1;
    const x = W / 2 + Math.sin(phase) * (30 + i * 7);
    const y = 380 - ((t * 38 + i * 29) % 100);
    g.globalAlpha = Math.max(0.2, 1 - ((t * 38 + i * 29) % 100) / 100);
    g.fillStyle = "#ff8fb8";
    g.font = `${16 + (i % 3) * 3}px sans-serif`;
    g.fillText("♥", x, y);
  }
  g.globalAlpha = 1;
}

export function BiasFlapVictory({ onComplete }: { onComplete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) {
      onComplete();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onComplete();
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      drawCelebration(g, Math.min(elapsed, DURATION_MS));
      if (elapsed >= DURATION_MS) {
        onComplete();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [onComplete]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#090116]"
      aria-hidden="true"
      data-testid="bias-victory-celebration"
    >
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="h-full w-full object-contain"
      />
    </div>
  );
}
