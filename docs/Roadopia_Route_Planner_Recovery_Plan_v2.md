# Roadopia Route Planner — Recovery and Architecture Plan

**Status:** Recommended implementation roadmap  
**Basis:** Roadopia Route Generation Technical Reference (`frozen-r31-v1`) plus an independent architecture review and verification against current official Valhalla documentation.  
**Primary goal:** Make Roadopia reliably generate routes that *feel* like deliberately designed driving routes rather than routes that become acceptable only after repeated rejection and repair.

---

## 1. Executive summary

Roadopia already has several strong foundations:

- geography is deterministic rather than LLM-generated;
- route quality is measured rather than guessed;
- bad-route complaints have been converted into explicit detectors;
- Discover serves pre-measured drives instead of inventing them live;
- the project maintains a refusal ledger and measures changes before adopting them;
- the planner has learned important Valhalla-specific lessons such as avoiding `break` middle locations.

Those ideas should remain.

The main problem is architectural:

> **Roadopia is better at detecting bad routes after they are generated than it is at making the router prefer good roads in the first place.**

The current pipeline often works like this:

```text
find promising road material
        ↓
force a generic router through sparse waypoints
        ↓
inspect what the router produced
        ↓
detect retracing / crescents / residential cuts / bad shape
        ↓
repair / retry / reject
```

The target should instead be:

```text
represent Roadopia road quality on the routing graph
        ↓
search with a cost function aligned to "good driving road"
        ↓
construct loop topology deliberately
        ↓
preserve exact road identity
        ↓
use hard detectors only as a final safety/quality firewall
```

The highest-priority changes are:

1. **Stop using `shortest=true` for BACKROADS/FUN.**
2. **Verify Valhalla hard exclusions correctly and fix the server configuration if necessary.**
3. **Make graph-edge identity the source of truth instead of coarse geographic cells.**
4. **Stop treating a measured ring as measured if runtime routing is allowed to replace ~40% of it.**
5. **Replace nearest-ring-entry + crow-distance heuristics with real matrix-based J1/J2 optimization.**
6. **Replace fixed radial origin grace with a network-aware unavoidable-origin stem.**
7. **Separate structural defects from quality ranking instead of hard-rejecting everything at threshold cliffs.**
8. **Stop shipping the dirty legacy loop fallback; offer the nearest clean duration instead.**
9. **Build a Roadopia-aware routing cost so good-road preference happens during search.**
10. **Longer term, generate loops structurally from the road graph instead of hoping waypoint routing happens to form a good loop.**

This should be implemented incrementally and behind flags. Do **not** perform a big-bang rewrite.

---

# 2. The product contract to optimize for

Before changing code, freeze the actual product definition.

For a **Plan loop**, the route should:

1. start at the requested origin;
2. return to that origin;
3. be approximately the requested total duration;
4. look and behave like a loop rather than an out-and-back or lollipop;
5. minimize driving the same physical road twice except where the local road network makes that unavoidable;
6. avoid random residential streets, crescents, stubs, service-road shortcuts, and unnecessary U-turns;
7. spend the meaningful part of the trip on enjoyable roads;
8. avoid highways when the user asks for a backroads/fun drive;
9. avoid excessive road hopping and turn soup;
10. remain deterministic and auditable;
11. never claim measured quality from a stored drive if the actual driven path materially differs from it.

For **Discover**:

- preserve the existing concept of measured complete drives;
- keep get-there/get-home connectors honest and simple;
- do not over-engineer commute legs;
- improve supply and deduplication rather than rewriting the successful core product.

For **A→B**:

- preserve a strict detour ceiling;
- maximize enjoyable-road content inside that ceiling;
- select the best candidate architecture per corridor instead of forcing one global algorithm to win everywhere.

---

# 3. Priority map

| Priority | Change | Why |
|---|---|---|
| **P0** | Verify Valhalla hard-exclusion configuration | Current "exclude_highways is a no-op" result may be caused by server configuration |
| **P0** | Remove `shortest=true` from BACKROADS/FUN | It discards all other penalties/factors, so the router cannot optimize for Roadopia quality |
| **P0** | Fix A→B 1.8× vs 1.92× invariant contradiction | The evaluation cannot be trusted until this is explained |
| **P0** | Audit `directions_type=none` use | Valhalla 3.8.2 fixed false per-leg `has_highway`/`has_toll`/`has_ferry` flags in that mode |
| **P0** | Freeze a stronger evaluation suite | Prevent another "audit passes while route feels bad" cycle |
| **P1** | Move overlap/fidelity truth to graph edges | Geometry-cell overlap is too approximate for mature routing logic |
| **P1** | Optimize J1/J2 jointly using a matrix | Current nearest-entry and crow-distance heuristics throw away good candidates |
| **P1** | Preserve exact measured-core path | A 60% fidelity threshold undermines the measured-first architecture |
| **P1** | Network-aware unavoidable origin stem | Fixes funnel-origin failures without hiding genuine retracing |
| **P1** | Split hard defects from quality ranking | Prevent threshold cliffs from starving supply |
| **P1** | Replace dirty legacy fallback | Bad-but-disclosed routes are still bad routes |
| **P2** | Global core dedup + incremental top-up loader | More real supply, less duplicated sweep output |
| **P2** | Roadopia-aware dynamic costing | Make good roads cheaper during search instead of repairing afterward |
| **P2** | Structural loop generation | Prevent repeated roads and lollipop geometry during generation |
| **P2** | Human preference calibration | Optimize what a driver actually likes, not only detector outputs |
| **P3** | A→B adaptive candidate policy | Use legacy/ribbon/other candidate generators where each works best |
| **P3** | Remove Discover v1 fallback in covered regions | Never silently downgrade a premium surface |

---

# 4. Phase 0 — freeze the baseline before touching behavior

Do this first.

## 4.1 Create a reproducible baseline manifest

Every evaluation artifact should record:

```text
Roadopia git commit
planner config stamp
Valhalla version
Valhalla full config hash
Valhalla tileset dataset/build identifier
OSM extract identity
drive_core version
evaluation suite version
all relevant constants
wall-clock budget
```

This prevents false comparisons where a routing-engine upgrade, tileset rebuild, or planner change is silently mixed with another experiment.

## 4.2 Freeze representative evaluation suites

Do not tune only against the current handful of locations.

Create a stratified loop suite containing at least these origin classes:

