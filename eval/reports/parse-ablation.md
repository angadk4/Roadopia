# [GATE-A] Parse ablation — rules parser vs Haiku structured-output parse (M4-T11)

Pre-registered rule (before computation): adopt the LLM parser iff on VAL its mean
parse_accuracy ≥ rules AND clarification_appropriateness ≥ rules (no over-asking),
AND ADV disposition_accuracy ≥ rules (safety-flag veto). Default: rules parser.
LLM: claude-haiku-4-5-20251001, temperature 0, structured outputs, N=3 repeats, cost-guarded.

## DEV (45 briefs)

| metric                                  | value | n   | denominator                       |
| --------------------------------------- | ----- | --- | --------------------------------- |
| rules · parse_accuracy                  | 0.885 | 855 | A (gold fields; failed parse = 0) |
| rules · clarification_appropriateness   | 0.154 | 13  | asked + should-have-asked, over A |
| rules · disposition_accuracy            | 0.756 | 45  | A (gold-labeled)                  |
| llm(r1) · parse_accuracy                | 0.913 | 855 | A (gold fields; failed parse = 0) |
| llm(r1) · clarification_appropriateness | 1.000 | 2   | asked + should-have-asked, over A |
| llm(r1) · disposition_accuracy          | 1.000 | 45  | A (gold-labeled)                  |

LLM parse_accuracy per repeat: 0.913 / 0.911 / 0.911 (mean 0.912) · rules 0.885
Stability: 1/45 briefs changed key fields across 3 repeats.
Invalid model outputs: 0/135 calls. Mean LLM latency 2504 ms.

## VAL (22 briefs)

| metric                                  | value | n   | denominator                       |
| --------------------------------------- | ----- | --- | --------------------------------- |
| rules · parse_accuracy                  | 0.859 | 418 | A (gold fields; failed parse = 0) |
| rules · clarification_appropriateness   | 0.125 | 8   | asked + should-have-asked, over A |
| rules · disposition_accuracy            | 0.682 | 22  | A (gold-labeled)                  |
| llm(r1) · parse_accuracy                | 0.926 | 418 | A (gold fields; failed parse = 0) |
| llm(r1) · clarification_appropriateness | 0.500 | 2   | asked + should-have-asked, over A |
| llm(r1) · disposition_accuracy          | 0.955 | 22  | A (gold-labeled)                  |

LLM parse_accuracy per repeat: 0.926 / 0.919 / 0.921 (mean 0.922) · rules 0.859
Stability: 0/22 briefs changed key fields across 3 repeats.
Invalid model outputs: 2/68 calls. Mean LLM latency 2560 ms.

## ADV (17 briefs)

| metric                                  | value | n   | denominator                       |
| --------------------------------------- | ----- | --- | --------------------------------- |
| rules · parse_accuracy                  | 0.920 | 323 | A (gold fields; failed parse = 0) |
| rules · clarification_appropriateness   | 1.000 | 3   | asked + should-have-asked, over A |
| rules · disposition_accuracy            | 0.941 | 17  | A (gold-labeled)                  |
| llm(r1) · parse_accuracy                | 0.947 | 323 | A (gold fields; failed parse = 0) |
| llm(r1) · clarification_appropriateness | 0.667 | 3   | asked + should-have-asked, over A |
| llm(r1) · disposition_accuracy          | 0.941 | 17  | A (gold-labeled)                  |

LLM parse_accuracy per repeat: 0.947 / 0.954 / 0.954 (mean 0.951) · rules 0.920
Stability: 1/17 briefs changed key fields across 3 repeats.
Invalid model outputs: 3/54 calls. Mean LLM latency 2822 ms.

## DECISION ([GATE-A], per the pre-registered rule)

| criterion                         | rules | llm   | llm ≥ rules |
| --------------------------------- | ----- | ----- | ----------- |
| VAL parse_accuracy                | 0.859 | 0.922 | YES         |
| VAL clarification_appropriateness | 0.125 | 0.500 | YES         |
| ADV disposition_accuracy          | 0.941 | 0.961 | YES         |

**ADOPT the LLM parser for M5-T03** (all pre-registered criteria cleared); the rules parser stays as the deterministic fallback.

Cost ledger: 257 calls · 730183 in / 50004 out tokens · $0.9802 (budget $2).
Scored fields per example: 19.
