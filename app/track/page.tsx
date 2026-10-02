import { TrackView } from "@/components/TrackView";

export default async function TrackPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <TrackView sessionId={sp.session ?? null} calibrate={sp.calibrate === "1"} />;
}
