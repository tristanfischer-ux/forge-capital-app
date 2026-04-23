# Voice reference — Tristan's real outreach

This is the canonical voice sample for the Haiku drafter in
`/templates` and `/tracker/[id]/draft`. Any change to the drafter
prompts in `app/(authed)/templates/actions.ts` should be tested
against this reference: does the generated section read in this
voice, or does it drift generic?

Sent 2026-04 by Tristan Fischer to Christophe (partner at
Quantonation). Context: SkySails Power €5M+ round, airborne wind
energy (niche relative to Quantonation's quantum-physics mandate —
hence the honest-stretch framing in paragraph 3).

---

**Subject**: (recorded from real send — add when applicable)

Dear Christophe,

My name is Tristan Fischer. I have spent twenty-five years building,
financing and scaling capital-intensive businesses — from Citigroup's
project finance team, where I worked on US$5 billion of infrastructure
transactions, through Shell Technology Ventures, to founding Lumicity
as a solar and wind developer and serving as Executive Chairman of
C-Capture, a carbon capture business backed by IP Group, Drax and BP
Ventures. Most recently I founded and ran Fischer Farms, one of the
largest vertical farming businesses in the world, for a decade. Since
stepping down as CEO earlier this year, I have been approached by a
number of companies who have asked me to help them raise capital.

One of those is SkySails Power, led by founder and CEO Stephan Wrage.
SkySails designs and manufactures airborne wind energy systems — large
automated tethered kites that fly figure-of-eight patterns at altitudes
well above conventional turbines, generating electricity by pulling on
a ground-based generator. The technology addresses wind sites that are
structurally or economically difficult for tower-based turbines, and
delivers materially higher capacity factors per tonne of installed
hardware. The company has commercial pilots running, a production-
capable facility in Hamburg, and is now raising a €5M+ round to scale
manufacturing and fund the next generation of units.

My understanding is that Quantonation focuses primarily on
quantum-physics-grounded companies, with advanced materials and Pioniq
battery work as the closest adjacencies. If that is right, airborne
wind is a stretch against that core mandate — I raise it mainly on the
materials-and-controls adjacency, and would welcome a view on whether
that angle holds.

Would you have 20 minutes for a call in the next week or two to explore
whether this fits?

Best regards,
Tristan Fischer
tristan.fischer@gmail.com
https://www.linkedin.com/in/tristanfischer/

---

## Voice markers the drafter must capture

### Paragraph 1 — Credibility
- Dated span: "twenty-five years" (NOT "years of experience")
- Named employers in sequence: Citigroup → Shell Technology Ventures →
  Lumicity → C-Capture → Fischer Farms. Each with a short qualifier.
- Specific hard numbers: "US$5 billion", "for a decade", "one of the
  largest"
- Named backers woven in where they add credibility: "backed by IP
  Group, Drax and BP Ventures"
- Closes with plain cause-and-effect transition to now: "Since stepping
  down ... I have been approached by a number of companies"

### Paragraph 2 — Company
- Founder named + credited: "led by founder and CEO <Name>"
- ONE vivid mechanical description — the kite analogy for SkySails is
  the model. The reader should be able to picture what it does without
  knowing the sector.
- Problem-framing in one clause: "addresses wind sites that are
  structurally or economically difficult for tower-based turbines"
- Quantitative differentiator: "materially higher capacity factors per
  tonne of installed hardware"
- Concrete traction in one sentence: "commercial pilots running, a
  production-capable facility in Hamburg"
- Ask in round numbers + purpose: "€5M+ round to scale manufacturing
  and fund the next generation of units"

### Paragraph 3 — Per-investor synthesis
- **Opens with the hedged-knowledge frame**: "My understanding is
  that <FIRM> focuses primarily on <CORE THESIS>, with <ADJACENCIES>
  as the closest adjacencies."
- **If honest about stretch**: name it plainly: "If that is right,
  <TOPIC> is a stretch against that core mandate"
- Name the specific angle being pitched on: "I raise it mainly on the
  <SPECIFIC ADJACENCY>"
- Invite pushback: "and would welcome a view on whether that angle
  holds"
- NEVER flatter the investor's brand. NEVER say "your firm is the
  global leader in X" (unless quoting their own copy as context).
- The paragraph's job is to demonstrate homework AND honesty, not to
  sell the fit.

### Paragraph 4 — CTA
- One sentence.
- Specific duration: "20 minutes"
- Specific window: "in the next week or two"
- Ask the question plainly: "Would you have 20 minutes for a call..."
- No grandstanding, no pre-emptive thanks, no "I look forward to
  hearing from you".

### Sign-off
- "Best regards," (not "Best," or "Cheers," or "Warmly,")
- Name only (no title line — he's signing as a person, not a
  role)
- Email + LinkedIn URL. That's it.

## What NOT to generate (drafter anti-patterns found in the Wren audit)

- "I work with emerging space technology founders to shape their
  investor conversations and secure introductions to the right
  partners." → Too generic + self-marketing. Tristan introduces his
  track record with named numbers, not generic descriptors.
- "Your firm has spent years defining what SpaceTech investment
  actually means" → Flattery. Should be replaced with hedged-knowledge
  paraphrase of what the firm actually does.
- "[X years]", "[specific role]" bracketed TODOs in the output → the
  drafter should either commit to the numbers or leave the paragraph
  out entirely, never ship an editable-bracket placeholder.
- "I suspect your team will see what we do" → soft-sell hedge without
  information content. Either state the match concretely or raise the
  stretch explicitly.
