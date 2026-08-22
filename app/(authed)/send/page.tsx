import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseProgramme } from "@/lib/desk/programme";
import { capitalConfigured } from "@/lib/supabase/capital";

export const dynamic = "force-dynamic";

export default async function SendIndexPage() {
  if (!capitalConfigured()) {
    return (
      <div className="wrap">
        <h1>Send</h1>
        <p>Shared book is not configured.</p>
      </div>
    );
  }
  const cookieStore = await cookies();
  redirect(`/send/${parseProgramme(cookieStore.get("fc_programme")?.value)}`);
}
