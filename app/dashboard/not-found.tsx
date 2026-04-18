import { ErrorState } from "@/components/system/error-state";

export default function DashboardNotFound() {
  return (
    <ErrorState
      badge="Dashboard route missing"
      tone="warning"
      title="That dashboard page was not found"
      message="The resource you requested is not available in this dashboard segment anymore."
      primaryHref="/dashboard"
      primaryLabel="Back to overview"
      secondaryHref="/dashboard/settings"
      secondaryLabel="Open settings"
    />
  );
}
