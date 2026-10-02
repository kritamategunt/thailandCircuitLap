import { LapAnalysisView } from "@/components/LapAnalysisView";

export default async function LapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LapAnalysisView lapId={id} />;
}
