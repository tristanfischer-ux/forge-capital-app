import type { MandateBrief } from "@/lib/desk/mandate-state";
import { formatUpdateDate } from "@/lib/desk/mandate-state";

export function WhereWeAre({
  items,
  compact,
}: {
  items: MandateBrief[];
  compact?: boolean;
}) {
  if (items.length === 0) return null;
  if (compact) {
    return (
      <div className="where-line">
        <strong>Where we are — </strong>
        {items.map((m) => m.line).join(" ")}
      </div>
    );
  }
  return (
    <div className="where">
      <h2>Where we are with the companies</h2>
      <p className="sub" style={{ paddingLeft: 0 }}>
        Dated facts on the desk only. If he did not name a raise, every
        plausible one from the paper trail is here, marked as such.
      </p>
      {items.map((m) => (
        <div key={m.key} className="where-card">
          <h3>
            {m.name}
            {m.kind === "ned" ? (
              <span className="badge b-pending" style={{ marginLeft: 8 }}>NED</span>
            ) : null}
            {!m.namedByThem ? (
              <span className="badge b-pending" style={{ marginLeft: 8 }}>
                Not named by them
              </span>
            ) : null}
          </h3>
          <div>Ask: {m.ask}</div>
          <div className="faint">Principal: {m.principal}</div>
          {m.latest ? (
            <p style={{ margin: "8px 0 0", fontSize: 13 }}>
              As of {formatUpdateDate(m.latest.as_of)}: {m.latest.fact}
              <span className="faint"> — {m.latest.source}</span>
            </p>
          ) : (
            <p className="faint" style={{ margin: "8px 0 0" }}>
              No dated update on the desk.
            </p>
          )}
          <ul>
            {m.doNotSay.map((d) => (
              <li key={d}>{d}</li>
            ))}
            <li>{m.liveQuestion}</li>
          </ul>
        </div>
      ))}
    </div>
  );
}
