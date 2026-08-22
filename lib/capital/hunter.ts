export type HunterFind = {
  email: string | null;
  score: number | null;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
};

export async function hunterFindEmail(opts: {
  domain: string;
  firstName: string;
  lastName: string;
}): Promise<HunterFind> {
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) return { email: null, score: null, firstName: opts.firstName, lastName: opts.lastName, position: null };
  const domain = opts.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  const url = new URL("https://api.hunter.io/v2/email-finder");
  url.searchParams.set("domain", domain);
  url.searchParams.set("first_name", opts.firstName);
  url.searchParams.set("last_name", opts.lastName);
  url.searchParams.set("api_key", key);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return { email: null, score: null, firstName: opts.firstName, lastName: opts.lastName, position: null };
  const body = (await res.json()) as {
    data?: { email?: string; score?: number; first_name?: string; last_name?: string; position?: string };
  };
  return {
    email: body.data?.email?.toLowerCase() ?? null,
    score: typeof body.data?.score === "number" ? body.data.score : null,
    firstName: body.data?.first_name ?? opts.firstName,
    lastName: body.data?.last_name ?? opts.lastName,
    position: body.data?.position ?? null,
  };
}
