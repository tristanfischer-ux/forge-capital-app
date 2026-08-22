import Link from "next/link";

export function LegacyBanner() {
  return (
    <div className="legacy-banner">
      This is the old Outreach pipeline. The live desk is{" "}
      <Link href="/today">Today</Link>.
    </div>
  );
}
