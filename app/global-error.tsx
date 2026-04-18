"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/system/error-state";

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorState
          badge="Critical failure"
          title="The application shell failed"
          message="GanSystems could not render the main application frame. Try reloading the route or return to the landing page."
          detail={error.digest ? `Reference: ${error.digest}` : undefined}
          onRetry={reset}
          primaryHref="/"
          primaryLabel="Open landing page"
          hint="This page is shown when the root layout cannot recover on its own."
        />
      </body>
    </html>
  );
}
