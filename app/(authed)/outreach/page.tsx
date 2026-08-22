import { OutreachClient } from "./OutreachClient";

export const dynamic = "force-dynamic";

export default function OutreachPage() {
  return (
    <div className="wrap">
      <div className="page-head">
        <div>
          <h1>Outreach</h1>
          <p>
            Find more investors for one raise, from what has already worked on
            the book. Confirm three sample drafts, then hunt. NeverBounce still
            gates every letter. Principal approval still gates new firms.
            Nothing sends — Gmail drafts only.
          </p>
        </div>
      </div>
      <OutreachClient />
    </div>
  );
}
