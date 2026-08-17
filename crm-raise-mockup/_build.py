#!/usr/bin/env python3
"""Emit the nine Raise Desk dummy pages. Dummy only — no production wiring."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES = [
    ("index.html", "Today", "today"),
    ("company.html", "Company", "company"),
    ("person.html", "Person", "person"),
    ("firm.html", "Firm", "firm"),
    ("inbox.html", "Inbox", "inbox"),
    ("calendar.html", "Calendar", "calendar"),
    ("excel.html", "Excel", "excel"),
    ("review.html", "Review", "review"),
    ("gap-audit.html", "Audit", "audit"),
]


def chrome(active: str) -> str:
    pills = []
    for href, label, key in PAGES:
        cls = "pill active" if key == active else "pill"
        pills.append(f'<a class="{cls}" href="{href}">{label}</a>')
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raise desk — dummy</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<header class="topbar">
  <div class="brand"><span class="dot"></span> Forge Capital <span class="sub">Raise desk</span></div>
  <nav class="topnav">{"".join(pills)}</nav>
  <div class="raise-chip"><span>View</span> All raises</div>
</header>
<div class="dummy-banner"><strong>Dummy site.</strong> Invented names. Nothing is wired to Gmail, Calendar, or the live database. Create-draft buttons do not send. Approval gate stays visible.</div>
"""


FOOT = """
<p class="faint" style="margin-top:28px">Dummy only · 16 Aug 2026 · plan at RAISE-DESK-PLAN.md · no production schema changed</p>
</div>
</body>
</html>
"""


def page(active, title, lede, body):
    return chrome(active) + f'<div class="wrap"><div class="page-head"><h1>{title}</h1><p>{lede}</p></div>' + body + FOOT


pages = {}

