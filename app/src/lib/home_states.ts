/**
 * The merged home's state table (redesign — SPEC "The Shelf": "`lib/home_states.ts`
 * (pure, node-testable, the Map-first reducer idea): `state → { detentOnEntry,
 * mapLayer, leavesTo }`").
 *
 * MapHome is two screens folded into one map (the Discover scan and the seed
 * map), and the questions that used to be answered by which TAB you were on —
 * which lines are on the map, where the shelf opens, what "back" means — are
 * now answered per STATE. Answering them here, as data, keeps the screen from
 * deciding them inline in render (where the two old screens' rules would drift
 * apart again) and makes every answer a node assertion rather than a device
 * observation.
 *
 * THE STATES.
 *   browse.nearby     the Discover scan — origin buttons, the drive menu
 *   browse.allRoads   the seed map — every map_routes row
 *   detail.drive      one Discover drive, tapped on the map
 *   detail.seed       one seed route, tapped on the map or in the list
 *   detail.spot       one spot pin, tapped on the map
 *
 * THE ANSWERS.
 *   detentOnEntry  where the shelf opens when this state is ENTERED (SPEC: every
 *                  state opens at `half` — the list is readable, the map is
 *                  still most of the screen). The user's later drag is theirs.
 *   mapLayer       which LINE source is on the map: the scan (`discover-drives`,
 *                  per-leg) once a Near-you menu has loaded — including while its
 *                  drive is open — otherwise the seeds (the never-empty map,
 *                  FR-010). Spot pins draw in every state.
 *   camera         what the camera fits: the layer on the map, the one line
 *                  opened, or the tapped pin (eased to, SPEC detail.spot).
 *   leavesTo       what "back" returns to: a detail leaves to the browse mode it
 *                  was opened from; a browse mode is a root and leaves nowhere.
 *
 * Also here, pure: the three detent heights (`homeDetents`), so the screen and
 * its tests derive the same numbers from the same window.
 */

export type HomeMode = 'nearby' | 'allRoads';

/** Where the Near-you scan is: nothing asked yet, in flight, a menu, an honest
 *  empty, or a failure of any kind (rejected / transport / unavailable). */
export type ScanStatus = 'unset' | 'loading' | 'loaded' | 'empty' | 'failed';

export type HomeState =
  | { kind: 'browse'; mode: 'nearby'; scan: ScanStatus }
  | { kind: 'browse'; mode: 'allRoads' }
  | { kind: 'detail'; of: 'drive' }
  | { kind: 'detail'; of: 'seed'; from: HomeMode; scan: ScanStatus }
  | { kind: 'detail'; of: 'spot'; from: HomeMode; scan: ScanStatus };

export type HomeDetent = 'collapsed' | 'half' | 'full';

/** The line source on the map. Pins draw in every state. */
export type HomeMapLayer = 'seeds' | 'scan';

export interface HomeView {
  detentOnEntry: HomeDetent;
  mapLayer: HomeMapLayer;
  /** `layer`: fit what is on the map; `one`: fit the opened line; `pin`: ease
   *  the camera to the tapped pin. */
  camera: 'layer' | 'one' | 'pin';
  leavesTo: HomeState | null;
}

/** The browse state a Near-you scan status describes. */
function nearby(scan: ScanStatus): HomeState {
  return { kind: 'browse', mode: 'nearby', scan };
}

const ALL_ROADS: HomeState = { kind: 'browse', mode: 'allRoads' };

/** The scan draws only once it has a menu; every other Near-you state — no
 *  origin yet, in flight, empty, failed — leaves the seeds on the map so it is
 *  never blank (SPEC MapHome item 1; FR-010). */
function layerFor(mode: HomeMode, scan: ScanStatus): HomeMapLayer {
  return mode === 'nearby' && scan === 'loaded' ? 'scan' : 'seeds';
}

/** The reducer: one state in, the four answers out. */
export function homeView(state: HomeState): HomeView {
  if (state.kind === 'browse') {
    return state.mode === 'nearby'
      ? {
          detentOnEntry: 'half',
          mapLayer: layerFor('nearby', state.scan),
          camera: 'layer',
          leavesTo: null,
        }
      : { detentOnEntry: 'half', mapLayer: 'seeds', camera: 'layer', leavesTo: null };
  }
  switch (state.of) {
    case 'drive':
      // A Discover drive exists only inside a loaded menu — its layer is the scan.
      return { detentOnEntry: 'half', mapLayer: 'scan', camera: 'one', leavesTo: nearby('loaded') };
    case 'seed':
      return {
        detentOnEntry: 'half',
        mapLayer: 'seeds',
        camera: 'one',
        leavesTo: state.from === 'nearby' ? nearby(state.scan) : ALL_ROADS,
      };
    case 'spot':
      return {
        detentOnEntry: 'half',
        mapLayer: layerFor(state.from, state.scan),
        camera: 'pin',
        leavesTo: state.from === 'nearby' ? nearby(state.scan) : ALL_ROADS,
      };
  }
}

/** The collapsed detent: grabber + the header row (SPEC "The Shelf"). */
export const COLLAPSED_DETENT_H = 132;
/** The half detent as a share of the window. */
export const HALF_DETENT_FRACTION = 0.48;
/** What the full detent leaves above itself for the control column
 *  (`topInset + 56` — the same clearance the camera's top inset uses). */
export const FULL_DETENT_CLEARANCE = 56;

/**
 * The shelf's three heights for a window. Pure, so the screen and its tests
 * agree on the number a commit pads the camera by: `collapsed` 132, `half` 48 %
 * of the window, `full` the window minus the top inset and the control column.
 */
export function homeDetents(
  windowHeight: number,
  topInset: number,
): Readonly<Record<HomeDetent, number>> {
  return {
    collapsed: COLLAPSED_DETENT_H,
    half: Math.round(windowHeight * HALF_DETENT_FRACTION),
    full: Math.max(
      COLLAPSED_DETENT_H,
      Math.round(windowHeight - (topInset + FULL_DETENT_CLEARANCE)),
    ),
  };
}
