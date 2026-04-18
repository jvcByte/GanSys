import { ControllerDetail } from "@/components/dashboard/controller-detail";
import { getCurrentUser } from "@/lib/auth";
import { getControllerSnapshot } from "@/lib/data";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ controllerId: string }>;
};

export default async function ControllerPage({ params }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }
  const { controllerId } = await params;
  const snapshot = await getControllerSnapshot(user.id, controllerId);
  return <ControllerDetail initialSnapshot={snapshot} />;
}
