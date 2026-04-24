"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { CustomerCampaignPartnerCard } from "@/lib/queries/customer-partners";
import type { CampaignMonitorData } from "@/lib/queries/monitor";
import {
  saveBrief,
  saveCriteria,
  saveTemplate,
  setPartnerEmail,
  draftSelected,
  approveBatch,
  queueBatch,
} from "./actions";
import { loadContactDirectory } from "../../approval/loadContactDirectoryAction";
import { HunterRow } from "./HunterRow";
import {
  Step4aSendList,
  Step4bPasteReply,
  Step4cIngest,
} from "./PermissionSteps";
import { MonitorPanel } from "./MonitorPanel";

/**
 * The 9-step linear customer-outreach flow for self-managed
 * campaigns (Tristan 2026-04-24 canonical spec). Every step lives
 * inside this one client component — one state machine, shared
 * `selectedIds` set, shared action dispatcher. Navigation is
 * Prev/Next; step index is mirrored to the URL hash so a refresh
 * lands you on the same step.
 */

type StepKey =
  | "1"
  | "2"
  | "3"
  | "4"
  | "4a"
  | "4b"
  | "4c"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10";

interface SendFlowProps {
  campaignId: string;
  campaignName: string;
  initialBrief: string;
  initialCriteria: string;
  initialTemplate: string;
  customerPartners: CustomerCampaignPartnerCard[];
  /** Multi-party signal — when set, the 4a/4b/4c permission block
   *  renders between Step 4 and Step 5. Null = self-managed. */
  counterpartEmail: string | null;
  /** Step 10 Monitor data — always loaded, shown at the end. */
  monitor: CampaignMonitorData;
}

