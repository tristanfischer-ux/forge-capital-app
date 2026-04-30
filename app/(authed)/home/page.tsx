import { redirect } from "next/navigation";

/**
 * /home → /discover redirect.
 *
 * The single-page V4 layout was replaced on 2026-04-30 with a two-page
 * architecture: /discover (truth database) + /pipeline (personal
 * database). This redirect preserves backwards compatibility for
 * bookmarks, old emails, and cached browser history.
 */
export default function HomePage() {
  redirect("/discover");
}
