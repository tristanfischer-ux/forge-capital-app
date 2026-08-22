import { cookies } from "next/headers";
import { parseProgramme } from "@/lib/desk/programme";
import { CapitalDiscover } from "./CapitalDiscover";

export const dynamic = "force-dynamic";

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const cookieStore = await cookies();
  return (
    <CapitalDiscover
      initialQ={sp.q ?? ""}
      initialMandate={parseProgramme(cookieStore.get("fc_programme")?.value)}
    />
  );
}