- rural;
- suburban;
- subdivision/funnel origin;
- city edge;
- dense grid;
- sparse rural network;
- flat lakeshore/Cobourg-like network;
- road-rich curvy area;
- area with only one major arterial escape;
- area near a highway;
- area with parallel roads close together;
- area with hairpins or geometry that can fool cell overlap;
- area with a complete measured core nearby;
- area with only ribbons nearby;
- true supply desert.

For every origin, test multiple duration asks such as:

```text
45 min
60 min
90 min
120 min
```

The exact count is less important than **coverage of different network structures**.

Also maintain independent suites for:

- Discover;
- A→B;
- performance/latency;
- known historical complaint routes.

## 4.3 Create a holdout set

Do not optimize every constant against the same suite used to choose the constant.

Split fixtures into:

```text
development / tuning set
holdout acceptance set
```

The holdout set should not be touched while choosing parameter values.

## 4.4 Keep a human gold set

Automatic gates are necessary but not sufficient.

For a subset of routes, save:

- map image;
- route statistics;
- road list;
- current production candidate;
- experimental candidate.

Review them **blind**, without knowing which algorithm produced which route.

Use simple ratings:

```text
1 = unacceptable
2 = poor
3 = acceptable
4 = good
5 = excellent
```

Also record pairwise preference:

```text
A much better
A slightly better
same
B slightly better
B much better
```

This is the external signal that prevents Roadopia from overfitting its own detectors.

## 4.5 Define three classes of metrics

### Structural defects

These should usually be hard failures:

- U-turn;
- street stub;
- microloop/crescent;
- illegal/forbidden road use;
- severe non-required retrace;
- route does not close correctly;
- strict-highway request contains prohibited highway use;
- internal routing inconsistency.

### Quality measurements

These should mostly rank candidates:

- backroad share;
- main-road share;
- residential/hood share;
- curvature;
- continuity;
- road-name changes;
- turns per 10 min;
- enjoyable-road run length;
- loop shape quality;
- urban share;
- quality of road context.

### Product/experience metrics

- total duration error;
- clean serve rate;
- clean-alternative serve rate;
- latency;
- monotony / route repetition;
- human preference;
- percentage of actual route that matches advertised measured material.

---

# 5. Phase 1 — repair Valhalla usage before redesigning the planner

This phase may produce substantial gains without a major rewrite.

---

## 5.1 Verify hard exclusions correctly

The Roadopia reference says `exclude_highways: true` was measured as a no-op.

Current official Valhalla documentation says hard exclusions are available only when:

```json
{
  "service_limits": {
    "allow_hard_exclusions": true
  }
}
```

is enabled server-side.

If hard exclusions are not allowed, Valhalla says it will return a warning and ignore them.

### Required experiment

On the current 3.7.0 instance:

1. Record the current full Valhalla config.
2. Check `service_limits.allow_hard_exclusions`.
3. Make a control route where:
   - a highway path exists;
   - a non-highway path also exists.
4. Call the route without exclusion.
5. Call with:

```json
{
  "costing": "auto",
  "costing_options": {
    "auto": {
      "exclude_highways": true
    }
  }
}
```

6. Inspect:
   - warnings;
   - returned road classes/edges;
   - route geometry;
   - `has_highway` only as a secondary check.
7. Repeat with an origin/destination pair where a non-highway path is impossible or highly constrained.

### Acceptance

A hard exclusion must either:

- produce a route without interior highway use; or
- fail to find a path where no permitted path exists.

It must **never silently behave identically because the option was ignored**.

### Do not rely on `use_highways: 0` as equivalent

`use_highways: 0` is a strong preference, not a hard prohibition.

For strict Backroads/Fun behavior:

```text
hard exclusion = contract
soft highway factor = preference
```

Use them intentionally.

---

## 5.2 Remove `shortest=true` from BACKROADS/FUN

This is one of the most important changes in the entire plan.

Official Valhalla documentation states that:

> `shortest=true` solely uses distance as cost and disregards all other costs, penalties, and factors.

That means the router cannot meaningfully respond to the soft levers Roadopia wants to use.

### Why this hurts Roadopia

Distance-only routing naturally rewards:

- tiny shortcut streets;
- local cross-connections;
- awkward grids;
- road hopping;
- routes with many maneuvers if they save metres;
- undesirable connector roads.

Roadopia then spends effort detecting those defects later.

### Replace it with tuned `auto`

Start with ordinary `auto`, not a custom Valhalla fork.

Build a pre-registered set of perhaps 8–12 profiles rather than brute-force hundreds of combinations.

Explore combinations of:

```text
shortest = false
use_distance
use_highways
use_living_streets
use_tracks
service_penalty
service_factor
maneuver_penalty
hard highway exclusion when required
```

Useful experiment ranges might include:

```text
use_distance:        0.00 / 0.15 / 0.30 / 0.45
maneuver_penalty:    current / moderate / strong
service_penalty:     current / moderate / strong
service_factor:      1 / moderate / strong
use_highways:        0 or low when highways are merely discouraged
use_living_streets:  0
use_tracks:           0 unless explicitly desired
```

Do **not** adopt exact constants from this document blindly. The purpose is to fix the objective first, then choose constants from measured preference.

### Adoption rule

A new costing profile should beat the current BACKROADS/FUN profile on:

1. structural-defect rate;
2. human route preference;
3. backroad/quality metrics;
4. latency;
5. clean serve rate.

Do not adopt it merely because one metric improves.

---

## 5.3 Upgrade Valhalla as an isolated experiment

As of this plan, the current official release is Valhalla **3.8.3**, while Roadopia runs 3.7.0.

Do **not** combine the upgrade with costing changes.

Run:

```text
3.7.0 current config
vs.
3.8.3 exact same config and tileset-equivalent build
```

through the frozen suite first.

Only after the engine upgrade is accepted should the new costing experiment be layered on top.

### Important conditional audit

Valhalla 3.8.2 fixed a bug where per-leg:

```text
has_highway
has_toll
has_ferry
```

could always be false when `directions_type=none`.

Search Roadopia for every use of:

```text
directions_type
```

If `none` is used anywhere that trusts `has_highway`, treat that evidence as suspect on 3.7.0.

Prefer graph-edge truth anyway.

---

## 5.4 Fix the A→B detour invariant immediately

Roadopia states:

