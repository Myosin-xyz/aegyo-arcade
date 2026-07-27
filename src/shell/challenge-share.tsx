"use client";

/**
 * "Challenge your friend" — the end-of-run share CTA (Simon, 2026-07-27).
 *
 * Mobile-social first: `navigator.share` opens the OS sheet (the norm in
 * the IG/TikTok in-app browsers that carry ~95% of traffic); everywhere
 * else the challenge text + link goes to the clipboard with a transient
 * "copied" confirmation. A dismissed share sheet is silent — the player
 * changed their mind, that is not an error.
 *
 * The share TEXT includes the score only when the game HAS one
 * (scorePresentation "none" games like the claw must not invent a
 * "Score: 0" here any more than in the header — audit A5).
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n/t";

type ShareFeedback = "idle" | "copied" | "failed";

export function ChallengeShareButton({
  gameId,
  gameTitle,
  score,
}: {
  gameId: string;
  gameTitle: string;
  /** null for games with no score concept. */
  score: number | null;
}) {
  const [feedback, setFeedback] = useState<ShareFeedback>("idle");
  const feedbackTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    };
  }, []);

  const flash = (state: ShareFeedback): void => {
    setFeedback(state);
    if (feedbackTimer.current !== null) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback("idle"), 2000);
  };

  const share = async (): Promise<void> => {
    const url = `${window.location.origin}/play/${gameId}`;
    const text =
      score === null
        ? t("host.challengeTextNoScore", { game: gameTitle })
        : t("host.challengeText", { game: gameTitle, score: String(score) });

    // Failure ladder (review P2 — a swallowed failure made the CTA
    // silently do nothing): native share → clipboard → visible error.
    // Only a CANCELLED sheet stays silent: the player changed their
    // mind, so neither fallback nor error copy is wanted.
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // Non-cancellation failure (permission policy, data rejection):
        // fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      flash("copied");
    } catch {
      // Clipboard missing or denied — say so instead of doing nothing.
      flash("failed");
    }
  };

  return (
    <button
      type="button"
      className="btn-ghost px-7 py-3 text-base font-semibold"
      onClick={() => void share()}
      data-testid="challenge-friend"
      data-share-feedback={feedback}
    >
      {feedback === "copied"
        ? t("host.challengeCopied")
        : feedback === "failed"
          ? t("host.challengeFailed")
          : t("host.challengeFriend")}
    </button>
  );
}
