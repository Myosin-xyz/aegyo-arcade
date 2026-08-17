"use client";

import { useEffect, useRef, useState } from "react";

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

interface TouchPreviewCandidate {
  ratio: number;
  centerY: number;
  select: (selected: boolean) => void;
}

const touchPreviewCandidates = new Map<string, TouchPreviewCandidate>();
let touchSelectionScheduled = false;

function scheduleTouchPreviewSelection() {
  if (touchSelectionScheduled) return;
  touchSelectionScheduled = true;
  queueMicrotask(() => {
    touchSelectionScheduled = false;
    const viewportCenter = window.innerHeight / 2;
    const winner = [...touchPreviewCandidates.entries()]
      .filter(([, candidate]) => candidate.ratio >= 0.75)
      .sort(
        ([, a], [, b]) =>
          b.ratio - a.ratio ||
          Math.abs(a.centerY - viewportCenter) -
            Math.abs(b.centerY - viewportCenter),
      )[0]?.[0];

    for (const [id, candidate] of touchPreviewCandidates) {
      candidate.select(id === winner);
    }
  });
}

export function GameCardPreview({
  poster,
  video,
  testId,
}: {
  poster: string;
  video: string;
  testId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [canAnimate, setCanAnimate] = useState(false);
  const [hasHover, setHasHover] = useState(true);
  const [interactionActive, setInteractionActive] = useState(false);
  const [visibleOnTouch, setVisibleOnTouch] = useState(false);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const hoverQuery = window.matchMedia("(hover: hover)");
    const updatePreferences = () => {
      const saveData = (navigator as NavigatorWithConnection).connection
        ?.saveData;
      setCanAnimate(!motionQuery.matches && !saveData);
      setHasHover(hoverQuery.matches);
    };
    updatePreferences();
    motionQuery.addEventListener?.("change", updatePreferences);
    hoverQuery.addEventListener?.("change", updatePreferences);
    return () => {
      motionQuery.removeEventListener?.("change", updatePreferences);
      hoverQuery.removeEventListener?.("change", updatePreferences);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const card = container?.closest("a");
    if (!card) return;
    const onFocus = () => setInteractionActive(true);
    const onBlur = () => setInteractionActive(false);
    card.addEventListener("focus", onFocus);
    card.addEventListener("blur", onBlur);
    return () => {
      card.removeEventListener("focus", onFocus);
      card.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || hasHover || !canAnimate || !window.IntersectionObserver) {
      return;
    }
    touchPreviewCandidates.set(testId, {
      ratio: 0,
      centerY: Number.POSITIVE_INFINITY,
      select: setVisibleOnTouch,
    });
    const observer = new IntersectionObserver(
      ([entry]) => {
        const candidate = touchPreviewCandidates.get(testId);
        if (!candidate) return;
        candidate.ratio = entry.intersectionRatio;
        candidate.centerY = entry.boundingClientRect
          ? entry.boundingClientRect.top + entry.boundingClientRect.height / 2
          : Number.POSITIVE_INFINITY;
        scheduleTouchPreviewSelection();
      },
      { threshold: [0, 0.75, 1] },
    );
    observer.observe(container);
    return () => {
      observer.disconnect();
      touchPreviewCandidates.delete(testId);
      scheduleTouchPreviewSelection();
    };
  }, [canAnimate, hasHover, testId]);

  const active =
    canAnimate && (interactionActive || (!hasHover && visibleOnTouch));

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (active) {
      void element.play().catch(() => undefined);
      return;
    }
    element.pause();
    element.currentTime = 0;
  }, [active]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-square overflow-hidden border-b border-line bg-[#090218]"
      onMouseEnter={() => setInteractionActive(true)}
      onMouseLeave={() => setInteractionActive(false)}
      aria-hidden="true"
    >
      <video
        ref={videoRef}
        src={active ? video : undefined}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        className="peer h-full w-full object-cover transition-transform duration-300 ease-out data-[active=true]:scale-[1.025]"
        data-active={active}
        data-testid={testId}
      />
      <span className="pointer-events-none absolute bottom-2 right-2 grid h-7 w-7 place-items-center rounded-full border border-white/25 bg-black/55 text-[0.625rem] text-white shadow-lg backdrop-blur-sm transition-opacity peer-data-[active=true]:opacity-0">
        ▶
      </span>
    </div>
  );
}
