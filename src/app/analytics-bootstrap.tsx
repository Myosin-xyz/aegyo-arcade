"use client";

import { useCallback, useState } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { CampaignCapture } from "./campaign-capture";

export function AnalyticsBootstrap({
  enabled,
  measurementId,
}: {
  enabled: boolean;
  measurementId: string;
}) {
  const [locationSanitized, setLocationSanitized] = useState(false);
  const markLocationSanitized = useCallback(
    () => setLocationSanitized(true),
    [],
  );

  return (
    <>
      <CampaignCapture onLocationSanitized={markLocationSanitized} />
      {enabled && locationSanitized ? (
        <GoogleAnalytics gaId={measurementId} />
      ) : null}
    </>
  );
}
