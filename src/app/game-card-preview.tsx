"use client";

import { useEffect, useRef, useState } from "react";

type NavigatorWithConnection = Navigator & {
  connection?: { saveData?: boolean };
};

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
    const observer = new IntersectionObserver(
      ([entry]) => setVisibleOnTouch(entry.intersectionRatio >= 0.75),
      { threshold: [0, 0.75, 1] },
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [canAnimate, hasHover]);

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
