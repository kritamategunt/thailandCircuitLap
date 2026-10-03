import { GroupWatch } from "@/components/GroupWatch";

export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const { join } = await searchParams;
  return <GroupWatch groupId={id} focusJoin={join === "1"} />;
}
