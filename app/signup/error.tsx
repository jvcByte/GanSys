"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/system/error-state";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function SignupError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      badge="Signup route error"
      title="The signup screen could not load"
      message="Account creation is temporarily unavailable on this route. Retry the page or return to the landing screen."
      detail={error.digest ? `Reference: ${error.digest}` : undefined}
      onRetry={reset}
      primaryHref="/"
      primaryLabel="Back to home"
    />
  );
}