pages["index.html"] = page(
    "today",
    "Today — Sunday 17 August",
    "All eight raises. Work queue, not another dashboard. Double-ask and Jordan blocks sit at the top so a 200-email wave cannot hide them.",
    """
<div class="tiles">
  <div class="tile"><div class="k">Meetings (7 days)</div><div class="n">3</div><div class="s">1 unmatched attendee</div></div>
  <div class="tile"><div class="k">Unfiled replies</div><div class="n">4</div><div class="s">1 mentions two raises</div></div>
  <div class="tile"><div class="k">Follow-ups due</div><div class="n">11</div><div class="s">across 5 raises</div></div>
  <div class="tile warn"><div class="k">Stuck &gt; 7 days</div><div class="n">38</div><div class="s">+0 or +3 with no reply</div></div>
  <div class="tile bad"><div class="k">Double-ask</div><div class="n">2</div><div class="s">same person, two live raises</div></div>
</div>

<div class="block-banner"><strong>Do not send — Helena Voss, Northwind Ventures.</strong> Jordan rule <em>DO_NOT_OUTREACH</em> on Odysseus. She is also +8 Meeting scheduled on SkySails (Tuesday) and +5 Follow-up sent on FishFrom. Person-global block beats any campaign +2.</div>

<div class="warn-banner"><strong>Double-ask:</strong> Casper Hale at Meridian Peak is +3 Email sent on US Arbitrage (27 Jul, Fractional Forge mailbox) and +0 Pending approval on Space Solar. Approval card must show both raises before a queue.</div>

<div class="grid-2">
  <div class="card">
    <h2>Next meetings</h2>
    <p class="sub">From Google Calendar ingest. Unmatched attendees go to Review.</p>
    <table>
      <tr><th>When</th><th>Who</th><th>Raise</th><th></th></tr>
      <tr class="clickable"><td>Tue 18 Aug · 15:00</td><td><a href="person.html">Helena Voss</a> · Northwind</td><td><span class="badge b-raise">SkySails</span></td><td><span class="badge b-progress">+8 scheduled</span></td></tr>
      <tr class="clickable"><td>Wed 19 Aug · 10:30</td><td>Olivier Moreau · Panatere counterpart</td><td><span class="badge b-raise">Panatere</span></td><td><span class="badge b-ok">internal</span></td></tr>
      <tr class="clickable"><td>Thu 20 Aug · 09:00</td><td>unknown@lattice.example</td><td><span class="badge b-pending">unmatched</span></td><td><a href="review.html">File this</a></td></tr>
    </table>
  </div>
  <div class="card">
    <h2>Approvals — queue, not send</h2>
    <p class="sub">Nothing enters scheduled_sends unless status is +1 or +2 <em>and</em> permission is approved or not_required. This button does not send.</p>
    <table>
      <tr><th>Person</th><th>Raise</th><th>Status</th><th>Permission</th></tr>
      <tr><td><a href="person.html">Helena Voss</a></td><td>FishFrom</td><td><span class="badge b-progress">+5 follow-up</span></td><td><span class="badge b-ok">not required</span></td></tr>
      <tr><td>Casper Hale</td><td>Space Solar</td><td><span class="badge b-pending">+1 awaiting draft</span></td><td><span class="badge b-pending">pending approval</span></td></tr>
      <tr><td>Ivo Kertesz</td><td>Odysseus</td><td><span class="badge b-pending">+1 draft held</span></td><td><span class="badge b-dead">DO_NOT — blocked</span></td></tr>
    </table>
    <div class="btn-row" style="padding:0 16px 14px">
      <span class="btn btn-primary">Create Gmail draft — dummy, does not send</span>
      <span class="btn">Open in Gmail — human send, not gated</span>
    </div>
  </div>
</div>

<div class="card" style="margin-top:16px">
  <h2>Stuck more than 7 days</h2>
  <p class="sub">Status +0 or +3, no inbound event. Sorted by raise so a 200-row wave is visible as a wave.</p>
  <table>
    <tr><th>Raise</th><th>Stuck</th><th>Oldest</th><th></th></tr>
    <tr><td><a href="company.html">SkySails</a></td><td>9</td><td>44 days · 10x Founders</td><td><a href="company.html">Open raise</a></td></tr>
    <tr><td>FishFrom</td><td>14</td><td>78 days · 10x Group</td><td>Open raise</td></tr>
    <tr><td>Space Solar</td><td>12</td><td>18 days · 137 Ventures</td><td>Open raise</td></tr>
    <tr><td>Odysseus</td><td>3</td><td>Jordan “No answer” still in free text</td><td><a href="review.html">Review queue</a></td></tr>
  </table>
</div>
""",
)