```text
DETOUR_MAX_DEFAULT = 1.8×
hard structural bar
enforced again on final geometry
```

but also reports:

```text
worst measured detour = 1.92×
```

Those statements are incompatible under one definition.

Before any further A→B architecture decision:

```text
direct_distance = canonical baseline distance
final_distance  = canonical final route distance
ratio           = final_distance / direct_distance

assert ratio <= 1.8 + epsilon
```

Log both distances and their source.

Possible causes to investigate:

- baseline uses one distance definition and audit another;
- route summary distance vs polyline distance;
- stale evaluation code;
- cap enforced only during prediction, not final selection;
- relax ladder bypass;
- units;
- candidate replaced after gate;
- wrong baseline route reused.

Until this is fixed, do not call 43% backroad share the proven A→B ceiling.

---

# 6. Phase 2 — make routing edges the source of truth

Roadopia has outgrown geometry-cell overlap as its canonical road-identity system.

Current detectors use sampled cells to infer whether the same physical road was used.

That is useful as a geometric detector, but it is not exact road identity.

---

## 6.1 Store graph-native identity

For every routed/measured path, retain something conceptually like:

```ts
type RoutedEdge = {
  graphId: string;
  osmWayId?: string;
  direction: "forward" | "reverse";
  beginPct?: number;
  endPct?: number;
  lengthM: number;
};
```

For cores:

```ts
type CorePath = {
  coreId: string;
  tilesetId: string;
  edges: RoutedEdge[];
  displayGeometry: LineString;
  measuredStats: CoreStats;
};
```

### Important

Valhalla `GraphId` is an **internal tileset identity**.

Do not assume a GraphId remains valid after rebuilding graph tiles.

Store the Valhalla tileset identity with every core.

On a tileset change:

```text
invalidate / rebuild graph-edge core representation
```

OSM way IDs can help with cross-build semantic identity, but they are not precise enough by themselves because one way can be split into many routed edges.

---

## 6.2 Build exact overlap primitives

Create canonical edge-based versions of:

```text
sameDirectedEdge
samePhysicalEdge
opposingEdge
edgeOverlapDistance
opposedOverlapDistance
longestOpposedRun
sameWayHomeRatio
coreFidelity
uniqueRoadRatio
```

Normalize shortcuts to underlying base edges where necessary.

Use **distance-weighted** overlap rather than count-of-edges.

### Why this is better

It avoids false positives from:

- parallel roads within 120 m;
- divided carriageways;
- hairpins;
- stacked/interchange geometry;
- two roads that merely pass near each other.

And it catches exact retracing even when geometry sampling differs slightly.

---

## 6.3 Keep geometry detectors for geometry problems

Do **not** delete all geometric detection.

Keep geometry-based logic for:

- microloops;
- visual loop shape;
- closure area;
- self-crossing;
- spatial revisits.

Use graph identity for "same road" questions and geometry for "same shape/area" questions.

---

## 6.4 Add unit fixtures specifically designed to fool cell overlap

Create synthetic or real fixtures for:

1. parallel roads 30–80 m apart;
2. divided highway carriageways;
3. hairpin road;
4. cloverleaf/interchange;
5. two crossings at different levels;
6. same road driven opposite direction;
7. same OSM way split into multiple graph edges;
8. two different OSM ways representing a continuous named road.

For every fixture, assert the expected graph-overlap result.

---

# 7. Phase 3 — replace J1/J2 heuristics with real optimization

The current loop planner:

- chooses J1 as the nearest ring vertex;
- predicts commute from crow distance;
- derives J2 from target arc distance.

This is too coarse for such an important decision.

---

## 7.1 Generate legitimate entry candidates

For each promising ring:

1. sample 8–16 candidate entry/exit positions around the ring;
2. snap them to exact graph positions;
3. prefer real road positions with stable routing correlation;
4. preserve the ring's travel direction and heading;
5. reject positions on undesirable service/residential edges where possible;
6. avoid multiple candidates collapsing to the same graph location.

Do not sample only simplified visual vertices.

---

## 7.2 Use the matrix service for real connector estimates

Roadopia already uses `/sources_to_targets`.

Use it here.

Compute actual network travel times between the origin and candidate ring positions.

This replaces:

```text
crow distance × 1.3 / 55 km/h
```

with actual graph cost.

---

## 7.3 Enumerate J1/J2 pairs

For each ring, enumerate valid pairs with constraints such as:

```text
minimum J1/J2 network or arc separation
arc fraction >= RING_ARC_MIN_FRAC
duration feasibility
direction feasibility
no degenerate graph point
```

For each pair, predict:

```text
out_time
measured_arc_time
home_time
total_time
duration_error
commute_share
arc_fraction
```

Then retain only the best small number.

Example:

```text
ring
 ├─ 40 possible J1/J2 pairs
 ├─ matrix + measured arc cost
 ├─ keep best 3
 ├─ build real connector paths
 └─ judge actual route
```

This is far better than spending a build attempt on only one nearest-entry interpretation of the ring.

---

## 7.4 Prefer alternate J1/J2 before artificial home vias

The current perpendicular ±4/±7 km home-via ladder is a repair mechanism.

Once J1/J2 optimization exists, try:

```text
pair #1
pair #2
pair #3
```

before injecting arbitrary external via points.

A different legitimate ring exit is more likely to produce a natural loop than an artificial perpendicular waypoint.

The home-via ladder should become:

```text
last-resort bounded experiment
```

or disappear if no longer useful.

---

# 8. Phase 4 — model unavoidable origin retracing correctly

The current 1 km origin grace approximates a network-topology problem with a geometric radius.

A funnel subdivision may require 2.5 km of shared arterial.

A well-connected origin may require only 200 m.

The correct concept is:

> **Which initial road edges are unavoidable before the network offers meaningfully independent escape paths?**

---

## 8.1 V1: empirical unavoidable-stem detector

A practical first implementation:

1. choose 8–12 diverse boundary targets around the origin;
2. route engine-default-fastest from origin to each;
3. collect the common contiguous edge prefix;
4. stop when paths branch;
5. repeat inbound if directionality matters;
6. mark the common stem as `unavoidable_origin_edges`.

Then duplication logic becomes:

```text
repeated edge outside unavoidable stem -> defect
repeated edge inside unavoidable stem  -> tolerated
```

Do not use a radius.

---

## 8.2 V2: graph-topology detector

