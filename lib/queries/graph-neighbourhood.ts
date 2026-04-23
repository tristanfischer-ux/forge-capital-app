import { getInvestorProfile } from "@/lib/queries/investor-profile";
import { getPartnerProfile } from "@/lib/queries/partner-profile";
import { getPortfolioCompany } from "@/lib/queries/portfolio-profile";

/**
 * Graph neighbourhood loader for `/graph/[entity]/[id]`.
 *
 * Wraps the three existing profile queries and transforms their output
 * into a node/edge list suitable for a d3-force visualisation. One hop
 * out from the centre — partners + portfolio + related for an investor;
 * firm + siblings + cross-firm for a partner; backers + related
 * companies for a portfolio company.
 *
 * Node ids are namespaced: `investor:202`, `partner:159638`,
 * `portfolio:northvolt`. The graph may contain all three kinds.
 */

export type GraphEntityKind = "investor" | "partner" | "portfolio";

export interface GraphNode {
  id: string; // namespaced: "investor:<n>" / "partner:<n>" / "portfolio:<slug>"
  kind: GraphEntityKind;
  label: string;
  /** Short sub-label (firm name for partners, sector for companies, etc.). */
  meta: string | null;
  /** Click → navigate to full profile. */
  href: string;
  /** True for the centre node of the graph. Rendered larger + fixed at origin. */
  isCenter: boolean;
}

export type GraphEdgeKind =
  | "employs" // investor ←→ partner
  | "backs" // investor ←→ portfolio
  | "co_backer" // portfolio ←→ portfolio (shared investors)
  | "shares_portfolio" // investor ←→ investor (shared portfolio companies)
  | "cross_firm" // partner ←→ partner (same person across firms)
  | "colleague"; // partner ←→ partner (same firm)

export interface GraphEdge {
  source: string; // GraphNode.id
  target: string;
  kind: GraphEdgeKind;
  /** Optional label (e.g. "2 shared" for shares_portfolio). */
  label: string | null;
}

export interface GraphNeighbourhoodData {
  center: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerKind: GraphEntityKind;
  centerLabel: string;
}

const MAX_PARTNERS = 10;
const MAX_PORTFOLIO = 20;
const MAX_RELATED = 8;

export async function getGraphNeighbourhood(
  entity: GraphEntityKind,
  id: string,
): Promise<GraphNeighbourhoodData | null> {
  if (entity === "investor") return buildInvestorGraph(id);
  if (entity === "partner") return buildPartnerGraph(id);
  if (entity === "portfolio") return buildPortfolioGraph(id);
  return null;
}

function investorNode(
  id: number,
  label: string | null,
  meta: string | null,
  isCenter: boolean,
): GraphNode {
  return {
    id: `investor:${id}`,
    kind: "investor",
    label: label ?? `Firm ${id}`,
    meta,
    href: `/investor/${id}`,
    isCenter,
  };
}

function partnerNode(
  id: number,
  label: string | null,
  meta: string | null,
  isCenter: boolean,
): GraphNode {
  return {
    id: `partner:${id}`,
    kind: "partner",
    label: label ?? `Partner ${id}`,
    meta,
    href: `/partner/${id}`,
    isCenter,
  };
}

function portfolioNode(
  slug: string,
  label: string | null,
  meta: string | null,
  isCenter: boolean,
): GraphNode {
  return {
    id: `portfolio:${slug}`,
    kind: "portfolio",
    label: label ?? slug,
    meta,
    href: `/portfolio/${slug}`,
    isCenter,
  };
}

async function buildInvestorGraph(
  idStr: string,
): Promise<GraphNeighbourhoodData | null> {
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) return null;
  const profile = await getInvestorProfile(id);
  if (!profile) return null;

  const center = investorNode(
    profile.id,
    profile.firm_name,
    profile.hq_location,
    true,
  );
  const nodes: GraphNode[] = [center];
  const edges: GraphEdge[] = [];

  for (const p of profile.partners.slice(0, MAX_PARTNERS)) {
    const node = partnerNode(p.id, p.name, p.title, false);
    nodes.push(node);
    edges.push({ source: center.id, target: node.id, kind: "employs", label: null });
  }

  for (const pc of profile.canonical_portfolio.slice(0, MAX_PORTFOLIO)) {
    const node = portfolioNode(pc.slug, pc.name, pc.round ?? pc.round_at, false);
    nodes.push(node);
    edges.push({ source: center.id, target: node.id, kind: "backs", label: null });
  }

  for (const r of profile.related_firms.slice(0, MAX_RELATED)) {
    const node = investorNode(r.id, r.firm_name, null, false);
    nodes.push(node);
    edges.push({
      source: center.id,
      target: node.id,
      kind: "shares_portfolio",
      label: `${r.shared_count} shared`,
    });
  }

  return {
    center: center.id,
    nodes,
    edges,
    centerKind: "investor",
    centerLabel: profile.firm_name ?? `Firm ${profile.id}`,
  };
}

async function buildPartnerGraph(
  idStr: string,
): Promise<GraphNeighbourhoodData | null> {
  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) return null;
  const profile = await getPartnerProfile(id);
  if (!profile) return null;

  const center = partnerNode(profile.id, profile.name, profile.title, true);
  const nodes: GraphNode[] = [center];
  const edges: GraphEdge[] = [];

  if (profile.firm?.id != null) {
    const firmNode = investorNode(
      profile.firm.id,
      profile.firm.firm_name,
      profile.firm.hq_location,
      false,
    );
    nodes.push(firmNode);
    edges.push({
      source: center.id,
      target: firmNode.id,
      kind: "employs",
      label: null,
    });
  }

  for (const s of profile.siblings.slice(0, MAX_PARTNERS)) {
    const node = partnerNode(s.id, s.name, s.title, false);
    nodes.push(node);
    edges.push({
      source: center.id,
      target: node.id,
      kind: "colleague",
      label: null,
    });
  }

  for (const cf of profile.cross_firm.slice(0, MAX_RELATED)) {
    const node = partnerNode(cf.id, profile.name, cf.firm_name, false);
    nodes.push(node);
    edges.push({
      source: center.id,
      target: node.id,
      kind: "cross_firm",
      label: cf.match_kind === "email" ? "same email" : "same name",
    });
  }

  return {
    center: center.id,
    nodes,
    edges,
    centerKind: "partner",
    centerLabel: profile.name ?? `Partner ${profile.id}`,
  };
}

async function buildPortfolioGraph(
  slug: string,
): Promise<GraphNeighbourhoodData | null> {
  const profile = await getPortfolioCompany(slug);
  if (!profile) return null;

  const center = portfolioNode(profile.slug, profile.name, profile.sector, true);
  const nodes: GraphNode[] = [center];
  const edges: GraphEdge[] = [];

  for (const b of profile.backers.slice(0, MAX_RELATED)) {
    const node = investorNode(
      b.investor_id,
      b.firm_name,
      b.primary_partner_name,
      false,
    );
    nodes.push(node);
    edges.push({
      source: center.id,
      target: node.id,
      kind: "backs",
      label: b.round ?? null,
    });
  }

  for (const r of profile.related_companies.slice(0, MAX_RELATED)) {
    const node = portfolioNode(r.slug, r.name, null, false);
    nodes.push(node);
    edges.push({
      source: center.id,
      target: node.id,
      kind: "co_backer",
      label: `${r.shared_backers} shared`,
    });
  }

  return {
    center: center.id,
    nodes,
    edges,
    centerKind: "portfolio",
    centerLabel: profile.name,
  };
}
