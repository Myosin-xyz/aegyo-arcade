"use client";

import { useCallback, useEffect, useRef } from "react";

const VICTORY_VIDEO = "/games/flappy/victory-v1.mp4";
const FALLBACK_MS = 6_500;

export function BiasFlapVictory({
  onComplete,
  respectReducedMotion = true,
}: {
  onComplete: () => void;
  respectReducedMotion?: boolean;
}) {
  const completedRef = useRef(false);
  const completeOnce = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (
      respectReducedMotion &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      completeOnce();
      return;
    }

    // Muted inline video is allowed to autoplay in mobile social browsers.
    // The fallback prevents a failed media event from trapping the end screen.
    const fallback = window.setTimeout(completeOnce, FALLBACK_MS);
    return () => window.clearTimeout(fallback);
  }, [completeOnce, respectReducedMotion]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black"
      aria-hidden="true"
      data-testid="bias-victory-celebration"
    >
      <video
        autoPlay
        muted
        playsInline
        preload="auto"
        src={VICTORY_VIDEO}
        className="h-full w-full object-contain"
        onEnded={completeOnce}
        onError={completeOnce}
        data-testid="bias-victory-video"
      />
    </div>
  );
}