For a more exact implementation, build a local drivable graph around the origin and identify where two edge-disjoint escape routes become available.

Useful graph concepts include:

- bridges;
- articulation points;
- biconnected components;
- edge-disjoint paths;
- local min-cut.

The end of the unavoidable stem is approximately where the origin enters a part of the road graph with more than one independent outward path.

---

## 8.3 Put a cap on the exemption

Do not let the algorithm excuse huge repeated portions of a route.

Record:

```text
unavoidable_stem_m
unavoidable_stem_s
unavoidable_stem_fraction_of_trip
```

If it becomes enormous, the correct product response may be:

> "This area has only one practical way out, so the first/last section must repeat."

That is better than hiding the fact.

---

# 9. Phase 5 — preserve the exact measured core

The current Plan architecture says it serves a measured ring, but runtime routing is allowed to deviate substantially.

Today:

```text
stored measured ring
        ↓
sample <= 15 through points
        ↓
reroute entire trip with LEGACY
        ↓
accept if arc overlap >= 0.60
```

A 0.60 fidelity bar means a large fraction of the supposed measured material can be replaced.

That weakens the central "measured-first" promise.

---

## 9.1 Change the core representation

Store:

```text
exact directed edge sequence
exact full-resolution graph geometry
edge offsets at start/end
measured duration by edge
measured quality by edge
simplified display geometry separately
```

The simplified ~225-vertex line should be a **rendering artifact**, not routing truth.

---

## 9.2 Best long-term serving architecture

Conceptually:

```text
route origin -> exact J1
        +
exact measured core edges J1 -> J2
        +
route exact J2 -> origin
        ↓
one graph-native trip representation
        ↓
maneuvers + final geometry + metrics
```

The previous seam failure came from gluing routed geometry to **simplified** stored geometry and then judging the geometric seam.

It does not prove graph-native composition is wrong.

The fix is to make both connectors and core live in the same graph representation.

---

## 9.3 Implementation paths to evaluate

### Option A — graph-native path assembler

Best long-term option.

Integrate at the Valhalla/library level so Roadopia can combine:

- routed connector edge sequence;
- stored core edge sequence;
- routed return edge sequence;

into a valid trip path and then generate directions.

This may require a maintained Valhalla integration/fork.

### Option B — exact-shape map-match / edge-walk spike

Test whether an exact full-resolution graph shape can be fed through Valhalla's map-matching/trace path quickly enough to reconstruct a single navigable trip without changing the edges.

Do not adopt until:

- fidelity is effectively exact;
- latency is acceptable;
- no seam artifacts appear;
- maneuvers are valid.

### Option C — interim through-point reconstruction

If the current one-route approach must remain temporarily:

- use graph-aligned points, not simplified geometry;
- add directional headings;
- use tight but safe radii;
- use the same intended backroad costing;
- choose through points at meaningful graph intervals;
- raise fidelity dramatically.

Target:

```text
>= 0.90–0.95 edge-distance fidelity
```

Ideally, a route advertised with stored measured statistics should match the measured core almost exactly.

---

## 9.4 Never advertise stale stored metrics

If the actual driven path deviates materially from the core:

```text
recompute quality from actual driven route
```

Do not say:

```text
55% measured backroads
```

if 30–40% of the path was silently replaced.

---

# 10. Phase 6 — separate structural rejection from quality ranking

The current core sweep hard-rejects on many metrics:

```text
backroad_share >= 0.55
main_share <= 0.30
hood_share <= 0.05
turns_per_10min <= 5
loopiness >= 0.25
...
```

Some are genuine structural failures.

Others are quality gradients.

A route at 54.9% backroads is not categorically bad while 55.0% is categorically good.

---

## 10.1 Layer A — hard structural gates

Keep hard failures for things such as:

- U-turn;
- street stub;
- microloop/crescent;
- prohibited highway use;
- invalid access;
- severe non-required retracing;
- route does not return correctly;
- pathological loop shape;
- absurd duration mismatch;
- severe residential/service-road abuse.

These protect the product.

---

## 10.2 Layer B — minimum sanity floors

Some quality dimensions may still need a low catastrophic floor.

Example:

```text
turns_per_10min
```

could have:

```text
preferred <= 5
hard unacceptable > much-higher calibrated floor
```

Do not let a route with one turn above an aesthetic threshold disappear entirely if it is otherwise excellent.

---

## 10.3 Layer C — quality ranking

Rank clean candidates by:

- actual duration fit;
- backroad share;
- main-road share;
- hood share;
- curviness;
- road continuity;
- turn density;
- urban share;
- unique-road ratio;
- measured core quality;
- connector burden.

Prefer lexicographic or Pareto-style ranking where useful rather than one opaque weighted sum.

---

## 10.4 Do not serve the first passing candidate

Current drive-first serves the **first** candidate passing every gate.

Change this.

Within a bounded budget:

```text
evaluate several likely clean candidates
keep best_clean_so_far
serve best after search budget / candidate cap
```

This preserves determinism while giving Roadopia a chance to choose a better route rather than merely an acceptable route.

Use deterministic tie-breakers.

---

# 11. Phase 7 — tighten duration semantics and remove dirty fallback

The current Plan hard gate is ±25%.

For a 60-minute ask, that allows roughly:

```text
45–75 minutes
```

That is difficult to reconcile with:

> "1 hour means 1 hour."

Once clean-duration alternatives exist, tighten the contract.

Recommended model:

```text
preferred band: approximately ±10%
maximum normal band: approximately ±15%
outside maximum: offer an explicitly different-duration clean route
```

The exact final values should be calibrated from product preference, but ±25% should not remain the long-term meaning of "right duration."

---

## 11.1 Replace legacy fallback behavior

Current fallback can still produce:

- low backroad share;
- poor loop shape;
- very large duration errors.

Disclosure does not make that a good Roadopia route.

Change the decision tree to:

```text
1. clean route near requested duration
2. clean route at closest alternate duration
3. clean dynamic Roadopia route if available
4. honest "no clean route available" state
```

Do not ship a route that violates the complaints Roadopia was built to eliminate merely because it can be described honestly.

---

## 11.2 Suggested user experience

Requested:

```text
120-minute backroads loop
```

No clean route exists close enough.

Return:

```text
No clean 2-hour loop fits this area right now.

Best nearby options:
• 98 min — excellent backroads loop
• 137 min — excellent backroads loop
```