pages["company.html"] = page(
    "company",
    "SkySails Power — this raise",
    "One company, two hundred names. Permission is a column, not a status. Cross-raise chips show when the same person is live elsewhere.",
    """
<div class="tiles">
  <div class="tile"><div class="k">On this raise</div><div class="n">473</div><div class="s">ticked on the 260812 book</div></div>
  <div class="tile"><div class="k">+0 pending</div><div class="n">37</div><div class="s">need counterpart or you</div></div>
  <div class="tile"><div class="k">+3 / +5 sent</div><div class="n">151</div><div class="s">waiting on a reply</div></div>
  <div class="tile"><div class="k">−3 disqualified</div><div class="n">130</div><div class="s">closed</div></div>
  <div class="tile warn"><div class="k">Also on another raise</div><div class="n">61</div><div class="s">see person before you send</div></div>
</div>
<div class="note">Stephan counterpart sheet: export is name + website only (Rule 10). Status stays on this desk.</div>
<div class="kanban">
  <div class="col"><h3>Pending</h3>
    <div class="chip-row">10x Founders<br><span class="badge b-pending">+0</span> <span class="badge b-pending">permission pending</span></div>
    <div class="chip-row">Lattice Capital<br><span class="badge b-pending">+1 draft held</span></div>
  </div>
  <div class="col"><h3>In motion</h3>
    <div class="chip-row"><a href="person.html">Helena Voss</a><br><span class="badge b-progress">+8 Tue 15:00</span> <span class="badge b-dead">Odysseus blocked</span></div>
    <div class="chip-row">10x Group<br><span class="badge b-progress">+5 follow-up</span></div>
  </div>
  <div class="col"><h3>Committed family</h3>
    <div class="chip-row">Example hold<br><span class="badge b-ok">+10 NDA</span></div>
  </div>
  <div class="col"><h3>Dead</h3>
    <div class="chip-row">Bounced last spring<br><span class="badge b-dead">−2</span></div>
  </div>
</div>
<div class="card">
  <h2>Tracker — this raise only</h2>
  <p class="sub">Company view hides other-raise event bodies and shows a count instead.</p>
  <table>
    <tr><th>Person</th><th>Firm</th><th>Status</th><th>Permission</th><th>Other raises</th><th>Last touch</th></tr>
    <tr class="clickable"><td><a href="person.html">Helena Voss</a></td><td><a href="firm.html">Northwind Ventures</a></td><td><span class="badge b-progress">+8 Meeting scheduled</span></td><td><span class="badge b-ok">not required</span></td><td>FishFrom +5 · Odysseus blocked</td><td>Calendar · Tue</td></tr>
    <tr><td>Jan Reichelt</td><td>10x Founders</td><td><span class="badge b-pending">+0 Pending approval</span></td><td><span class="badge b-pending">pending approval</span></td><td>—</td><td>44 days</td></tr>
    <tr><td>Andreas Etten</td><td>10x Group</td><td><span class="badge b-progress">+5 Follow-up sent</span></td><td><span class="badge b-ok">approved</span></td><td>—</td><td>78 days</td></tr>
  </table>
  <div class="btn-row" style="padding:0 16px 14px">
    <span class="btn">Add from Forge Capital</span>
    <span class="btn">Export counterpart Excel</span>
    <span class="btn btn-ghost">Create Gmail draft — dummy</span>
  </div>
</div>
""",
)