export function SendFlow({
  campaignId,
  campaignName,
  initialBrief,
  initialCriteria,
  initialTemplate,
  customerPartners,
  counterpartEmail,
  monitor,
}: SendFlowProps) {
  const isMultiParty = counterpartEmail != null;

  // Ordered step sequence — depends on whether the permission block
  // is active. All non-permission steps keep their numeric labels so
  // the code below reads naturally even as the ordinal position
  // shifts for multi-party campaigns.
  const stepSequence: StepKey[] = useMemo(() => {
    return isMultiParty
      ? ["1", "2", "3", "4", "4a", "4b", "4c", "5", "6", "7", "8", "9", "10"]
      : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  }, [isMultiParty]);

  const [step, setStep] = useState<StepKey>("1");
  const [brief, setBrief] = useState<string>(initialBrief);
  const [criteria, setCriteria] = useState<string>(initialCriteria);
  const [template, setTemplate] = useState<string>(initialTemplate);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rawReply, setRawReply] = useState<string>(""); // Step 4b → 4c
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Persist step to URL hash so refresh keeps you on the right step.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#step-", "") as StepKey;
    if (stepSequence.includes(hash)) setStep(hash);
  }, [stepSequence]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.history.replaceState(null, "", `#step-${step}`);
  }, [step]);

  const stepIdx = stepSequence.indexOf(step);
  function next() {
    const i = stepSequence.indexOf(step);
    if (i >= 0 && i < stepSequence.length - 1) {
      setStep(stepSequence[i + 1]);
    }
  }
  function prev() {
    const i = stepSequence.indexOf(step);
    if (i > 0) {
      setStep(stepSequence[i - 1]);
    }
  }

  const selectedCount = selectedIds.size;
  const approvedCount = approvedIds.size;

  return (
    <section className="section" style={{ scrollMarginTop: 64 }}>
      <div className="section-head">
        <div>
          <h2 className="section-title">Send — {campaignName}</h2>
          <p className="section-sub">
            9-step linear flow for self-managed customer outreach. Each
            step saves on Next. Hard rule: no email dispatches until
            you explicitly queue and send in Step 9.
          </p>
        </div>
        <Link
          href={`/approval?c=${campaignId}`}
          style={{ fontSize: 12, color: "var(--text-dim)" }}
        >
          Back to approval sheet ←
        </Link>
      </div>

      <StepProgress
        step={step}
        stepSequence={stepSequence}
        onJump={(s) => setStep(s)}
      />

      {toast ? (
        <div
          style={{
            marginTop: 12,
            padding: "8px 12px",
            background: "var(--accent-softer)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--accent)",
          }}
        >
          {toast}
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        {step === "1" && (
          <Step1Brief
            brief={brief}
            onChange={setBrief}
            onSave={() =>
              startTransition(async () => {
                const r = await saveBrief(campaignId, brief);
                setToast(r.ok ? "Brief saved." : `Error: ${r.error}`);
                if (r.ok) next();
              })
            }
            isPending={isPending}
          />
        )}
        {step === "2" && (
          <Step2Criteria
            criteria={criteria}
            onChange={setCriteria}
            onSave={() =>
              startTransition(async () => {
                const r = await saveCriteria(campaignId, criteria);
                setToast(r.ok ? "Criteria saved." : `Error: ${r.error}`);
                if (r.ok) next();
              })
            }
            isPending={isPending}
          />
        )}
        {step === "3" && (
          <Step3Search
            customers={customerPartners}
            onContinue={next}
          />
        )}
        {step === "4" && (
          <Step4Pick
            customers={customerPartners}
            selectedIds={selectedIds}
            onToggle={(id) => {
              const next = new Set(selectedIds);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setSelectedIds(next);
            }}
            onSelectAll={(ids) => setSelectedIds(new Set(ids))}
            onContinue={() => {
              if (selectedIds.size === 0) {
                setToast("Tick at least one customer before continuing.");
                return;
              }
              next();
            }}
          />
        )}
        {step === "4a" && counterpartEmail ? (
          <Step4aSendList
            campaignId={campaignId}
            counterpartEmail={counterpartEmail}
            selectedCpIds={Array.from(selectedIds)}
            onContinue={next}
          />
        ) : null}
        {step === "4b" ? (
          <Step4bPasteReply
            campaignId={campaignId}
            onContinue={(text) => {
              setRawReply(text);
              next();
            }}
          />
        ) : null}
        {step === "4c" ? (
          <Step4cIngest
            campaignId={campaignId}
            rawReply={rawReply}
            onContinue={next}
          />
        ) : null}
        {step === "5" && (
          <Step5EmailResolve
            customers={customerPartners.filter((c) =>
              selectedIds.has(c.campaign_partner_id),
            )}
            onContinue={next}
            setToast={setToast}
          />
        )}
        {step === "6" && (
          <Step6Template
            template={template}
            onChange={setTemplate}
            onSave={() =>
              startTransition(async () => {
                const r = await saveTemplate(campaignId, template);
                setToast(r.ok ? "Template saved." : `Error: ${r.error}`);
                if (r.ok) next();
              })
            }
            isPending={isPending}
          />
        )}
        {step === "7" && (
          <Step7Draft
            selectedCount={selectedCount}
            onDraftAll={() =>
              startTransition(async () => {
                setToast("Drafting via Opus — this takes ~10s per row…");
                const r = await draftSelected(Array.from(selectedIds));
                if (!r.ok) {
                  setToast(`Error: ${r.error}`);
                  return;
                }
                const failedCount = r.failed.length;
                setToast(
                  failedCount > 0
                    ? `Drafted ${r.drafted}, ${failedCount} failed. Check /tracker for detail.`
                    : `Drafted ${r.drafted}. Review each on /approval, then continue.`,
                );
                if (failedCount === 0) next();
              })
            }
            onContinue={next}
            isPending={isPending}
            selectedIds={selectedIds}
            campaignId={campaignId}
          />
        )}
        {step === "8" && (
          <Step8Approve
            customers={customerPartners.filter((c) =>
              selectedIds.has(c.campaign_partner_id),
            )}
            approvedIds={approvedIds}
            onToggle={(id) => {
              const next = new Set(approvedIds);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              setApprovedIds(next);
            }}
            onApprove={() =>
              startTransition(async () => {
                if (approvedIds.size === 0) {
                  setToast("Tick at least one draft to approve.");
                  return;
                }
                const r = await approveBatch(Array.from(approvedIds));
                if (!r.ok) {
                  setToast(`Error: ${r.error}`);
                  return;
                }
                setToast(`Promoted ${r.approved} rows to +1. Ready to queue.`);
                next();
              })
            }
            isPending={isPending}
          />
        )}
        {step === "9" && (
          <Step9Queue
            customers={customerPartners.filter((c) =>
              approvedIds.has(c.campaign_partner_id),
            )}
            onQueue={(sendAt) =>
              startTransition(async () => {
                const r = await queueBatch(Array.from(approvedIds), sendAt);
                if (!r.ok) {
                  setToast(`Error: ${r.error}`);
                  return;
                }
                setToast(
                  r.failed.length > 0
                    ? `Queued ${r.queued}, ${r.failed.length} failed (${r.failed[0].error}).`
                    : `Queued ${r.queued} sends. Dispatcher picks them up on schedule.`,
                );
              })
            }
            isPending={isPending}
            campaignId={campaignId}
          />
        )}
        {step === "10" && (
          <StepCard
            number={10}
            title="Monitor"
            intro="Everything that's been dispatched, queued, replied, or bounced for this campaign. Refresh the page to re-pull."
          >
            <MonitorPanel data={monitor} campaignId={campaignId} />
          </StepCard>
        )}
      </div>

      <div
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <button
          type="button"
          onClick={prev}
          disabled={stepIdx === 0}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 500,
            color: stepIdx === 0 ? "var(--text-faint)" : "var(--text-dim)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: stepIdx === 0 ? "not-allowed" : "pointer",
          }}
        >
          ← Previous
        </button>
        <div style={{ fontSize: 11, color: "var(--text-faint)", alignSelf: "center" }}>
          Step {step} of {stepSequence.length}
        </div>
        <button
          type="button"
          onClick={next}
          disabled={stepIdx === stepSequence.length - 1}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 500,
            color:
              stepIdx === stepSequence.length - 1
                ? "var(--text-faint)"
                : "var(--accent)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor:
              stepIdx === stepSequence.length - 1 ? "not-allowed" : "pointer",
          }}
        >
          Skip to next →
        </button>
      </div>
    </section>
  );
}

