import { CompareView } from "@/components/CompareView";

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <CompareView a={sp.a ?? null} b={sp.b ?? null} />;
}
