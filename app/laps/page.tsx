import { LapHistory } from "@/components/LapHistory";

export default async function LapsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <LapHistory sessionId={sp.session ?? null} />;
}
