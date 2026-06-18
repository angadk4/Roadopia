# GoDrive — Final Pre-Build Review

**Version:** 1.0
**Reviewer role:** staff engineer / EM / TPM / QA lead / release engineer / security reviewer / coding-agent supervisor
**Date:** June 18, 2026
**Decision artifact:** this document gates the start of full implementation. It is read **first**; the Implementation Plan & Backlog and the Build Contract operationalize its verdict.

---

## 1. Executive verdict

**CONDITIONAL GO.**

The GoDrive v2 design is coherent, dependency-verified, and implementable by one human owner directing Claude coding agents over a risk-ordered 4–10 week effort. The three source documents are mutually consistent once reconciled (§2 below); **there are no unresolved cross-document conflicts** — the two points of tension both resolve cleanly to the newest explicitly-approved decision and are treated as reconciled, not blocking. No Critical or High issue is hidden.

The verdict is **conditional** for exactly one reason, already established by the dependency verification: a small set of claims are **measurement-dependent** and must be settled by spikes before dependent implementation proceeds. Work may begin **immediately** on M0 (repo/tooling) and the M1 spikes; full implementation of each dependent feature is gated on its spike. The binding gates are:

- **SPK-01** — Expo + Mapbox custom dev build renders on real iOS + Android under the New Architecture *(gates the entire mobile client, M7)*.
- **SPK-04** — regional Valhalla tiles fit a small VPS with acceptable latency *(gates the routing host + cost, M2/M12)*.
- **SPK-09** — Supabase free-tier egress/DB fit at demo scale, else Pro *(gates the data tier + a cost decision, M2/M8)*.
- **SPK-15** — the deterministic planner produces diverse, drivable, non-retracing loops *(gates the AI-product claim itself, M3/M4)*.
- **SPK-19** — end-to-end generation meets p50 < 15 s / p90 < 25 s and ~1–3¢/gen *(gates the interactive promise, M5/M6)*.

Plus three **must-pass-before-public-link** security/privacy gates (not build blockers, but release blockers): **SPK-13** (least-privilege planner read path leaks no private data), **SPK-18** (EXIF strip + re-encode before any photo display), **SPK-20** (spend cap + kill switch enforce the budget).

Everything else is **Ready** or **Ready-after-named-spike**. The recommendation is to proceed to **Scenario B (6–8 weeks)** as the target build, with **Scenario A (4 weeks)** as the fallback vertical slice if time compresses, and **Scenario C (10+ weeks)** if the owner wants polish + a fast-follow.

---

## 2. Source documents reviewed (and conflict reconciliation)

| Doc | Role | Status |
|---|---|---|
| `GoDrive_Master_Specification_v2_0.md` | product/build contract (95 §) | authoritative for product scope |
| `GoDrive_Dependency_and_Feasibility_Verification_v1.0.md` | dependency verification (24 §, 21 spikes) | authoritative for dependency facts + required edits |
| `GoDrive_Route_Planner_Experimental_Protocol_v1.0.md` | methodology proof (30 §) | **newest**; authoritative for the planner methodology |

**Conflict-reconciliation rule applied:** *where the documents differ, select the newest explicitly-approved decision; list anything unresolved as a blocker.* Two tensions were found; **both reconcile cleanly (no blockers):**

**R1 — The LLM's role in selection & correction.** The v2 spec (§27) frames the planner as four bounded LLM decisions: **parse, select-among-candidates, decide-correction, explain**. The newest document (experimental protocol §18/§27/§28) makes **selection (B)** and **correction (C)** *contingent on experimental gates* ([GATE-R], [GATE-F]) — deterministic by default, LLM only if it beats a baseline by a pre-registered margin — and predicts a **boundary-only** production design (LLM for **parse + explanation + title/summary/tags**; deterministic for selection, correction, and refinement-merge).
→ **Reconciled to the newest decision:** the implementation **builds the deterministic pipeline first** and treats LLM **selection and correction as gated upgrades decided in M4**, *not* baked into the MVP loop. The **AI MVP boundary** is therefore **parse + explanation + auto-title/summary/tags** (+ deterministic refinement merge). If M4's gates pass, LLM selection/correction are added behind a flag. This is consistent with v2 (the spec already says the LLM "emits no geography" and the deterministic layer owns routing/scoring/validation); it merely defers two of the four LLM touchpoints to evidence. **Not a blocker.**

