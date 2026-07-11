# Baselines B0–B5 on DEV (M4-T04)

Dataset: reqset-v1 · split dev (45 examples) · seed 42.

Baselines bypass parsing (`parsed` = gold), so their parse metrics are trivially
perfect and carry no comparison weight. Origins that are not coordinates
(place-name / 'current' / none) cannot route before M6 geocoding — counted as
errors over A for EVERY variant, so denominators stay comparable. B6 (the real
deterministic planner) runs through this same harness in the gate experiments.

## B0

Errors (unroutable origin / no route): 24/45.

```
metric                                value     n      denominator
------------------------------------------------------------------------------------------
parse_accuracy                        1.000     855    A (gold fields; failed parse = 0)
clarification_appropriateness         1.000     2      asked + should-have-asked, over A
disposition_accuracy                  1.000     45     A (gold-labeled)
route_validity_rate                   0.222     45     A
first_pass_feasibility                0.222     45     A
fallback_rate                         0.000     45     A
timeout_rate                          0.000     45     A
generation_time_mean_ms               60.677    45     A
generation_time_p90_ms                97.896    45     A
generation_time_p99_ms                773.260   45     A
cost_per_attempt_usd                  0.000     45     A
cost_per_successful_route_usd         0.000     10     F
invalid_model_output_rate             —         0      LLM calls
route_engine_calls_mean               0.467     45     A (instrumented)
route_engine_calls_p90                1.000     45     A (instrumented)
gold_constraint_satisfaction          0.908     19     P (gold-labeled)
gold_satisfied_and_returned           0.383     45     A (P/A × satisfaction)
hard_constraint_satisfaction          0.737     19     P
hard_relaxable_disclosure_rate        —         0      relaxations applied
duration_pct_error_median             0.066     19     P (with duration target)
duration_pct_error_p90                0.320     19     P (with duration target)
loop_closure_distance_median_m        44.644    19     loop returns in P
loop_closure_rate                     0.789     19     loop returns in P
retrace_ratio_median                  0.625     19     P
retrace_ratio_p90                     0.850     19     P
excessive_retrace_rate                0.789     19     P
requested_stop_coverage               0.000     2      P (with required stops)
twistiness_hit_rate                   0.143     7      P (twisty requests)
connected_route_rate                  1.000     19     P
diversity_mean_pairwise               —         0      generations presenting ≥2
repair_success                        0.000     35     failed-first-pass attempts
self_correction_efficacy              0.000     35     failed-first-pass attempts
new_violation_rate_after_correction   —         0      corrections applied
```

## B1

Errors (unroutable origin / no route): 24/45.

```
metric                                value     n      denominator
------------------------------------------------------------------------------------------
parse_accuracy                        1.000     855    A (gold fields; failed parse = 0)
clarification_appropriateness         1.000     2      asked + should-have-asked, over A
disposition_accuracy                  1.000     45     A (gold-labeled)
route_validity_rate                   0.289     45     A
first_pass_feasibility                0.289     45     A
fallback_rate                         0.000     45     A
timeout_rate                          0.000     45     A
generation_time_mean_ms               53.382    45     A
generation_time_p90_ms                51.119    45     A
generation_time_p99_ms                819.018   45     A
cost_per_attempt_usd                  0.000     45     A
cost_per_successful_route_usd         0.000     13     F
invalid_model_output_rate             —         0      LLM calls
route_engine_calls_mean               0.467     45     A (instrumented)
route_engine_calls_p90                1.000     45     A (instrumented)
gold_constraint_satisfaction          1.000     19     P (gold-labeled)
gold_satisfied_and_returned           0.422     45     A (P/A × satisfaction)
hard_constraint_satisfaction          0.895     19     P
hard_relaxable_disclosure_rate        —         0      relaxations applied
duration_pct_error_median             0.115     19     P (with duration target)
duration_pct_error_p90                0.343     19     P (with duration target)
loop_closure_distance_median_m        44.644    19     loop returns in P
loop_closure_rate                     0.789     19     loop returns in P
retrace_ratio_median                  0.713     19     P
retrace_ratio_p90                     0.856     19     P
excessive_retrace_rate                1.000     19     P
requested_stop_coverage               0.000     2      P (with required stops)
twistiness_hit_rate                   0.429     7      P (twisty requests)
connected_route_rate                  1.000     19     P
diversity_mean_pairwise               —         0      generations presenting ≥2
repair_success                        0.000     32     failed-first-pass attempts
self_correction_efficacy              0.000     32     failed-first-pass attempts
new_violation_rate_after_correction   —         0      corrections applied
```

## B2

Errors (unroutable origin / no route): 22/45.