pages["person.html"] = page(
    "person",
    "Helena Voss — talking about three companies",
    "This is the operator surface. No single overall status. Each raise has its own code. The Odysseus block is why a FishFrom follow-up still needs a reason.",
    """
<div class="block-banner"><strong>Person-global block · Odysseus · Jordan DO_NOT_OUTREACH.</strong> Visible on his list: ongoing discussions or held for later. A +2 on SkySails or FishFrom does not lift this. Override needs a written reason on the queued send.</div>
<div class="raise-cards">
  <div class="raise-card">
    <h3>SkySails Power</h3>
    <div><span class="badge b-progress">+8 Meeting scheduled</span></div>
    <p class="faint" style="margin-top:8px">Tue 18 Aug · 15:00 · your calendar<br>Permission: not required<br>Last event: calendar ingest</p>
    <div class="btn-row"><span class="btn">Set status</span></div>
  </div>
  <div class="raise-card">
    <h3>FishFrom</h3>
    <div><span class="badge b-progress">+5 Follow-up sent</span></div>
    <p class="faint" style="margin-top:8px">Last outbound 1 Jul<br>Permission: not required<br>14-day cooldown from Odysseus −1? No — Odysseus is a policy block, not a decline code.</p>
    <div class="btn-row"><span class="btn btn-primary">Create Gmail draft — dummy</span></div>
  </div>
  <div class="raise-card blocked">
    <h3>Odysseus Space</h3>
    <div><span class="badge b-dead">blocked · DO_NOT_OUTREACH</span></div>
    <p class="faint" style="margin-top:8px">Jordan statut: Ongoing discussions<br>Imported as contact_policy, not as +8<br>status_raw preserved</p>
  </div>
</div>
<div class="grid-2">
  <div class="card">
    <h2>Timeline — person, not raise</h2>
    <p class="sub">Company view would hide the Odysseus note body and show “1 other-raise event hidden”.</p>
    <div class="timeline">
      <div class="tl-item"><div class="faint">Tue 18 Aug</div><div class="tl-dot meet"></div><div><strong>Meeting scheduled</strong> · SkySails · calendar<br><span class="muted">Attendees matched on helena@northwind.example</span></div></div>
      <div class="tl-item"><div class="faint">15 Jul</div><div class="tl-dot block"></div><div><strong>Jordan import</strong> · Odysseus<br><span class="muted">“1st meeting 19 May. Followed up by JV 15 Jul.” Stored as a note, not as a fake +8.</span></div></div>
      <div class="tl-item"><div class="faint">1 Jul</div><div class="tl-dot"></div><div><strong>Follow-up sent</strong> · FishFrom · gmail<br><span class="muted">Thread filed to FishFrom. Open in Gmail is a human send.</span></div></div>
      <div class="tl-item"><div class="faint">4 May</div><div class="tl-dot note"></div><div><strong>Added from Forge Capital</strong> · FishFrom<br><span class="muted">Commentary imported as a manual note. Raw text kept.</span></div></div>
    </div>
  </div>
  <div class="card">
    <h2>From the encyclopaedia</h2>
    <p class="sub">Read-only. Raise desk does not write back to Forge Capital.</p>
    <table>
      <tr><th>Firm</th><td><a href="firm.html">Northwind Ventures</a></td></tr>
      <tr><th>Title</th><td>Partner, climate hardware</td></tr>
      <tr><th>Email</th><td>helena@northwind.example · hunter_verified</td></tr>
      <tr><th>Cheque</th><td>$500k–$2m · Seed / Series A</td></tr>
      <tr><th>Thesis</th><td>Invented: airborne wind, land-based aquaculture, hard climate.</td></tr>
    </table>
    <div style="padding:12px 16px 16px">
      <span class="btn">Log a Wispr note</span>
      <span class="btn btn-ghost">Open in Gmail — human send</span>
    </div>
  </div>
</div>
""",
)

pages["firm.html"] = page(
    "firm",
    "Northwind Ventures",
    "The fund is not the tracker row. Two partners can be in play on the same raise — that is two campaign_partners rows. The wide Excel cannot say this.",
    """
<div class="warn-banner"><strong>Already contacted here.</strong> Helena is live on SkySails and FishFrom. A new Odysseus approach is blocked by Jordan. Adding a second partner to SkySails is allowed; it is a new row, not a cell overwrite.</div>
<div class="grid-2">
  <div class="card">
    <h2>Partners at this firm</h2>
    <p class="sub">Import rule: if a spreadsheet row matches the firm but the firm has several partners and no unique email, it goes to the Review queue. Never pick one.</p>
    <table>
      <tr><th>Person</th><th>Raises</th><th></th></tr>
      <tr><td><a href="person.html">Helena Voss</a> · Partner</td><td>SkySails +8 · FishFrom +5 · Odysseus blocked</td><td>primary</td></tr>
      <tr><td>Marcus Abel · Principal</td><td>none</td><td>in encyclopaedia only</td></tr>
      <tr><td>Priya Shah · Venture partner</td><td>none</td><td>in encyclopaedia only</td></tr>
    </table>
  </div>
  <div class="card">
    <h2>Encyclopaedia (read-only)</h2>
    <table>
      <tr><th>Website</th><td>northwind.example</td></tr>
      <tr><th>HQ</th><td>London</td></tr>
      <tr><th>Stage</th><td>Seed – Series A</td></tr>
      <tr><th>Sectors</th><td>Climate, hardware, food systems</td></tr>
      <tr><th>Forge Capital id</th><td>not a real id — dummy</td></tr>
    </table>
  </div>
</div>
""",
)

