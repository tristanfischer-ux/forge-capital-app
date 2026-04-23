import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGraphNeighbourhood,
  type GraphEntityKind,
} from "@/lib/queries/graph-neighbourhood";
import { GraphView } from "./GraphView";
import { BreadcrumbsOverride } from "../../../Breadcrumbs";

const ENTITY_KINDS: GraphEntityKind[] = ["investor", "partner", "portfolio"];

function isEntity(k: string): k is GraphEntityKind {
  return (ENTITY_KINDS as string[]).includes(k);
}

export default async function GraphPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  if (!isEntity(entity)) notFound();

  const data = await getGraphNeighbourhood(entity, id);
  if (!data) notFound();

  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      <BreadcrumbsOverride label={`${data.centerLabel} · graph`} />
      <div className="section-head">
        <div>
          <h2 className="section-title">
            {data.centerLabel} <span style={{ color: "var(--text-dim)" }}>· graph</span>
          </h2>
          <p className="section-sub">
            One hop out from the centre. Click any node to open its full
            profile; drag nodes to reposition. {data.nodes.length} nodes,
            {" "}
            {data.edges.length} edges.
          </p>
        </div>
        <Link
          href={data.nodes[0]?.href ?? "/home"}
          className="as-link"
          style={{ fontSize: 13 }}
        >
          ← Back to {data.centerLabel}
        </Link>
      </div>
      <GraphView data={data} />
    </section>
  );
}