This preserves trust.

---

## 11.3 Transitional migration

Do not delete the legacy planner immediately.

First change it from:

```text
fallback that may ship dirty
```

to:

```text
candidate generator whose output must pass the same final structural gates
```

Then measure how often it contributes a genuinely clean winner.

If nearly never, remove it.

---

# 12. Phase 8 — fix measured-core supply rather than only adding sweeps

The current index has many stored loop rows but far fewer distinct rings because overlapping sweep cells generate duplicates.

More sweeping without fixing index structure wastes work.

---

## 12.1 Global deduplication during build

Current dedup is primarily per cell.

Add a global or shard-level final dedup pass based on exact edge overlap.

Create a stable `core_signature` from road identity.

For same-tileset dedup:

```text
normalized canonical edge sequence / edge set
```

For cross-build semantic comparison:

```text
OSM way + segment geometry signature
```

This will:

- reduce duplicate storage;
- make selection faster;
- make diversity statistics honest;
- prevent per-cell caps from being consumed by copies of the same drive.

---

## 12.2 Replace delete-per-version loading

The current loader makes targeted top-up awkward.

Add an incremental loader capable of:

```text
insert/upsert sweep shard
replace one geographic partition
merge top-up artifact
delete one shard/version subset
rebuild global dedup index
```

Every row should retain provenance:

```text
sweep_run_id
cell_id
config_stamp
tileset_id
source_artifact
```

This directly unlocks a Cobourg top-up without risking the entire index.

---

## 12.3 Build a supply coverage map

For each geographic cell, record:

```text
number of distinct clean loops
duration-band coverage
average quality
number of clean ribbons
reachable population/origin coverage
duplicate ratio
failure histogram
```

Use this to target future sweeps.

Do not simply sweep all cells more.

---

## 12.4 Adaptive sweep density

Increase pseudo-origins/candidates only where:

- good-road material exists but clean loop count is low;
- assembly rejection is unusually high;
- duration coverage has gaps;
- runtime requests frequently fall back;
- duplicates dominate the cell.

Supply deserts caused by true road topology should be treated differently from supply deserts caused by weak generation.

---

# 13. Phase 9 — build Roadopia-aware routing cost

This is the architectural step that should ultimately reduce the number of repair ladders.

The goal is:

> **make good roads cheap in the search itself.**

---

## 13.1 Start with stock Valhalla capabilities

First prove how far tuned `auto` can go.

Do not create a custom Valhalla fork until Phase 1 shows the stock model cannot represent the desired preference strongly enough.

---

## 13.2 Determine the lowest-risk supported extension path

Do **not** assume Valhalla exposes a stable request-level API for attaching arbitrary Roadopia quality factors to selected road features. That mechanism is not established by the current official documentation used for this plan.

Instead, run a short source-level engineering spike with this decision order:

1. **Stock `auto` costing first.** Determine how far Roadopia can get using documented `auto` options such as `use_distance`, maneuver/service penalties, soft highway preference, and hard exclusions where appropriate.
2. **Inspect Valhalla's current Sif/dynamic-costing extension points in the exact version Roadopia intends to run.** Identify the smallest maintainable way to expose Roadopia-specific edge quality to path costing.
3. **Prefer an upstream-supported or narrowly isolated extension** if one exists and is sufficient.
4. **Only then consider a maintained custom `RoadopiaCost` / Valhalla fork** if stock costing cannot express the product objective strongly enough.

Acceptance questions:

1. Can Roadopia's per-edge quality signal influence path expansion rather than only post-route ranking?
2. Can the mechanism use the road attributes Roadopia needs?
3. Does it work for `/route` and any matrix behavior that must stay cost-consistent?
4. Is its latency acceptable under the production wall-clock budget?
5. Is it deterministic?
6. Can it be versioned cleanly with the Valhalla/OSM tileset?
7. What maintenance burden does a Valhalla upgrade create?

The purpose of this spike is to choose a **verified extension mechanism**, not to commit to a particular undocumented feature interface.

---

## 13.3 Custom `RoadopiaCost` only if justified

Valhalla is architected around dynamic edge and transition costing, but Roadopia should assume that a truly custom model is a **code-level integration / maintained fork or extension**, not a magic JSON plugin.

The custom cost should remain positive and routing-safe.

Conceptually:

```text
roadopia_edge_cost =
    travel_time_component
  × road_class_factor
  × density_factor
  × curvature_factor
  × surface_factor
  × continuity_factor
  + transition_penalties
```

---

## 13.4 Do not equate "curvy" with "good"

Roadopia already has a useful curvature signal.

Expand it.

A great driving road is more like:

```text
moderate/sustained curvature
+ rural or low-density context
+ useful speed
+ few interruptions
+ long continuity
+ acceptable surface
+ few service/residential transitions
```

A subdivision can also be curvy.

Very extreme curvature can indicate slow local roads or hairpins.

Use a **preference curve**, not "more curvature is always better."

---

## 13.5 Recommended edge features

Build a per-directed-edge Roadopia feature vector containing as much of the following as reliable data allows:

```text
curvature percentile
curvature continuity
road class
speed / speed band
urban density
residential context
intersection density
traffic-control density proxy
surface
lane count
road-name continuity
uninterrupted-run length
service-road status
living-street status
track status
highway status
elevation/grade where useful
scenic/POI context only if grounded
```

Especially important:

### Continuity

Measure how long the driver can remain on a coherent enjoyable road without:

- road-name changes;
- frequent intersections;
- constant turning;
- short disconnected curvy fragments.

This should become a first-class Roadopia metric.

---

## 13.6 Learn weights from human preference

Do not hand-tune 20 coefficients forever.

Create pairwise labeled data from the blind human review.

Example:

```text
route A preferred over route B
```

Fit a simple interpretable preference model first:

- logistic regression;
- pairwise ranking;
- small gradient-boosted model.

The output can help choose cost factors and ranking weights.

The production router itself can remain deterministic.

No LLM geography is needed.

---

# 14. Phase 10 — generate loops structurally

This is the longer-term replacement for waypoint roulette.

The generator should understand that a loop requires **distinct road structure**, not merely several points and a return to origin.

---

## 14.1 Prevent retracing while searching

The ideal search process knows:

```text
edge already used by outbound path
```

and makes using it again expensive unless it belongs to the unavoidable origin stem.

This changes the problem from:

```text
create repeated route -> reject
```

to:

```text
avoid repeated route during search
```

---

## 14.2 Practical first structural generator

A pragmatic version:

1. derive reachable time/distance frontier from requested duration;
2. find high-quality road regions in several angular sectors;
3. choose two or three anchors with strong Roadopia road value;
4. route outward under Roadopia cost;
5. route cross-sector under Roadopia cost;
6. route home with used-edge penalties;
7. preserve unavoidable-origin exceptions;
8. reject only remaining structural defects;
9. compare several clean candidates.

---

## 14.3 More graph-native approaches to investigate

Potential algorithms:

- k-shortest cycles around origin;
- weighted cycle search;
- cycle-basis search on the high-quality subgraph;
- two approximately edge-disjoint paths to a remote region, joined into a loop;
- Suurballe-style disjoint-path ideas adapted to positive Roadopia cost;
- constrained shortest-cycle search with target-duration Lagrangian penalty.

Do not start here.

Use this after edge identity and Roadopia costing are stable.

---

# 15. Discover — what to keep and what to change

Discover is currently the healthiest surface.

Do **not** unnecessarily rewrite it.

Keep:

- measured loop cores only;
- default-fastest commute connectors;
- simple connector behavior;
- same-way-home as an honest label rather than forced repair;
- exact stored drive geometry;
- menu dedup.

Improve:

1. graph-edge dedup instead of geometry-cell dedup;
2. global core dedup during build;
3. targeted top-up loader;
4. coverage-map-driven sweeps;
5. tileset-versioned exact core representation.

Long-term:

- remove the silent v1 out-and-back fallback in regions that have adequate measured coverage;
- in true deserts, prefer an honest "limited curated drives here" state over pretending a lower-quality fallback is equivalent to measured Discover.

---

# 16. A→B — recommended plan

Do not spend the first engineering effort here.

First fix the evaluation invariant.

Then expand the test suite beyond 10 corridors.

---

## 16.1 Do not declare 43% a universal ceiling yet

The multi-ribbon experiment:

- significantly improved some weak corridors;
- hurt some already-strong corridors.

That does **not** prove ribbons are useless.

It proves candidate architecture quality depends on corridor structure.

---

## 16.2 Turn A→B into candidate competition

Longer term:

```text
direct baseline
        ↓
candidate generator A: current corridor planner
candidate generator B: multi-ribbon chain
candidate generator C: Roadopia-cost direct/corridor route
        ↓
same hard detour gate
        ↓
same structural gates
        ↓
same quality judge
        ↓
best clean candidate
```

Do not require one architecture to globally beat another before it may ever be used.

---

## 16.3 Control latency

Possible policy:

1. build the proven current corridor candidate;
2. estimate whether alternate material has meaningful upside;
3. invoke alternate generator only for weak/uncertain corridors;
4. compare actual final candidates;
5. deterministic winner.

The predictor can use:

```text
good-road km inside corridor
continuity of those roads
available ribbon duration
distance from direct axis
legacy predicted quality
detour headroom
```

---

# 17. Evaluation redesign

Roadopia's audit discipline is good. Keep it, but strengthen it.

---

## 17.1 Every historical complaint remains first-class

Continue explicit rows for:

```text
u-turn
street stub
microloop
not-a-loop
duration miss
doubling
same-way-home
turn soup
highway violation
residential abuse
```

Add:

```text
core_edge_fidelity
unavoidable_stem_excluded_retrace
actual_vs_advertised_quality
road_continuity
route_name_hopping
```

---

## 17.2 Add invariant tests

Invariants should fail the test process, not merely appear in reports.

Examples:

```text
strict highway avoid -> no forbidden interior highway edges
A→B final detour <= cap + epsilon
stored GraphId core tileset == active Valhalla tileset
served "measured" stats correspond to actual served edges
route duration field == final routed duration definition
no NaN / missing gate values
no candidate bypasses final judge
```

---

## 17.3 Add metamorphic tests

Examples:

### Shortest

With `shortest=true`, changing a soft penalty should not be expected to affect path cost behavior.

With `shortest=false`, a deliberately extreme penalty should measurably change at least a known fixture.

### Highway exclusion

Turning strict highway exclusion on should:

- remove highway edges; or
- make the route impossible.

### Core fidelity

Perturbing one sparse through point must not allow a route to retain "measured" status if edge fidelity collapses.

### Origin stem

Moving the same test origin from a funnel road to a well-connected intersection should shrink the unavoidable stem.

---

## 17.4 Human preference is an adoption gate

For major architecture changes, require the new system to win blind pairwise comparisons on the holdout set.

A recommendation:

```text
new system should be clearly preferred on a strong majority of judged routes
and should not introduce any new hard-defect class
```

Do not optimize for a single magic percentage; preserve the raw judgment distribution.

---

# 18. Suggested end-state request flow

A mature Plan request should look approximately like this:

```text
brief / chips
        ↓
deterministic ParsedConstraints
        ↓
strict contract:
  origin
  target total duration
  character
  avoids
        ↓
candidate sources
  ├─ nearby measured cores
  └─ dynamic graph candidates
        ↓
real matrix feasibility
        ↓
J1/J2 pair optimization
        ↓
Roadopia-aware route search
        ↓
exact graph-edge path
        ↓
structural gates
  ├─ no u-turn
  ├─ no stub
  ├─ no microloop
  ├─ no forbidden highway
  ├─ no non-required retrace
  └─ valid loop topology
        ↓
quality ranking
        ↓
duration ranking
        ↓
best clean candidate
        ↓
if none near target:
  nearest clean duration alternatives
        ↓
facts-only explanation
```

The LLM boundary should **not change**.

Keep the model out of geography.

---

# 19. Concrete loop planner pseudocode

