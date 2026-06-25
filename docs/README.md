# Roadopia docs — standards & index

This folder is the **authoritative specification** plus the project's working docs. When reality diverges
from a hypothesis or tunable (a spike result, a platform limit), update the relevant spec **and** the
decision log **in the same change** — docs must not drift from reality (Master Spec §76–§77).

## The six authoritative specs (and the tie-breaker)

| Doc | Authority |
|---|---|
| `Roadopia_Build_Contract_v1.0.md` | **How to work** — the supremacy doc. Wins over any task instruction. |
| `Roadopia_Final_PreBuild_Review_v1.0.md` | The CONDITIONAL-GO verdict + §2 conflict reconciliations. |
| `Roadopia_Implementation_Plan_and_Backlog_v1.0.md` | The **tasks** (unit of work), deps, gates, cut-order. |
| `Roadopia_Master_Specification_v2_0.md` | Authoritative for **product scope**. |
| `Roadopia_Dependency_and_Feasibility_Verification_v1.0.md` | Authoritative for **dependency facts** + spikes. |
| `Roadopia_Route_Planner_Experimental_Protocol_v1.0.md` | **Newest**; authoritative for **planner methodology**. |

**Tie-breaker:** Build Contract > task instruction. For *what* to build, authority is per-domain — scope
→ Master Spec; methodology → Experimental Protocol (newest); dependency facts → Dependency Verification;
already-reconciled conflicts → Pre-Build Review §2. A **new** contract-vs-spec conflict is the human's to
resolve (stop and escalate).

## Working docs (in this folder)

- **`decision-log.md`** — committed, append-only record of every decision + rationale + date
  (Build Contract §11). Seeded from Master Spec §89 + Pre-Build Review §2; build-session decisions in Part C.
- **`work-packet-template.md`** — the per-task contract: packet definition (§78) + the required
  11-section report structure (§2). A report without real results (§7) or AC evidence (§8) is not done.
- **`setup/`** — environment setup notes (e.g. `setup/supabase.md`).

## Decision-log rule (log as you go)

Append a `decision-log.md` entry **in the same task** whenever you: make a decision, confirm/invalidate an
assumption, decide a gate (M4), or get an architecture/dependency change approved. Entry = decision +
rationale + date (+ "Revisit when" for watch items).

## The resume system (local-only — NOT in this folder, NOT committed)

`CLAUDE.md` (operating manual / build loop), `PROGRESS.md` (cold-resume pointer), and `BUILD_LOG.md`
(per-task evidence journal) live in the **repo root** and are **gitignored**. They drive the autonomous
build; the committed durable record of *decisions* is `docs/decision-log.md`.