/* ───────────────────────── Step Progress ──────────────────────────────────── */

const LABEL_FOR_STEP: Record<StepKey, string> = {
  "1": "Brief",
  "2": "Criteria",
  "3": "Search",
  "4": "Pick",
  "4a": "Send list",
  "4b": "Paste reply",
  "4c": "Ingest",
  "5": "Email",
  "6": "Template",
  "7": "Draft",
  "8": "Approve",
  "9": "Queue",
  "10": "Monitor",
};

function StepProgress({
  step,
  stepSequence,
  onJump,
}: {
  step: StepKey;
  stepSequence: StepKey[];
  onJump: (s: StepKey) => void;
}) {
  const activeIdx = stepSequence.indexOf(step);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stepSequence.length}, 1fr)`,
        gap: 4,
        marginTop: 12,
      }}
    >
      {stepSequence.map((s, i) => {
        const active = s === step;
        const done = i < activeIdx;
        const isSubStep = s.length > 1 && s !== "10";
        return (
          <button
            key={s}
            type="button"
            onClick={() => onJump(s)}
            style={{
              padding: "6px 8px",
              fontSize: 9,
              fontWeight: active ? 700 : 500,
              color: active
                ? "white"
                : done
                  ? "var(--accent)"
                  : "var(--text-dim)",
              background: active
                ? "var(--accent)"
                : done
                  ? "var(--accent-softer)"
                  : isSubStep
                    ? "var(--surface)"
                    : "var(--surface-alt)",
              border: "1px solid",
              borderColor: active ? "var(--accent)" : "var(--border)",
              borderStyle: isSubStep ? "dashed" : "solid",
              borderRadius: 4,
              cursor: "pointer",
              textAlign: "center",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            {s} · {LABEL_FOR_STEP[s]}
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────────── Step 1 — Brief ─────────────────────────────────── */

function Step1Brief({
  brief,
  onChange,
  onSave,
  isPending,
}: {
  brief: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <StepCard
      number={1}
      title="Customer brief"
      intro="What we're selling. This is the product context — what your customer needs to understand to evaluate the offer. Used as the founding input for every draft."
    >
      <textarea
        value={brief}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        style={textareaStyle}
        placeholder="Fischer Farms Containers — modular 40ft shipping-container vertical farms growing tropical-foliage houseplants…"
      />
      <PrimaryButton onClick={onSave} pending={isPending}>
        Save + Continue →
      </PrimaryButton>
    </StepCard>
  );
}

/* ───────────────────────── Step 2 — Criteria ──────────────────────────────── */

function Step2Criteria({
  criteria,
  onChange,
  onSave,
  isPending,
}: {
  criteria: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <StepCard
      number={2}
      title="Hunting criteria"
      intro="Who we're looking for — the SHAPE of the customer. Geography, channel, regulatory exposure, any public commitments. Separate from the brief: the brief describes OUR product, this describes THEIR shape."
    >
      <textarea
        value={criteria}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        style={textareaStyle}
        placeholder="Plant retailers / garden centres / DIY chains in Nordic + Canada + US PNW…"
      />
      <PrimaryButton onClick={onSave} pending={isPending}>
        Save + Continue →
      </PrimaryButton>
    </StepCard>
  );
}

/* ───────────────────────── Step 3 — Search ────────────────────────────────── */

function Step3Search({
  customers,
  onContinue,
}: {
  customers: CustomerCampaignPartnerCard[];
  onContinue: () => void;
}) {
  return (
    <StepCard
      number={3}
      title="Search for customers"
      intro={`Current shortlist: ${customers.length} customers matched against your brief + criteria. (V2 will add live cross-corpus search.)`}
    >
      <div
        style={{
          padding: "12px 14px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--surface-alt)",
          fontSize: 12,
          color: "var(--text-dim)",
          marginBottom: 12,
        }}
      >
        {customers.length} customers on this campaign — ready to tick in the next
        step. For this sprint the list IS the curated 93 Fischer Farms
        prospects; future release adds cross-corpus search across the
        investor mirror + any connected Nightshift corpus.
      </div>
      <PrimaryButton onClick={onContinue}>Continue →</PrimaryButton>
    </StepCard>
  );
}

/* ───────────────────────── Step 4 — Pick ──────────────────────────────────── */

function Step4Pick({
  customers,
  selectedIds,
  onToggle,
  onSelectAll,
  onContinue,
}: {
  customers: CustomerCampaignPartnerCard[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onContinue: () => void;
}) {
  const [filter, setFilter] = useState<string>("");
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      return (
        (c.firm_name ?? "").toLowerCase().includes(q) ||
        (c.country_iso ?? "").toLowerCase().includes(q) ||
        (c.type ?? "").toLowerCase().includes(q) ||
        (c.wave ?? "").toLowerCase().includes(q) ||
        (c.pitch_hook ?? "").toLowerCase().includes(q)
      );
    });
  }, [customers, filter]);

  const NORDIC = new Set(["SE", "NO", "DK", "FI", "IS"]);
  function presetNordics() {
    onSelectAll(
      customers
        .filter((c) => NORDIC.has(c.country_iso ?? ""))
        .map((c) => c.campaign_partner_id),
    );
  }
  function presetWave1() {
    onSelectAll(
      customers
        .filter((c) => c.wave === "1")
        .map((c) => c.campaign_partner_id),
    );
  }
  function clearAll() {
    onSelectAll([]);
  }

  return (
    <StepCard
      number={4}
      title="Pick customers"
      intro={`Tick the customers you want to email this round. Use presets for common slices.`}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filter by firm, country, type, wave, or pitch hook…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            minWidth: 240,
            padding: "6px 10px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        />
        <button type="button" onClick={presetNordics} style={presetBtn}>
          Select Nordics
        </button>
        <button type="button" onClick={presetWave1} style={presetBtn}>
          Select Wave 1
        </button>
        <button type="button" onClick={clearAll} style={presetBtn}>
          Clear
        </button>
      </div>

      <div
        style={{
          maxHeight: 560,
          overflowY: "auto",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              fontSize: 12,
              color: "var(--text-faint)",
              textAlign: "center",
            }}
          >
            No customers match “{filter}”.
          </div>
        ) : (
          filtered.map((c) => {
            const checked = selectedIds.has(c.campaign_partner_id);
            return (
              <label
                key={c.campaign_partner_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border-soft, var(--border))",
                  background: checked ? "var(--accent-softer)" : "var(--surface)",
                  cursor: "pointer",
                  alignItems: "flex-start",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(c.campaign_partner_id)}
                  style={{ marginTop: 2 }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {c.firm_name ?? "— unnamed —"}{" "}
                    {c.wave ? (
                      <WaveTag wave={c.wave} />
                    ) : null}
                  </div>
                  {c.pitch_hook ? (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        marginTop: 3,
                      }}
                    >
                      {c.pitch_hook}
                    </div>
                  ) : null}
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-faint)",
                      marginTop: 3,
                    }}
                  >
                    {[c.country_iso, c.type, c.hq_location]
                      .filter(Boolean)
                      .join(" · ")}
                    {c.expected_ebitda_gbp
                      ? ` · £${Math.round(c.expected_ebitda_gbp / 1000)}K EBITDA`
                      : ""}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--text-faint)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.contact_count}{" "}
                  {c.contact_count === 1 ? "contact" : "contacts"}
                </div>
              </label>
            );
          })
        )}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
          {selectedIds.size} selected of {customers.length}
        </div>
        <PrimaryButton onClick={onContinue}>Continue →</PrimaryButton>
      </div>
    </StepCard>
  );
}

/* ───────────────────────── Step 5 — Email resolve ─────────────────────────── */

function Step5EmailResolve({
  customers,
  onContinue,
  setToast,
}: {
  customers: CustomerCampaignPartnerCard[];
  onContinue: () => void;
  setToast: (s: string | null) => void;
}) {
  // Lazy-load each selected customer's contact directory so we can
  // tell "has email / no email on file" per row. Populated on mount.
  const [emailByCpId, setEmailByCpId] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [primaryPartnerIdByCpId, setPrimaryPartnerIdByCpId] = useState<
    Map<string, number | null>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Dep on a stable STRING derived from the selected ids, not the
  // customers array itself. Previously the effect dep'd on `customers`
  // which is re-created on every parent render by Array.filter — so
  // the effect looped: setLoading(true) → process → setLoading(false)
  // → re-render → new `customers` reference → effect reruns → …
  // Tristan 2026-04-24: "for a glimmer of a second, it looked as
  // though the emails popped up" was the flicker between loops.
  const cpIdsKey = useMemo(
    () =>
      customers
        .map((c) => c.campaign_partner_id)
        .sort()
        .join(","),
    [customers],
  );
  const [loadedCount, setLoadedCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function loadAll() {
      setLoading(true);
      setLoadedCount(0);
      const ids = cpIdsKey ? cpIdsKey.split(",").filter(Boolean) : [];
      if (ids.length === 0) {
        if (!cancelled) {
          setEmailByCpId(new Map());
          setPrimaryPartnerIdByCpId(new Map());
          setLoading(false);
        }
        return;
      }
      // Parallel fetch instead of sequential — 23 rows go from ~1.5s
      // to ~150ms on the dev server. Tristan 2026-04-24 saw the "flash"
      // because sequential load completed in ~2s and the loader
      // appeared stuck for the first 2s. Parallel + a visible
      // counter kills both perceptions.
      let done = 0;
      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const dir = await loadContactDirectory(id);
            done += 1;
            if (!cancelled) setLoadedCount(done);
            if (!dir) return null;
            const current = dir.contacts.find((x) => x.is_current);
            return {
              id,
              email:
                current?.email && current.email.trim().length > 0
                  ? current.email
                  : null,
              partnerId: current?.partner_id ?? null,
            };
          } catch {
            done += 1;
            if (!cancelled) setLoadedCount(done);
            return null;
          }
        }),
      );
      if (cancelled) return;
      const nextEmail = new Map<string, string | null>();
      const nextPartner = new Map<string, number | null>();
      for (const r of results) {
        if (!r) continue;
        nextEmail.set(r.id, r.email);
        nextPartner.set(r.id, r.partnerId);
      }
      setEmailByCpId(nextEmail);
      setPrimaryPartnerIdByCpId(nextPartner);
      setLoading(false);
    }
    loadAll();
    return () => {
      cancelled = true;
    };
  }, [cpIdsKey]);

  const withEmail = customers.filter(
    (c) =>
      emailByCpId.get(c.campaign_partner_id) &&
      emailByCpId.get(c.campaign_partner_id)!.length > 0,
  );
  const withoutEmail = customers.filter(
    (c) => !emailByCpId.get(c.campaign_partner_id),
  );

  async function saveInline(cpId: string, email: string) {
    const partnerId = primaryPartnerIdByCpId.get(cpId);
    if (!partnerId) {
      setToast("No primary contact on this row — switch contact first.");
      return;
    }
    setSavingId(cpId);
    const r = await setPartnerEmail(partnerId, email);
    setSavingId(null);
    if (!r.ok) {
      setToast(`Error: ${r.error}`);
      return;
    }
    const next = new Map(emailByCpId);
    next.set(cpId, email.trim().toLowerCase());
    setEmailByCpId(next);
    setToast("Email saved.");
  }

  return (
    <StepCard
      number={5}
      title="Email resolution"
      intro={`${withEmail.length} have an email on file · ${withoutEmail.length} need one. Type in the missing ones inline, or use the email-hunt flow on /tracker for Hunter-verified lookups.`}
    >
      {loading ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-dim)" }}>
          Checking contact emails… {loadedCount} / {customers.length}
        </div>
      ) : (
        <div>
          {withoutEmail.length > 0 ? (
            <div style={{ marginBottom: 18 }}>
              <div style={sectionSubheader}>Need an email ({withoutEmail.length})</div>
              {withoutEmail.map((c) => (
                <EmailRow
                  key={c.campaign_partner_id}
                  customer={c}
                  currentEmail={null}
                  primaryPartnerId={
                    primaryPartnerIdByCpId.get(c.campaign_partner_id) ?? null
                  }
                  saving={savingId === c.campaign_partner_id}
                  onSave={(email) => saveInline(c.campaign_partner_id, email)}
                  onHunterSaved={(email) => {
                    const next = new Map(emailByCpId);
                    next.set(c.campaign_partner_id, email);
                    setEmailByCpId(next);
                  }}
                  setToast={setToast}
                />
              ))}
            </div>
          ) : null}

          {withEmail.length > 0 ? (
            <div>
              <div style={sectionSubheader}>Ready ({withEmail.length})</div>
              {withEmail.map((c) => (
                <EmailRow
                  key={c.campaign_partner_id}
                  customer={c}
                  currentEmail={emailByCpId.get(c.campaign_partner_id) ?? null}
                  primaryPartnerId={
                    primaryPartnerIdByCpId.get(c.campaign_partner_id) ?? null
                  }
                  saving={savingId === c.campaign_partner_id}
                  onSave={(email) => saveInline(c.campaign_partner_id, email)}
                  onHunterSaved={(email) => {
                    const next = new Map(emailByCpId);
                    next.set(c.campaign_partner_id, email);
                    setEmailByCpId(next);
                  }}
                  setToast={setToast}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      <PrimaryButton onClick={onContinue}>Continue →</PrimaryButton>
    </StepCard>
  );
}

function EmailRow({
  customer,
  currentEmail,
  primaryPartnerId,
  saving,
  onSave,
  onHunterSaved,
  setToast,
}: {
  customer: CustomerCampaignPartnerCard;
  currentEmail: string | null;
  primaryPartnerId: number | null;
  saving: boolean;
  onSave: (email: string) => void;
  onHunterSaved: (email: string) => void;
  setToast: (s: string | null) => void;
}) {
  const [value, setValue] = useState<string>(currentEmail ?? "");
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto auto",
        gap: 10,
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-soft, var(--border))",
        alignItems: "center",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{customer.firm_name}</div>
        <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
          {customer.partner_name ?? "— no contact name —"}{" "}
          {customer.partner_title ? `· ${customer.partner_title}` : ""}
        </div>
      </div>
      <input
        type="email"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="name@firm.com"
        style={{
          padding: "5px 8px",
          fontSize: 12,
          border: "1px solid var(--border)",
          borderRadius: 4,
          minWidth: 220,
        }}
      />
      <button
        type="button"
        onClick={() => onSave(value)}
        disabled={saving || value.trim().length === 0}
        style={{
          padding: "5px 10px",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--accent)",
          background: "var(--surface)",
          border: "1px solid var(--accent)",
          borderRadius: 4,
          cursor: saving ? "wait" : "pointer",
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <HunterRow
        campaignPartnerId={customer.campaign_partner_id}
        firmName={customer.firm_name}
        primaryPartnerId={primaryPartnerId}
        onSaved={onHunterSaved}
        setToast={setToast}
      />
    </div>
  );
}

/* ───────────────────────── Step 6 — Template ──────────────────────────────── */

function Step6Template({
  template,
  onChange,
  onSave,
  isPending,
}: {
  template: string;
  onChange: (v: string) => void;
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <StepCard
      number={6}
      title="Template"
      intro="The agreed template for this batch. Opus uses this as the voice reference when drafting per-customer emails in Step 7. Each draft will be tailored to the specific customer (pitch hook, country, channel) but the structure + voice comes from here."
    >
      <textarea
        value={template}
        onChange={(e) => onChange(e.target.value)}
        rows={20}
        style={textareaStyle}
      />
      <PrimaryButton onClick={onSave} pending={isPending}>
        Save + Continue →
      </PrimaryButton>
    </StepCard>
  );
}

/* ───────────────────────── Step 7 — Draft ─────────────────────────────────── */

function Step7Draft({
  selectedCount,
  selectedIds,
  campaignId,
  onDraftAll,
  onContinue,
  isPending,
}: {
  selectedCount: number;
  selectedIds: Set<string>;
  campaignId: string;
  onDraftAll: () => void;
  onContinue: () => void;
  isPending: boolean;
}) {
  return (
    <StepCard
      number={7}
      title="Draft all"
      intro={`Opus produces a per-customer draft for each of the ${selectedCount} ticked rows, using the template from Step 6 as the voice reference and the customer's pitch hook + bio + channel + country as the personalisation inputs. Takes ~10s per row — 10 rows ≈ 100s.`}
    >
      <div
        style={{
          padding: 14,
          background: "var(--surface-alt)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        Each row gets a tailored "why them" paragraph + a 2-5 word subject
        angle cached against the campaign_partner row. Promotes each
        drafted row to <b>+2 Drafted — ready to send</b>. Once drafted,
        you can open any row on <code>/tracker/[id]/draft</code> to see
        the full composed email before approving.
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PrimaryButton onClick={onDraftAll} pending={isPending}>
          {isPending ? "Drafting…" : `Draft all ${selectedCount} →`}
        </PrimaryButton>
        <button type="button" onClick={onContinue} style={presetBtn}>
          Skip (already drafted)
        </button>
      </div>
      {selectedCount > 0 ? (
        <div style={{ marginTop: 14 }}>
          <div style={sectionSubheader}>Quick-open any draft:</div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {Array.from(selectedIds)
              .slice(0, 10)
              .map((id) => (
                <li key={id}>
                  <Link
                    href={`/tracker/${id}/draft`}
                    style={{
                      display: "block",
                      padding: "4px 0",
                      fontSize: 11,
                      color: "var(--accent)",
                    }}
                  >
                    Open draft → {id.slice(0, 8)}…
                  </Link>
                </li>
              ))}
            {selectedCount > 10 ? (
              <li
                style={{
                  padding: "4px 0",
                  fontSize: 11,
                  color: "var(--text-faint)",
                }}
              >
                +{selectedCount - 10} more
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </StepCard>
  );
}

/* ───────────────────────── Step 8 — Approve ───────────────────────────────── */

function Step8Approve({
  customers,
  approvedIds,
  onToggle,
  onApprove,
  isPending,
}: {
  customers: CustomerCampaignPartnerCard[];
  approvedIds: Set<string>;
  onToggle: (id: string) => void;
  onApprove: () => void;
  isPending: boolean;
}) {
  return (
    <StepCard
      number={8}
      title="Approve batch"
      intro={`Tick each draft you're happy to send. Ticked rows get promoted to +1 Approved — awaiting dispatch. The DB-level approval gate means only +1/+2 rows can reach the send queue in Step 9.`}
    >
      {customers.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-faint)" }}>
          No drafted rows in this batch. Back up to Step 7 to draft.
        </div>
      ) : (
        <div
          style={{
            maxHeight: 480,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {customers.map((c) => {
            const checked = approvedIds.has(c.campaign_partner_id);
            return (
              <div
                key={c.campaign_partner_id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border-soft, var(--border))",
                  background: checked
                    ? "var(--accent-softer)"
                    : "var(--surface)",
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(c.campaign_partner_id)}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {c.firm_name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                    {[c.country_iso, c.partner_name, c.partner_title]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Link
                  href={`/tracker/${c.campaign_partner_id}/draft`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 11,
                    color: "var(--accent)",
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  Open draft ↗
                </Link>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <PrimaryButton onClick={onApprove} pending={isPending}>
          {isPending
            ? "Approving…"
            : `Approve ${approvedIds.size} → queue`}
        </PrimaryButton>
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {approvedIds.size} of {customers.length} approved
        </div>
      </div>
    </StepCard>
  );
}

/* ───────────────────────── Step 9 — Queue ─────────────────────────────────── */

function Step9Queue({
  customers,
  onQueue,
  isPending,
  campaignId,
}: {
  customers: CustomerCampaignPartnerCard[];
  onQueue: (sendAtUtc: string) => void;
  isPending: boolean;
  campaignId: string;
}) {
  // Default send time: tomorrow 07:00 local (converted to UTC).
  const defaultSendAt = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(7, 0, 0, 0);
    // Format as yyyy-MM-ddTHH:mm for datetime-local
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }, []);
  const [sendAt, setSendAt] = useState<string>(defaultSendAt);

  return (
    <StepCard
      number={9}
      title="Queue + send"
      intro={`Final review. ${customers.length} approved rows below go into the scheduled_sends queue. Pick a start time; rows spread over a 60-minute window. The dispatcher daemon sends them at their scheduled UTC moment — it runs on your local Mac via launchd every 60s.`}
    >
      {customers.length === 0 ? (
        <div style={{ padding: 16, fontSize: 12, color: "var(--text-faint)" }}>
          No approved rows. Back up to Step 8 to approve.
        </div>
      ) : (
        <div
          style={{
            maxHeight: 420,
            overflowY: "auto",
            border: "1px solid var(--border)",
            borderRadius: 8,
            marginBottom: 14,
          }}
        >
          {customers.map((c) => (
            <div
              key={c.campaign_partner_id}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                borderBottom: "1px solid var(--border-soft, var(--border))",
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
              }}
            >
              <div>
                <b>{c.firm_name}</b>{" "}
                <span style={{ color: "var(--text-faint)" }}>
                  {c.country_iso} · {c.partner_name}
                </span>
              </div>
              <Link
                href={`/tracker/${c.campaign_partner_id}/draft`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11,
                  color: "var(--accent)",
                  textDecoration: "none",
                }}
              >
                Review ↗
              </Link>
            </div>
          ))}
        </div>
      )}
      <label
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
          fontSize: 12,
          color: "var(--text-dim)",
        }}
      >
        Start at:
        <input
          type="datetime-local"
          value={sendAt}
          onChange={(e) => setSendAt(e.target.value)}
          style={{
            padding: "5px 8px",
            fontSize: 12,
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <PrimaryButton
          onClick={() => {
            const iso = new Date(sendAt).toISOString();
            onQueue(iso);
          }}
          pending={isPending}
        >
          {isPending ? "Queueing…" : `Queue ${customers.length} sends`}
        </PrimaryButton>
        <Link
          href={`/approval/scheduled?c=${campaignId}`}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: "var(--text-dim)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            textDecoration: "none",
          }}
        >
          Open scheduled queue →
        </Link>
      </div>
    </StepCard>
  );
}

/* ───────────────────────── Shared primitives ──────────────────────────────── */

function StepCard({
  number,
  title,
  intro,
  children,
}: {
  number: number;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: 20,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Step {number}
        </span>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
      </div>
      <p
        style={{
          margin: "0 0 16px 0",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--text-dim)",
        }}
      >
        {intro}
      </p>
      {children}
    </div>
  );
}

function PrimaryButton({
  onClick,
  children,
  pending,
}: {
  onClick: () => void;
  children: React.ReactNode;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        padding: "8px 16px",
        fontSize: 13,
        fontWeight: 600,
        color: "white",
        background: pending ? "var(--accent-softer)" : "var(--accent)",
        border: "none",
        borderRadius: 6,
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function WaveTag({ wave }: { wave: "1" | "2" | "3" | "niche" }) {
  const label = wave === "niche" ? "Niche" : `W${wave}`;
  const bg =
    wave === "1"
      ? "#dcfce7"
      : wave === "2"
        ? "#e0e7ff"
        : wave === "3"
          ? "#fef3c7"
          : "#f1f5f9";
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        textTransform: "uppercase",
        padding: "1px 5px",
        borderRadius: 3,
        background: bg,
        color: "#1f2937",
        marginLeft: 4,
      }}
    >
      {label}
    </span>
  );
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: 12,
  fontSize: 13,
  fontFamily: "inherit",
  lineHeight: 1.55,
  border: "1px solid var(--border)",
  borderRadius: 8,
  resize: "vertical",
  marginBottom: 12,
};

const sectionSubheader: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.6,
  marginBottom: 6,
};

const presetBtn: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 11,
  color: "var(--text-dim)",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  cursor: "pointer",
};