```ts
async function planLoop(req: LoopRequest): Promise<LoopResult> {
  const constraints = parseDeterministically(req);

  const unavoidableStem = await getUnavoidableOriginStem(
    constraints.origin
  );

  const measuredCores = await findCandidateCores(
    constraints.origin,
    constraints.targetDuration
  );

  const pairCandidates = [];

  for (const core of measuredCores) {
    assertCoreTilesetCompatible(core);

    const ports = buildGraphAlignedCorePorts(core);

    const matrix = await priceOriginToPorts(
      constraints.origin,
      ports
    );

    const pairs = enumerateFeasibleJ1J2Pairs(
      core,
      ports,
      matrix,
      constraints.targetDuration
    );

    pairCandidates.push(...takeBestPairs(pairs));
  }

  const rankedPairs = deterministicPairRank(pairCandidates);

  const cleanCandidates = [];

  for (const pair of bounded(rankedPairs)) {
    const candidate = await buildExactCoreTrip(
      constraints.origin,
      pair,
      constraints
    );

    const defects = judgeStructuralDefects(
      candidate,
      unavoidableStem,
      constraints
    );

    if (defects.length > 0) {
      recordRejection(candidate, defects);
      continue;
    }

    candidate.quality = scoreQuality(candidate);
    cleanCandidates.push(candidate);

    if (budgetShouldStop()) break;
  }

  const dynamicCandidates =
    shouldTryDynamicSearch(cleanCandidates, constraints)
      ? await buildDynamicRoadopiaCandidates(
          constraints,
          unavoidableStem
        )
      : [];

  for (const c of dynamicCandidates) {
    if (judgeStructuralDefects(c, unavoidableStem, constraints).length === 0) {
      cleanCandidates.push(c);
    }
  }

  const nearTarget = rankCleanCandidates(
    cleanCandidates,
    constraints.targetDuration
  );

  if (hasCandidateInsideNormalDurationBand(nearTarget)) {
    return serve(bestCandidate(nearTarget));
  }

  const alternatives = bestCleanDurationAlternatives(cleanCandidates);

  if (alternatives.length > 0) {
    return serveDurationChoices(alternatives);
  }

  return noCleanRouteAvailable();
}
```

The important difference is philosophical:

```text
hard gates decide whether a route is broken
quality decides which clean route is best
duration decides whether it is the requested product or an alternate
```

---

# 20. Rollout strategy

Every major change remains feature-flagged.

Recommended flags:

```text
VALHALLA_383
BACKROADS_AUTO_COST_V2
EDGE_NATIVE_OVERLAP
CORE_EDGE_PATHS
J1J2_MATRIX_OPT
UNAVOIDABLE_STEM
EXACT_CORE_SERVING
QUALITY_RANKING_V2
CLEAN_DURATION_ALTERNATIVES
ROADOPIA_DYNAMIC_COST
STRUCTURAL_LOOP_SEARCH
ATOB_ADAPTIVE_CANDIDATES
```

Adoption sequence:

```text
offline evaluation
        ↓
holdout evaluation
        ↓
human blind review
        ↓
shadow/replay comparison
        ↓
limited rollout
        ↓
full rollout
```

Every flag must be byte-behavior-identical when off where practical.

---

# 21. Recommended target metrics

These should be treated as directionally strong goals, not blindly hard-coded product truth.

## Structural quality

Target on the gold suite:

```text
U-turns:                 0
street stubs:            0
microloops:              0
forbidden highway use:   0
non-required severe
opposed retrace:         0
```

## Duration

Long-term target:

```text
preferred: roughly within ±10%
normal hard band: roughly within ±15%
outside band: clean alternate duration instead of dirty fallback
```

## Measured-core integrity

```text
advertised measured route:
edge fidelity ideally ~100%
temporary reconstruction:
>= 90–95% and recompute stats if materially different
```

## Coverage

Track separately:

```text
clean exact-duration serve rate
clean alternate-duration coverage
true no-clean-route rate
```

The goal is to drive dirty fallback to **zero**, not merely reduce it.

## Human quality

The new system should be strongly preferred to the current baseline on the blind holdout set without introducing new hard defects.

## Latency

Preserve the existing overall wall-clock contract.

Do not adopt an architecture that looks good only in offline evaluation but routinely truncates in production.

---

# 22. What not to do next

Do **not** spend the next iteration on:

- changing 1.2 km to 1.1 km;
- changing 4 km via to 5 km via;
- changing a loopiness threshold by a few hundredths;
- adding a seventh connector repair ladder;
- adding more hard gates without improving generation;
- globally increasing sweep volume before global dedup/top-up support;
- lowering quality bars simply to improve serve rate;
- silently expanding origin grace;
- adding LLM-generated geography;
- declaring A→B solved from a 10-corridor suite;
- creating a custom Valhalla fork before testing ordinary `auto` properly;
- storing Valhalla GraphIds without a tileset identity;
- trusting simplified geometry as exact routing truth;
- calling a route "measured" when 40% of the drive may have changed.

Those actions attack symptoms.

---

# 23. Exact implementation order

If Roadopia were being repaired from the current frozen state, this is the order I would follow.

## Step 1 — freeze and instrument

- freeze expanded gold suite;
- freeze holdout;
- record Valhalla config/tileset identity;
- add missing invariants;
- create human comparison workflow.

**Do not change production behavior yet.**

---

## Step 2 — verify Valhalla assumptions

- test `allow_hard_exclusions`;
- inspect warnings;
- prove strict `exclude_highways`;
- search `directions_type=none`;
- repair any false `has_highway` assumptions;
- isolate-test upgrade to 3.8.3;
- fix A→B detour invariant.

**Exit condition:** routing-engine behavior is understood and reproducible.

---

## Step 3 — replace `shortest`

- create small stock-`auto` profile suite;
- evaluate current vs new;
- blind human review;
- adopt best non-shortest profile only if clearly better.

**Exit condition:** Roadopia's base router is no longer optimizing pure metres for fun/backroads requests.

---

## Step 4 — add graph-edge truth

- capture directed edge identity;
- version by tileset;
- implement exact overlap/retrace/fidelity;
- leave existing cell detectors in parallel temporarily;
- compare disagreement cases;
- switch canonical road identity once validated.

**Exit condition:** same-road decisions are graph-native.

---

## Step 5 — optimize J1/J2

- graph-aligned ring ports;
- matrix pricing;
- pair enumeration;
- alternate pair retries;
- reduce reliance on perpendicular home vias.

**Exit condition:** funnel and awkward-entry failures improve without lowering structural standards.

---

## Step 6 — unavoidable stem

- implement empirical common-prefix detector;
- add funnel fixtures;
- replace fixed 1 km doubling grace;
- optionally move to biconnectivity/edge-disjoint topology later.

**Exit condition:** necessary retracing is exempted because it is *provably necessary*, not because it lies inside a radius.

---

## Step 7 — exact core serving