pages["inbox.html"] = page(
    "inbox",
    "Inbox — inbound, all raises",
    "Replies land on the person. If the thread could be two raises, it stays unfiled until you pick. Filing is stored on the thread so sync does not ask again.",
    """
<div class="card">
  <h2>Unfiled first</h2>
  <table>
    <tr><th>When</th><th>From</th><th>Subject</th><th>Guess</th><th></th></tr>
    <tr><td>today 08:12</td><td>Casper Hale</td><td>Re: Space Solar / also the US note</td><td><span class="badge b-pending">two raises</span></td><td><span class="btn">File to raise</span></td></tr>
    <tr><td>yesterday</td><td>unknown@lattice.example</td><td>Intro from Thursday</td><td><span class="badge b-pending">no person</span></td><td><a href="review.html">Review</a></td></tr>
  </table>
</div>
<div class="card" style="margin-top:16px">
  <h2>Filed</h2>
  <table>
    <tr><th>When</th><th>From</th><th>Raise</th><th>Status on that raise</th><th></th></tr>
    <tr><td>1 Jul</td><td><a href="person.html">Helena Voss</a></td><td><span class="badge b-raise">FishFrom</span></td><td><span class="badge b-progress">+5</span></td><td>Open in Gmail</td></tr>
    <tr><td>27 Jul</td><td>Casper Hale</td><td><span class="badge b-raise">US Arb</span></td><td><span class="badge b-progress">+3</span></td><td>mailbox: Fractional Forge</td></tr>
  </table>
</div>
<div class="note" style="margin-top:16px">Second mailbox is labelled, not hidden. Phase 1 documents the gap; the desk still attaches the event to the person.</div>
""",
)

pages["calendar.html"] = page(
    "calendar",
    "Calendar — this week",
    "Meetings from the primary Google Calendar. Unmatched attendees are a Review item, not a silent skip.",
    """
<div class="cal">
  <div class="hd"></div>
  <div class="hd">Mon 17</div>
  <div class="hd">Tue 18</div>
  <div class="hd">Wed 19</div>
  <div class="hd">Thu 20</div>
  <div class="hd">Fri 21</div>
  <div class="hour">09:00</div><div></div><div></div><div></div>
  <div><div class="evt unmatched"><a href="review.html">unknown@lattice</a><br>unmatched</div></div><div></div>
  <div class="hour">10:00</div><div></div><div></div>
  <div><div class="evt">Olivier · Panatere</div></div><div></div><div></div>
  <div class="hour">15:00</div><div></div>
  <div><div class="evt"><a href="person.html">Helena Voss</a><br>SkySails +8</div></div>
  <div></div><div></div><div></div>
</div>
<p class="faint" style="margin-top:12px">Dummy week. Recurring events and cancellations are append-only in the real desk (new event or a cancel note), not a silent edit.</p>
""",
)

pages["excel.html"] = page(
    "excel",
    "Excel is a download",
    "The desk writes the file. You do not write the file. Filename never contains CANONICAL. Watermark is not a lock — old books live in archive/read-only.",
    """
<div class="note">Generated 16 Aug 2026 07:00 · raise_person_id on every row · snapshot — edit in the desk.</div>
<div class="grid-2">
  <div class="card">
    <h2>Master (wide)</h2>
    <p class="sub">Same grouped headers as 260812. If two people at one firm are on one raise, that is two rows: “Northwind Ventures — Helena Voss”.</p>
    <div class="btn-row" style="padding:0 16px 16px"><span class="btn btn-primary">Download master snapshot — dummy</span></div>
    <table>
      <tr><th>Would contain</th><td>8 raise groups · First / Latest / Days / Status / last 3 events · no commentary diary</td></tr>
      <tr><th>Would not contain</th><td>the word CANONICAL · live formulas that agents edit</td></tr>
    </table>
  </div>
  <div class="card">
    <h2>Per-raise counterpart</h2>
    <p class="sub">Stephan / Andrew / Jordan shape. Permission column explicit. Name + website for the permission email.</p>
    <div class="btn-row" style="padding:0 16px 16px">
      <span class="btn">SkySails for Stephan</span>
      <span class="btn">FishFrom for Andrew</span>
      <span class="btn">Odysseus for Jordan</span>
    </div>
  </div>
</div>
<div class="warn-banner" style="margin-top:16px">Import is preview-only. Ambiguous firm matches cannot apply. After cutover, an agent write to a tracker-shaped xlsx is a named failure.</div>
""",
)

