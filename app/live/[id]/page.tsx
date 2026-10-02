import { LiveWatch } from "@/components/LiveWatch";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveWatch sessionId={id} />;
}