**R2 — Scenicness as a numeric score.** v2 §32 already frames scenicness as an honest heuristic; the protocol (§13, [GATE-S]) goes further and may **drop numeric scenic scoring entirely** if it shows no human correlation.
→ **Reconciled to the newest decision:** the scenic *signal* is built as a **gated, optional** scoring term defaulting to **labels/signals only**; numeric scenic weighting ships **only if [GATE-S] passes**. **Not a blocker.**

**Verification-driven required edits (all folded into the backlog, not conflicts):** Mapbox **Navigation-SDK prohibition** (cost guardrail) → Build Contract + M7; Supabase **Data-API grants** + **Storage-object cleanup on delete** → M2/M8/M10/M12; **cap mechanism** = app-side accounting + prepaid-credit/workspace backstop + kill switch → M5; **public-roads claim softened** to "biases, not guarantees" → M9/M11 UX; **Apple unified-Maps-URL (iOS 18.4)** + **Valhalla hard-exclusion warn-and-ignore** detail + **`optimized_route` ≥4 pts** → M3/M9; **eval cost discipline** (Batch + gated frequency, separate budget) → M4.

---

## 3. MVP readiness

**Ready.** The MVP is explicitly defined (spec §10–§11; this review's Scenario B; the MVP DoD in the Implementation Plan). It is the **grounded hero flow + the AI-product proof + the safe UGC/persistence floor**, deployed and demoable:

- Anonymous map → plan → streamed generation → real constraint-satisfying route + constraints panel + honest explanation.
- Conversational refinement (inline) + route comparison.
- Reasoning-transparency view (pipeline + grounded facts + validated outputs — **not** private chain-of-thought, §7/§9).
- Public eval page with real, partitioned provenance.
- Auto-title/summary/tags; user-adjustable weights (presets + clamped sliders).
- Manual create; foreground record-a-drive; in-app follow-mode + best-effort hand-off.
- Save/fork/favourite/share; lightweight profiles; account + data deletion.
- Car spots + photos with **server-side EXIF strip + re-encode**; report→remove moderation floor.
- Runtime AI **spend cap + kill switch**; backups + restore drill; safe-driving UX (no speed/racing/timing).

Every MVP feature carries **measurable acceptance criteria** (spec FRs + backlog AC fields). Deferred items (likes, multimodal spot-assist, AI dup-detection, semantic search, weather, voice, region expansion, offline, ratings/feed/collections/comments, versioning, fly-along, GPX, freehand, fine-tuning, learned personalization) remain **Deferred** and are out of scope unless explicitly re-approved.

---

## 4. Architecture readiness

**Ready.** Every feature maps to architecture + data components (spec §41–§48; traceability §82). The verified topology: Expo/RN client (dev build, New Arch) → Supabase (Postgres/PostGIS/Auth/Storage/RLS, most CRUD direct) + a small always-on VPS running Docker Compose (Fastify agent + Valhalla + Caddy) → pay-as-you-go Anthropic API. Data model (split favourite tables with real FKs, reports/moderation, `user_preferences`, `ai_generation_requests`, `curvy_segments`, simplified geometry/bbox) supports all retained features and is RLS-/FK-friendly. The two data-tier edits (Data-API grants; Storage cleanup) are backlog tasks, not gaps.

---

## 5. Dependency readiness

**Ready after named spikes.** All load-bearing dependencies verified against current primary sources (verification doc, 18 Jun 2026): Anthropic models/pricing/caching/tool-use/streaming; `@rnmapbox/maps` v11 (dev-build required); Supabase limits; Valhalla capabilities (route/isochrone/match/elevation/costing/hard-exclusions/TSP); Apple/Google hand-off limits; Expo SDK 55/RN 0.83; Hetzner VPS economics. The measurement-dependent items are covered by **SPK-01/04/09/15/19** (build blockers) and **SPK-13/18/20** (release blockers). No dependency is **Incorrect/unsuitable**; one is **verified-with-limitations** and must be respected (Mapbox has **no hard spend cap** → MAU alert + stay on Maps SDK, never Nav SDK).

---

## 6. Route-methodology readiness

**Ready after SPK-15.** The methodology is implementable and, crucially, **proven-before-trusted**: the experimental protocol pins a deterministic baseline (B6) and gates every added complexity. The implementable core: isochrone-bounded search → curvy-cluster + POI candidate generation → directional-sector loop assembly / detour-capped A→B → overlap dedup → deterministic weighted scoring → constraint validation → relaxation/best-so-far. The one make-or-break is **loop quality** (Valhalla has no native loop) — **SPK-15** is its gate, and M4 finalizes the formula/parameters. LLM selection/correction are **contingent** (R1 reconciliation). **Not blocked**, but the planner is not "trusted for demo" until SPK-15 + M4 pass.

---

## 7. AI-readiness

**Ready.** The AI boundary is explicit and reconciled (R1): **MVP LLM use = parse + explanation + auto-title/summary/tags + deterministic refinement-merge**; selection/correction are gated. The conversational-refinement design is implementable (merge semantics defined, protocol §17; deterministic merge default) and is **shipped only if one-shot generation is stable** ([GATE-RF]). Spend cap + kill switch are implementable (mechanism verified: app-side accounting + prepaid-credit/workspace backstop + kill switch). 

**Execution-trace safety (explicitly confirmed):** the reasoning-transparency view exposes **(a) the deterministic pipeline steps**, **(b) the tool calls and their grounded results**, and **(c) the validated, user-facing LLM outputs** (parsed constraints, a short selection rationale, the explanation). It **must never expose raw model chain-of-thought / hidden reasoning tokens.** Because the LLM is invoked only at bounded points and every output is schema-validated and fact-checked, the "trace" is a *pipeline + grounded-fact* trace, not a thought stream. This is a binding design rule (Build Contract §9) and a release gate.

---

## 8. Evaluation-readiness

**Ready.** The experimental protocol is executable by one developer: versioned request dataset (DEV/VAL/TEST/ADV/REF/PFR), human-authored gold labels, baselines (B0–B11), exact metrics with explicit denominators, small-but-honest human eval (blind pairwise, CIs, no significance claims), calibration (tune-on-DEV/report-on-TEST), reproducibility manifests, and partitioned public-eval-page provenance (benchmark vs production, never mixed). Eval **cost discipline** is specified (Batch 50% + caching + gated frequency + separate budget). The public eval page shows **real** aggregates via a non-identifying read path (SPK-21).

---

## 9. Security / privacy / safety readiness

**Ready after named spikes.** Auth + RLS are complete (spec §54–§55); the **least-privilege planner read path** (`SECURITY DEFINER` over public/OSM only) is defined and gated by **SPK-13**. Privacy: recorded drives private by default, no precise location in URLs, account+data deletion, anon-generation retention/purge. **EXIF strip + re-encode before any photo display** is mandatory and gated by **SPK-18** (no image is served before processing — Build Contract §9). Safety: no speed/racing/timing anywhere; persistent disclaimers; **public-roads claim softened** to honest "biases, not guarantees." Prompt-injection: tool results are data, not instructions; bounded validated LLM outputs; adversarial regression set. Spend abuse: anon rate limiting (SPK-14) + cap/kill switch (SPK-20). **Chain-of-thought is never exposed** (§7).

---

## 10. Deployment readiness

**Ready after SPK-04.** Production topology is viable (Docker Compose on a Hetzner CX32-class VPS; Caddy TLS; Valhalla bound to localhost; restart policy + health checks; VPS hardening checklist). Tile RAM fit is the gate (SPK-04). Backups: nightly `pg_dump`→R2 + quarterly restore drill (the free tier has no managed backups). Supabase dev/prod split (2 free projects) with **Data-API grants** configured. EAS dev/internal builds for the demo; store builds deferred to P6. Production smoke test + keep-alive cron required before the public link.

---

## 11. Human approval gates

The owner is the sole credential/deployment/approval authority. **Build cannot proceed past these without the human** (full list + task mapping in the Implementation Plan §10):

- **Accounts/keys [HUMAN]:** Supabase (dev+prod), Mapbox (public token, restricted by bundle/URL), **Anthropic runtime API key + prepaid credits + workspace spend limit**, VPS, domain; later Apple ($99/yr) + Google ($25) developer accounts.
- **Cost approvals:** Supabase Free-vs-Pro for the public demo; the $30 cap / $40 testing override; any change that raises runtime spend.
- **Physical-device tests:** SPK-01/03/07/17, the M7 device test, M9 record/drive tests, accessibility pass.
- **App permissions:** location (foreground), photos — declared correctly (no background location).
- **Architecture/dependency changes:** any deviation from the verified topology or a new dependency (Build Contract §3/§5).
- **Public launch:** the launch-readiness checklist sign-off.
- **Demo video:** recording the hero video.

---

## 12. Remaining blockers

**No unresolved design or document conflicts.** The only gating items are spikes (already planned) and a small set of human credential/cost actions. Classified:

| Item | Class | Gate |
|---|---|---|
| Mobile client (map, plan, result, trace) | Ready after spike | SPK-01 (dev build, New Arch) |
| Routing host + production deploy | Ready after spike | SPK-04 (tiles/RAM) |
| Data tier (Free vs Pro) | Ready after spike | SPK-09 (egress/DB) + human cost decision |
| Planner trusted for demo | Ready after spike | SPK-15 (loop quality) + M4 gates |
| Interactive latency/cost promise | Ready after spike | SPK-19 |
| Public link (security) | Ready after spike | SPK-13 (least-priv), SPK-14 (rate limit), SPK-18 (EXIF), SPK-20 (cap/kill) |
| LLM selection/correction in loop | Deferred-to-gated | M4 [GATE-R]/[GATE-F]; off by default |
| Numeric scenic scoring | Deferred-to-gated | M4 [GATE-S]; labels-only default |
| All §"Deferred" features | Deferred | post-MVP; not in scope |
| Mapbox Navigation SDK | Removed | prohibited (cost); follow-mode built from Valhalla maneuvers |
| Accounts/keys/credits/VPS provisioning | Blocked-on-human | M0/M1 [HUMAN] tasks |
| Apple/Google dev accounts (store) | Deferred-to-P6 | not needed pre-public-link |

---

## 13. Final decision

**CONDITIONAL GO.**

Begin **M0 (repo/tooling)** and the **M1 spikes** now. **Full implementation of each dependent feature is authorized once its gate passes.** The exact tasks that must pass before full implementation proceeds:

1. **SPK-01** → unblocks the mobile client (M7).
2. **SPK-04** → unblocks the routing host + production deploy (M2 routing, M12).
3. **SPK-09** → unblocks the data tier + settles the Free/Pro cost decision (M2, M8).
4. **SPK-15** (+ the M4 selection gates) → unblocks trusting the planner for the demo (M3→M5 scope, M7 hero flow).
5. **SPK-19** → confirms the interactive latency/cost promise (M5/M6).

Before the **public link** specifically: **SPK-13, SPK-14, SPK-18, SPK-20** must pass and the verification §8 edits must be applied.

There is no NO-GO condition present. Proceed.

---

*End of GoDrive Final Pre-Build Review v1.0.*