pages["review.html"] = page(
    "review",
    "Review queue — cutover lives here",
    "Every ticked spreadsheet cell needs a disposition: matched, local stub, excluded, or unresolved. Unresolved ticked cells block cutover. This is the ninth page the council asked for.",
    """
<div class="tiles">
  <div class="tile"><div class="k">Ticked cells (260812)</div><div class="n">3,607</div><div class="s">sum of eight company ticks</div></div>
  <div class="tile"><div class="k">Matched unique person</div><div class="n">—</div><div class="s">dummy · not a live import</div></div>
  <div class="tile warn"><div class="k">Need you</div><div class="n">4</div><div class="s">examples below</div></div>
  <div class="tile bad"><div class="k">Drift (dual-run)</div><div class="n">1</div><div class="s">DB wins unless you waive</div></div>
  <div class="tile"><div class="k">Unmapped status</div><div class="n">1</div><div class="s">import_needs_review</div></div>
</div>
<div class="card">
  <h2>Need a person decision</h2>
  <p class="sub">Firm matched. Several partners. Spreadsheet email empty or shared. Never auto-pick.</p>
  <table>
    <tr><th>Spreadsheet firm</th><th>Matched firm</th><th>Partners on file</th><th></th></tr>
    <tr><td>Northwind Ventures</td><td><a href="firm.html">Northwind Ventures</a></td><td>Helena Voss · Marcus Abel · Priya Shah</td><td><span class="btn">Pick person</span> <span class="btn">Make stub</span></td></tr>
  </table>
</div>
<div class="card" style="margin-top:16px">
  <h2>Unmapped status</h2>
  <table>
    <tr><th>Firm</th><th>Raise</th><th>status_raw</th><th>Proposal</th></tr>
    <tr><td>0100.vc</td><td>Odysseus</td><td>Ongoing discussions</td><td>null + import_needs_review · contact_policy from Jordan visible row</td></tr>
  </table>
</div>
<div class="card" style="margin-top:16px">
  <h2>Drift — database already won</h2>
  <p class="sub">Someone edited the nightly export out of habit. Gate is drift count = 0, not “explained”.</p>
  <table>
    <tr><th>Person</th><th>Raise</th><th>Desk</th><th>Excel edit</th><th></th></tr>
    <tr><td>Andreas Etten</td><td>SkySails</td><td>+5 Follow-up sent</td><td>+3 Email sent</td><td>Keep desk · waive</td></tr>
  </table>
</div>
<div class="card" style="margin-top:16px">
  <h2>Unmatched attendee</h2>
  <table>
    <tr><th>When</th><th>Email</th><th></th></tr>
    <tr><td>Thu 20 Aug 09:00</td><td>unknown@lattice.example</td><td>Link to person · ignore</td></tr>
  </table>
</div>
""",
)

