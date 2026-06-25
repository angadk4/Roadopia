# Work-packet template

The per-task contract. **Part 1** defines a packet (what to build); **Part 2** is the required report
structure every task response must follow (Build Contract §2; Master Spec §78). A report missing
**§7 (real results)** or **§8 (AC evidence)** is **not** a completed task and must not be merged.

> In this repo most packets already exist as the backlog tasks in
> `Roadopia_Implementation_Plan_and_Backlog_v1.0.md` §8 (each has Deps / In→Out / Files / Guidance / AC /
> Tests / Verify / DoD / Rollback). Use Part 1 when authoring a *new* packet; use Part 2 for *every* task.

---

## Part 1 — Packet definition (Master Spec §78)

```
PACKET <id>: <short title>
- Objective: one sentence — what this delivers and why.
- Spec references: sections (e.g. §29, §30) + requirement IDs (e.g. FR-040).
- Allowed files / areas: explicit paths this packet may create/modify.
- Dependencies: packet ids that must land first; gates/spikes that must pass.
- Inputs provided: data, fixtures, env, credentials available (and which are [HUMAN]-pending).
- Implementation notes: spec constraints to honor (e.g. LLM emits no geometry; SECURITY DEFINER RPC).
- Acceptance criteria: testable conditions mapped to requirement IDs / success criteria.
- Tests to write: unit / integration / E2E / eval cases this packet adds or keeps green.
- Validation commands: exact commands (lint, typecheck, unit, integration, eval, build) + expected.
- Expected artifacts: files, migrations, endpoints, screens, metrics produced.
- Prohibited shortcuts: e.g. no stubbed tool results; no hard-coded routes; no relaxing hard
  constraints silently; no new framework; no secrets in code.
- Definition of done: AC met + tests green + (eval gate green where applicable) + docs/decision-log
  updated if reality diverged + commit proposed.
- Human actions required: [HUMAN] steps (credentials, device test, approval gate) blocking completion.
```

---

## Part 2 — Required report structure (Build Contract §2)

Every task response follows this exact structure. Sections are short but **all present**.

1. **Task understanding** — restate the task + AC; name the spec/protocol sections it touches.
2. **Relevant files inspected** — files (and tests) read, one line each on current behaviour.
3. **Implementation plan** — the concrete steps before writing code.
4. **Changes made** — what changed, file by file, and why.
5. **Tests added or updated** — the tests written/updated and what each asserts.
6. **Commands run** — the literal commands (build, lint, typecheck, test, the task's `Verify`).
7. **Results** — the **actual pasted output** of those commands, incl. pass/fail counts. *(Mandatory.)*
8. **Acceptance-criteria checklist** — each AC item ✅/❌ with the evidence line proving it. *(Mandatory.)*
9. **Known limitations** — honest caveats, partial coverage, anything deferred.
10. **Documentation / decision-log updates** — what was written where (+ the `decision-log.md` entry if any).
11. **Next unblocked task** — the next task whose dependencies are now satisfied.

---

## Reminders that bind every packet

- **Stop & escalate** (Build Contract §14 / CLAUDE.md §4) for: [HUMAN] tasks, cost/pricing, architecture
  changes (§3 proposal), new dependencies (§5 request), an invalidated blocking assumption, any
  safety/security/privacy/honesty rule, release sign-off, or a contract-vs-spec conflict.
- **Never** weaken/skip/delete a test or weaken RLS to pass; **never** emit geography from the LLM;
  **no** speed/racing/timing framing; **no** secrets in the repo; **never** expose chain-of-thought.
- The agent **proposes** a one-line commit referencing the task ID; the **owner runs git** (Hard rule G).
