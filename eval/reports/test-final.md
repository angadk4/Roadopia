# M4 final numbers — LOCKED TEST split, config frozen-m4t12-v8 (single-use, §25 Stage 8)

Held-out TEST briefs never seen during tuning: 20 runnable loops across short/medium/long.
Three gauges on the presented best route (definitions in experiments/test_final.ts header):

- **PERFECT** (strict all-12 composite, incl. ≥4 alternates): **2/20 (10%)**
- **SHIPPABLE** (clean best route + within ±35 % disclosed time): **7/20 (35%)**
- **CLEAN** (best route clean, any time): **8/20 (40%)**

Duration error of best: median **8 %**, mean 11 %.

Honest reading: PERFECT is the research bar (stricter than "a driver would be happy" —
it also demands a 4-route menu). SHIPPABLE is the product bar: a clean route the app can
show with an honest "≈X min" label. The gap between them is mostly menu-size + the
disclosed-time band, not route badness (BD-42: the timing tail is fundamental in
road-sparse origins, answered by UI disclosure).

| brief    | origin         | target | routed | gauge     | why (if not perfect)                          |
| -------- | -------------- | ------ | ------ | --------- | --------------------------------------------- |
| test-001 | org-cayuga     | 45m    | 53m    | weak      | 3/4 alternates, route flaw                    |
| test-002 | org-port-perry | 90m    | 62m    | shippable | -31% time                                     |
| test-003 | org-port-perry | 180m   | 170m   | weak      | 2/4 alternates, route flaw                    |
| test-005 | org-port-perry | 40m    | 42m    | shippable | 2/4 alternates                                |
| test-006 | org-port-perry | 60m    | 67m    | clean     | no feasible route, 3/4 alternates             |
| test-007 | org-owen-sound | 120m   | 111m   | weak      | 3/4 alternates, route flaw                    |
| test-008 | org-owen-sound | 240m   | 193m   | weak      | 3/4 alternates, route flaw                    |
| test-010 | org-owen-sound | 75m    | 81m    | weak      | 1/4 alternates, route flaw                    |
| test-011 | org-owen-sound | 30m    | 28m    | weak      | 2/4 alternates, route flaw                    |
| test-012 | org-owen-sound | 180m   | 161m   | weak      | route flaw                                    |
| test-013 | org-grimsby    | 90m    | 76m    | weak      | route flaw                                    |
| test-015 | org-grimsby    | 45m    | 39m    | shippable | 2/4 alternates                                |
| test-016 | org-grimsby    | 90m    | —m     | weak      | no feasible route, 0/4 alternates             |
| test-017 | org-grimsby    | 60m    | 59m    | shippable | 1/4 alternates                                |
| test-018 | coord          | 120m   | 140m   | weak      | route flaw                                    |
| test-020 | coord          | 35m    | 36m    | PERFECT   |                                               |
| test-022 | coord          | 75m    | 55m    | shippable | 3/4 alternates, -27% time                     |
| test-023 | coord          | 120m   | 124m   | PERFECT   |                                               |
| test-024 | coord          | 210m   | 219m   | weak      | no feasible route, 2/4 alternates, route flaw |
| test-025 | coord          | 150m   | 158m   | weak      | 1/4 alternates, route flaw                    |