pages["gap-audit.html"] = page(
    "audit",
    "Gap audit",
    "What this dummy set covers, what it must still mock before code, and what the council would break.",
    """
<div class="audit-stats">
  <div class="tile"><div class="k">Pages built</div><div class="n">9</div><div class="s">Today → Audit</div></div>
  <div class="tile"><div class="k">Gaps listed</div><div class="n">18</div><div class="s">must / nice / defer</div></div>
  <div class="tile warn"><div class="k">Must mock before code</div><div class="n">6</div><div class="s">if you want another round</div></div>
  <div class="tile"><div class="k">Council issues folded</div><div class="n">16</div><div class="s">2+ seat blockers</div></div>
</div>

<div class="gap">
  <h3>1. Today</h3>
  <ol>
    <li><span class="tag must">MUST</span>1.1 Empty morning — no meetings, no replies, no stuck rows.</li>
    <li><span class="tag must">MUST</span>1.2 Error — calendar sync stale (last run timestamp missing).</li>
    <li><span class="tag nice">NICE</span>1.3 Mobile stacked tiles (CSS exists, not exercised).</li>
  </ol>
</div>
<div class="gap">
  <h3>2. Company</h3>
  <ol>
    <li><span class="tag must">MUST</span>2.1 Empty raise — new campaign, zero campaign_partners.</li>
    <li><span class="tag nice">NICE</span>2.2 Add-from-Forge-Capital search results.</li>
    <li><span class="tag defer">DEFER</span>2.3 Full 17-column kanban, not four families.</li>
  </ol>
</div>
<div class="gap">
  <h3>3. Person</h3>
  <ol>
    <li><span class="tag must">MUST</span>3.1 Person on one raise only (the easy case).</li>
    <li><span class="tag must">MUST</span>3.2 Override-reason modal for a global block.</li>
    <li><span class="tag nice">NICE</span>3.3 Wispr paste → synthesised actions.</li>
  </ol>
</div>
<div class="gap">
  <h3>4. Review queue</h3>
  <ol>
    <li><span class="tag must">MUST</span>4.1 Excel-only stub firm (not in encyclopaedia).</li>
    <li><span class="tag nice">NICE</span>4.2 Merge stub onto a later Forge Capital id.</li>
  </ol>
</div>
<div class="gap">
  <h3>Cross-cutting</h3>
  <ol>
    <li><span class="tag defer">DEFER</span>Onboarding / settings / counterpart RLS (V1 is you only).</li>
    <li><span class="tag defer">DEFER</span>WhatsApp paste and iMessage metadata (Phase 2).</li>
    <li><span class="tag must">MUST</span>Keyboard: none. Dummy is mouse-first.</li>
    <li><span class="tag must">MUST</span>Audit log of status changes — not shown as a page.</li>
  </ol>
</div>

<div class="gap">
  <h3>Five red-team critiques</h3>
  <ol>
    <li><strong>High — dual-write coma.</strong> A pretty Today will not kill Excel if agents can still write xlsx. Mitigation is archive + mutation RPC, not this HTML.</li>
    <li><strong>High — wrong person at a firm.</strong> Dummy shows the three-partner case; code must refuse auto-pick.</li>
    <li><strong>High — send claim.</strong> Dummy labels Gmail as human send. Production must not advertise a hard gate on clipboard.</li>
    <li><strong>Medium — second mailbox.</strong> US Arb event is labelled Fractional Forge. Easy to forget in a real sync.</li>
    <li><strong>Medium — confidentiality.</strong> Person timeline shows Odysseus notes. Company view must hide bodies from counterpart users if they ever log in.</li>
  </ol>
</div>

<div class="gap">
  <h3>Proposed V1 after dummy sign-off</h3>
  <ol>
    <li>Schema: status check, contact_policy, raise_people, event junction, gmail_message_id, mutation_audit, trigger v2.</li>
    <li>Idempotent import + this Review queue as a real page.</li>
    <li>Today (single-user) + Person as write surface.</li>
    <li>Exports to Forge-Capital/exports/ · archive old CANONICAL files.</li>
  </ol>
  <p class="muted" style="margin-top:10px"><strong>V1 cuts:</strong> WhatsApp, iMessage, counterpart login, second Gmail OAuth, Visible-style data rooms, buying Affinity.</p>
</div>
""",
)

for name, html in pages.items():
    (ROOT / name).write_text(html)
    print("wrote", name, "bytes", len(html))
print("ok", ROOT)