- store exact edge sequences;
- experiment with graph-native composition / exact edge-walk path;
- stop using simplified core geometry as routing truth;
- raise edge fidelity for any remaining reconstruction path;
- recompute stats whenever actual path changes.

**Exit condition:** measured means measured.

---

## Step 8 — quality-ranking split

- structural gates remain hard;
- quality metrics become ranking/tier inputs;
- build several clean candidates;
- serve best clean, not first clean.

**Exit condition:** quality improves without starving supply at arbitrary cliffs.

---

## Step 9 — remove dirty fallback

- implement nearest-clean-duration alternatives;
- legacy becomes candidate-only;
- never serve legacy output unless it passes the same structural judge;
- tighten normal duration band.

**Exit condition:** no route is knowingly shipped with the old failure experience.

---

## Step 10 — repair supply system

- global dedup;
- incremental loader;
- coverage map;
- targeted sweeps;
- Cobourg top-up;
- adaptive generation density.

**Exit condition:** measured supply grows in distinct useful drives rather than duplicate rows.

---

## Step 11 — Roadopia-aware cost

- determine whether stock `auto` is enough;
- inspect and verify the supported Sif/dynamic-costing extension path in the target Valhalla version;
- if stock costing is insufficient, prototype the smallest maintainable custom `RoadopiaCost` integration;
- calibrate using human preference.

**Exit condition:** the routing search itself prefers the roads Roadopia wants.

---

## Step 12 — structural dynamic loop search

- introduce used-edge penalties / disjoint-path logic;
- generate clean loops dynamically;
- use measured cores as seeds/cache rather than the only high-quality source.

**Exit condition:** Plan no longer depends on precomputed complete rings for every good result.

---

## Step 13 — A→B adaptive policy

Only after the shared foundations are correct:

- enlarge corridor suite;
- run multiple candidate generators where justified;
- select best clean candidate under exact 1.8× cap;
- determine whether 43% was a real material ceiling or only a property of the old objective.

---

# 24. Recommended final architecture

```text
OpenStreetMap + Valhalla tiles
            ↓
graph-native Roadopia edge attributes
            ↓
Roadopia road-quality model
            ↓
dynamic routing cost
            ↓
candidate topology generator
            ↓
exact directed-edge candidate paths
            ↓
hard structural judge
            ↓
quality + duration ranking
            ↓
best clean route
```

Alongside:

```text
offline measured loops
        ↓
Discover
+ Plan seeds/cache
+ quality reference material
```

And:

```text
LLM
 ├─ parse natural-language intent
 └─ explain already-grounded facts

LLM never chooses geography
```

---

# 25. Final recommendation

The current Roadopia planner is not failing because it lacks enough detectors.

It is failing because too much intelligence sits **after** route generation.

The next stage should move intelligence earlier:

```text
from:
route first -> inspect -> reject -> repair

to:
cost good roads correctly
-> construct good topology
-> preserve exact roads
-> validate final result
```

The most important concrete actions are:

1. **fix/verify hard exclusions;**
2. **remove `shortest=true`;**
3. **move to directed-edge truth;**
4. **jointly optimize J1/J2 with real matrix costs;**
5. **derive unavoidable retracing from the road network;**
6. **preserve measured core edges exactly;**
7. **split structural defects from quality ranking;**
8. **replace dirty fallback with clean duration alternatives;**
9. **improve distinct measured supply with global dedup/top-ups;**
10. **build Roadopia-aware dynamic costing and eventually structural loop search.**

If these are implemented in that order, Roadopia should become substantially simpler conceptually even if the underlying routing code becomes more capable: fewer repair ladders, fewer magic geometric tolerances, fewer false failures, more clean coverage, and a route generator whose search objective finally matches the product.

---

# Appendix A — specific contradictions / risks to resolve

## A.1 `shortest` vs soft costing

Current design notes correctly say soft factors are ineffective under shortest routing.

Resolution:

```text
do not use shortest for Roadopia quality routing
```

## A.2 "hard" highway avoidance implemented as preference

`use_highways: 0` is not the same as a hard prohibition.

Resolution:

```text
enable and test hard exclusions
```

## A.3 measured ring vs 60% fidelity

A route can materially differ from stored measured road while still retaining measured framing.

Resolution:

```text
edge-native exact path or much higher fidelity + actual-route metrics
```

## A.4 "1 hour means 1 hour" vs ±25%

Current tolerance allows a wide range.

Resolution:

```text
tight normal band + clean alternate duration
```

## A.5 hard 1.8× A→B cap vs measured 1.92×

Evaluation/gating contradiction.

Resolution:

```text
single canonical ratio + invariant assertion
```

## A.6 fixed 1 km grace vs topology

Funnel origins are a network property, not a radial-distance property.

Resolution:

```text
unavoidable-origin edge set
```

## A.7 403 loop rows vs 91 distinct rings

The index contains significant duplicate material.

Resolution:

```text
global edge-native dedup + incremental loader
```

## A.8 audits historically missing what the driver felt

Even a better audit can eventually overfit itself.

Resolution:

```text
permanent blind human holdout signal
```

---

# Appendix B — official Valhalla references used for verification

These are external implementation references, not substitutes for Roadopia's own measured tests.

- Valhalla Route API reference:  
  https://valhalla.github.io/valhalla/api/route/api-reference/

- Valhalla project / dynamic routing architecture:  
  https://valhalla.github.io/valhalla/

- Valhalla releases:  
  https://github.com/valhalla/valhalla/releases

- Valhalla Graph utilities / graph edge shapes:  
  https://valhalla.github.io/valhalla/bindings/python/api/graph_utils/

- Valhalla Expansion API / internal edge IDs for debugging:  
  https://valhalla.github.io/valhalla/api/expansion/api-reference/

- Valhalla Meili map-matching library / GraphId matching:  
  https://valhalla.github.io/valhalla/meili/library_api/

---

# Appendix C — source-of-truth rule during implementation

For every future Roadopia routing experiment:

```text
1. State the hypothesis.
2. State what metric/result would make it win.
3. State what would make it lose.
4. Run through the real planner entrypoint.
5. Preserve the same wall-clock constraints.
6. Evaluate hard defects first.
7. Evaluate human route preference.
8. Check holdout.
9. Adopt or refuse.
10. Document the reason.
```

Keep the existing refusal-ledger discipline.

The difference is that future experiments should prioritize improving the **generator's objective and graph representation**, not adding more downstream patches.
