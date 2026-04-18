"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/system/error-state";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      badge="Dashboard error"
      title="The dashboard hit a problem"
      message="We couldn’t finish loading the control hub. Retry this segment or return to the overview and try again."
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
      onRetry={reset}
      primaryHref="/dashboard"
      primaryLabel="Open overview"
      secondaryHref="/dashboard/settings"
      secondaryLabel="Go to settings"
    />
  );
}