```
metric                                value     n      denominator
------------------------------------------------------------------------------------------
parse_accuracy                        1.000     855    A (gold fields; failed parse = 0)
clarification_appropriateness         1.000     2      asked + should-have-asked, over A
disposition_accuracy                  1.000     45     A (gold-labeled)
route_validity_rate                   0.244     45     A
first_pass_feasibility                0.244     45     A
fallback_rate                         0.000     45     A
timeout_rate                          0.000     45     A
generation_time_mean_ms               17.766    45     A
generation_time_p90_ms                28.101    45     A
generation_time_p99_ms                286.339   45     A
cost_per_attempt_usd                  0.000     45     A
cost_per_successful_route_usd         0.000     11     F
invalid_model_output_rate             —         0      LLM calls
route_engine_calls_mean               0.467     45     A (instrumented)
route_engine_calls_p90                1.000     45     A (instrumented)
gold_constraint_satisfaction          0.917     21     P (gold-labeled)
gold_satisfied_and_returned           0.428     45     A (P/A × satisfaction)
hard_constraint_satisfaction          0.714     21     P
hard_relaxable_disclosure_rate        —         0      relaxations applied
duration_pct_error_median             0.256     21     P (with duration target)
duration_pct_error_p90                0.484     21     P (with duration target)
loop_closure_distance_median_m        44.644    21     loop returns in P
loop_closure_rate                     0.810     21     loop returns in P
retrace_ratio_median                  0.364     21     P
retrace_ratio_p90                     0.679     21     P
excessive_retrace_rate                0.667     21     P
requested_stop_coverage               0.000     3      P (with required stops)
twistiness_hit_rate                   0.286     7      P (twisty requests)
connected_route_rate                  1.000     21     P
diversity_mean_pairwise               —         0      generations presenting ≥2
repair_success                        0.000     34     failed-first-pass attempts
self_correction_efficacy              0.000     34     failed-first-pass attempts
new_violation_rate_after_correction   —         0      corrections applied
```

## B3

Errors (unroutable origin / no route): 24/45.

```
metric                                value     n      denominator
------------------------------------------------------------------------------------------
parse_accuracy                        1.000     855    A (gold fields; failed parse = 0)
clarification_appropriateness         1.000     2      asked + should-have-asked, over A
disposition_accuracy                  1.000     45     A (gold-labeled)
route_validity_rate                   0.311     45     A
first_pass_feasibility                0.311     45     A
fallback_rate                         0.000     45     A
timeout_rate                          0.000     45     A
generation_time_mean_ms               39.800    45     A
generation_time_p90_ms                16.693    45     A
generation_time_p99_ms                736.670   45     A
cost_per_attempt_usd                  0.000     45     A
cost_per_successful_route_usd         0.000     14     F
invalid_model_output_rate             —         0      LLM calls
route_engine_calls_mean               0.467     45     A (instrumented)
route_engine_calls_p90                1.000     45     A (instrumented)
gold_constraint_satisfaction          1.000     19     P (gold-labeled)
gold_satisfied_and_returned           0.422     45     A (P/A × satisfaction)
hard_constraint_satisfaction          0.947     19     P
hard_relaxable_disclosure_rate        —         0      relaxations applied
duration_pct_error_median             0.212     19     P (with duration target)
duration_pct_error_p90                0.992     19     P (with duration target)
loop_closure_distance_median_m        44.644    19     loop returns in P
loop_closure_rate                     0.789     19     loop returns in P
retrace_ratio_median                  0.510     19     P
retrace_ratio_p90                     0.767     19     P
excessive_retrace_rate                0.579     19     P
requested_stop_coverage               0.750     2      P (with required stops)
twistiness_hit_rate                   0.429     7      P (twisty requests)
connected_route_rate                  1.000     19     P
diversity_mean_pairwise               —         0      generations presenting ≥2
repair_success                        0.000     31     failed-first-pass attempts
self_correction_efficacy              0.000     31     failed-first-pass attempts
new_violation_rate_after_correction   —         0      corrections applied
```

## B4

Errors (unroutable origin / no route): 22/45.

```
metric                                value     n      denominator
------------------------------------------------------------------------------------------
parse_accuracy                        1.000     855    A (gold fields; failed parse = 0)
clarification_appropriateness         1.000     2      asked + should-have-asked, over A
disposition_accuracy                  1.000     45     A (gold-labeled)
route_validity_rate                   0.267     45     A
first_pass_feasibility                0.267     45     A
fallback_rate                         0.000     45     A
timeout_rate                          0.000     45     A
generation_time_mean_ms               30.194    45     A
generation_time_p90_ms                79.004    45     A
generation_time_p99_ms                189.921   45     A
cost_per_attempt_usd                  0.000     45     A
cost_per_successful_route_usd         0.000     12     F
invalid_model_output_rate             —         0      LLM calls
route_engine_calls_mean               0.467     45     A (instrumented)
route_engine_calls_p90                1.000     45     A (instrumented)
gold_constraint_satisfaction          0.940     21     P (gold-labeled)
gold_satisfied_and_returned           0.439     45     A (P/A × satisfaction)
hard_constraint_satisfaction          0.762     21     P
hard_relaxable_disclosure_rate        —         0      relaxations applied
duration_pct_error_median             0.328     21     P (with duration target)
duration_pct_error_p90                1.683     21     P (with duration target)
loop_closure_distance_median_m        44.644    21     loop returns in P
loop_closure_rate                     0.810     21     loop returns in P
retrace_ratio_median                  0.352     21     P
retrace_ratio_p90                     0.504     21     P
excessive_retrace_rate                0.571     21     P
requested_stop_coverage               0.000     3      P (with required stops)
twistiness_hit_rate                   0.571     7      P (twisty requests)
connected_route_rate                  1.000     21     P
diversity_mean_pairwise               —         0      generations presenting ≥2
repair_success                        0.000     33     failed-first-pass attempts
self_correction_efficacy              0.000     33     failed-first-pass attempts
new_violation_rate_after_correction   —         0      corrections applied
```

## B5 — router-native round trip

N/A — origin==destination returns a 0 m trip — no usable native round-trip (trivial).
