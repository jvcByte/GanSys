"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

type Props = {
  target: string;
};

export function HomeRedirect({ target }: Props) {
  const router = useRouter();

  useEffect(() => {
    router.replace(target);
  }, [router, target]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        textAlign: "center",
      }}
    >
      <div>
        <p>Redirecting...</p>
        <p>
          <Link href={target}>Continue</Link>
        </p>
      </div>
    </main>
  );
}
