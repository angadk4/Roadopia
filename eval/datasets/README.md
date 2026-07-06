# Request datasets (Protocol §6) — `reqset-vN`

Versioned request datasets for the M4 evaluation campaign. Loader + validator:
`eval/src/datasets/load.ts`; schemas: `eval/src/datasets/schema.ts`.

## Splits

| Split | Target | Purpose                                                         | Tuning?                 |
| ----- | ------ | --------------------------------------------------------------- | ----------------------- |
| DEV   | 40–50  | iterate algorithms; **all** parameter tuning (§21)              | yes — only here         |
| VAL   | 20–25  | generalization checks; pick between finalists                   | read often, never tune  |
| TEST  | 25–30  | **LOCKED** — final numbers only, once per frozen config         | never                   |
| ADV   | 15–20  | unsafe · injection · impossible · out-of-region · contradictory | regression guard        |
| REF   | 15–20  | multi-turn refinement (merge semantics, §17)                    | DEV-like for refinement |
| PFR   | grows  | every production/demo failure becomes a fixed case              | append-only             |

## Rules

- **TEST lock (§6.4):** never inspected during development; run only to produce
  final numbers for a frozen config. Re-running TEST after a change to chase a
  number invalidates it — if it happens, the violation is recorded.
- **Leakage (§6.4):** the same (origin, brief) never appears in two splits;
  DEV/VAL/TEST use disjoint phrasings, and disjoint origins where possible.
  Enforced by `validateReqset` (errors), origin reuse warned.
- **Versioning (§6.5):** additions bump `reqset-vN` with a changelog line; the
  dataset only grows; every experiment manifest records the version (§22).
- **Origins (§5):** ≥1 pinned origin per archetype in `origins.json`
  (dense urban · suburban edge · rural twisty-rich · sparse · water-adjacent ·
  escarpment); coordinates come from the vetted gazetteer, never invented.
- **Gold (§7, M4-T02):** intent-not-route; bands not points; authored before
  seeing model output; one-line rationale each. `validateReqset(reqset,
{ requireGold: true })` is the T02 completion gate.
