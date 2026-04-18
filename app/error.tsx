"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/system/error-state";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      badge="Application error"
      title="Something interrupted the app"
      message="An unexpected error stopped this page from loading properly. You can retry the request or head back to the start."
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
      onRetry={reset}
      primaryHref="/"
      primaryLabel="Back to home"
      hint="If this keeps happening, the server may need attention."
    />
  );
}
