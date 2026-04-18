import { ErrorState } from "@/components/system/error-state";

export default function NotFound() {
  return (
    <ErrorState
      badge="404"
      tone="warning"
      title="That page does not exist"
      message="The route may have moved, or the link may be incomplete. You can head back to the landing page or jump into the dashboard."
      primaryHref="/"
      primaryLabel="Go home"
      secondaryHref="/login"
      secondaryLabel="Open login"
    />
  );
}
