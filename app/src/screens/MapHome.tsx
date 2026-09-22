/**
 * The Map tab — the MERGED home (redesign — SPEC "MapHome (merged home)").
 *
 * WHAT IT WAS. Two tabs on the same `DriveLinesMap`: Discover (an opaque title
 * card with two origin buttons and a status line over its own map, a
 * horizontal rail of drive cards, "Let's go" filled in each) and Map (seed
 * lines + clustered pins, `MapNotice` banners, an "Add spot" FAB, an opaque
 * `DetailSheet`). WHAT IT IS. One full-bleed map, a status-bar scrim, a
 * top-right column of two Material circles, and one persistent gesture SHELF
 * whose body is a two-mode list — Near you (the Discover scan) · All roads
 * (every seed route) — that swaps in place to the tapped drive / route /
 * spot's detail. The header is none: the map is the page.
 *
 * WHAT DID NOT CHANGE — the data model and the honesty, both screens' worth:
 *   - the never-empty anonymous map (FR-010): seed routes as amber polylines
 *     (`map_routes`), clustered spot pins (`map_spots`, the signed-in token so
 *     the user's own pins come back), enrichment never blocks, a route-data
 *     failure is a friendly line + Retry with the map still interactive;
 *   - the Discover scan (R24 / R29 v2): origin from the shared PlanDraft
 *     (PickPoint writes `draft.origin`; `MapStack` owns the provider now),
 *     `classifyFailure` untouched — the server's own rejection reason, never
 *     "check your connection" unless the connection IS the cause; the empty
 *     menu stated with every disclosure, never padded; the curve WORD, never a
 *     number (Hard rule D); "Let's go" opens Result instantly with the pre-built
 *     route, else the shared /plan flow;
 *   - following a seed drive fetches the FULL row first (the map line is the
 *     simplified copy) and falls back to the line — never a dead end;
 *   - the opening camera: where the OS ALREADY knows the user is
 *     (`getKnownLocation`, never a prompt), an origin the user chose outranking
 *     it; the region fit is the fallback, derived from data (§46). Choosing an
 *     origin stays an act the user performs.
 *
 * THE STATE TABLE is `lib/home_states.ts` (pure): each state answers which
 * line source is on the map, where the shelf opens, what the camera fits and
 * what "back" returns to. The screen reads the answers; it does not re-derive
 * them inline.
 *
 * THE CAMERA AND THE SHELF (SPEC item 1; Risks). The camera fits into the map
 * the shelf leaves visible: `bottom = tabBar + committed detent + spacing.md`,
 * `top = topInset + 56` (the control column), committed on `onDetent` — never
 * per frame, so a free drag never re-fits and a commit re-pads the SAME fit
 * without a flight (DriveLinesMap's own rule). The attribution strip rides the
 * same committed number (FR-014). A detail opening snaps the shelf to `half`
 * and fits the tapped line above it — one camera update, the detent and the
 * fit arriving together.
 *
 * MOTION GATE. Camera travel: occasional, spatial consistency — rnmapbox
 * `easeTo` 650 ms (DriveLinesMap; the first fit of a mount is instant). The
 * two circles: press only → `PressableScale`. The shelf: its own physics.
 * Haptic: the picker's `selectionAsync` (inside the wrapper) and the shelf's
 * Light at a detent catch — nothing on a map tap (the detent catch that
 * follows is the feedback), nothing on scroll, nothing on an entrance.
 */

import { CircleLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import type {
  CoreDrive,
  DiscoverResult,
  DiscoverResultV2,
  LatLng,
  NearbyDrive,
  Route,
} from '@shared/types';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import DriveLinesMap, { DEFAULT_CAMERA_INSETS } from '../components/DriveLinesMap';
import HomeShelf, {
  type HomeShelfAction,
  type HomeShelfDetail,
  type HomeShelfItem,
  type HomeShelfNote,
} from '../components/HomeShelf';
import {
  Button,
  Material,
  PressableScale,
  StatusScrim,
  Symbol,
  Text,
  type ShelfHandle,
} from '../components/ui';
import { ApiError, NetworkError, transportMessage } from '../lib/api';
import {
  fetchMapRoutes,
  fetchMapSpots,
  routesBounds,
  routesToFeatureCollection,
  spotsToFeatureCollection,
  type Bounds,
  type MapRouteRow,
  type SpotRow,
  type SupabaseConfig,
} from '../lib/data';
import {
  buildDiscoverPlanRequest,
  coreDrivesBounds,
  coreDrivesToFeatureCollection,
  coreDriveToRoute,
  coreTripLabel,
  DISCOVER_V1_FALLBACK,
  DISCOVER_V2,
  DiscoverUnavailableError,
  discoverDrivesToFeatureCollection,
  driveDurationS,
  drivesBounds,
  fetchDiscoverCores,
  fetchDiscoverDrives,
  nearbyDriveToRoute,
} from '../lib/discover';
import {
  FULL_DETENT_CLEARANCE,
  homeDetents,
  homeView,
  type HomeDetent,
  type HomeMode,
  type HomeState,
  type ScanStatus,
} from '../lib/home_states';
import { useTabBarHeight, useTopInset } from '../lib/insets';
import { fetchRouteById } from '../lib/library';
import { getCurrentLocation, getKnownLocation, type LocationResult } from '../lib/location';
import { listSpotPhotos, type PhotoRef } from '../lib/photos';
import { usePlanDraft } from '../lib/plan_draft';
import { getApiBaseUrl, getSupabaseConfig } from '../lib/runtime';
import { sessionId } from '../lib/session';
import { cameraInsetFor } from '../lib/shelf';
import { useAuth } from '../lib/use_auth';
import { AMBER, spacing, spotColor, spotColors, SPOT_FALLBACK, useTheme } from '../theme';

// --- Types ------------------------------------------------------------------------

type FetchFn = (origin: LatLng) => Promise<DiscoverResult>;

export interface MapHomeProps {
  /** Present when mounted in MapStack — absent in bare test renders, where no
   *  action that navigates is drawn. */
  navigation?: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
    addFocusListener?: (cb: () => void) => () => void;
  };
  // --- the seed map (injectable for tests; default = the live Supabase reads)
  loadRoutes?: (cfg: SupabaseConfig) => Promise<MapRouteRow[]>;
  loadSpots?: (
    cfg: SupabaseConfig,
    fetchImpl?: undefined,
    accessToken?: string | null,
  ) => Promise<SpotRow[]>;
  /** Photo list for a tapped user pin (the detail shows the attached pictures). */
  listPhotosFn?: typeof listSpotPhotos;
  /** The FULL row for "Follow this drive" — the map carries only the
   *  simplified line (§44 egress), which follows short of the real road. */
  fetchRouteFn?: typeof fetchRouteById;
  /** Where the user already is, for the OPENING camera only. Default =
   *  expo-location's no-prompt check. */
  knownLocation?: () => Promise<LocationResult>;
  // --- the Discover scan (injectable for tests)
  /** The prompting locate behind "Use my location"; default = expo-location. */
  locate?: () => Promise<LocationResult>;
  /** Default = POST /discover. */
  fetchDrives?: FetchFn;
  /** Default = POST /discover with v:2 (`null` disables v2 — tests pin v1). */
  fetchCores?: ((origin: LatLng) => Promise<DiscoverResultV2>) | null;
}

type RoutesPhase =
  | { phase: 'loading' }
  | { phase: 'loaded'; rows: MapRouteRow[] }
  | { phase: 'error' };

type Phase =
  | { kind: 'need_origin' }
  | { kind: 'loading' }
  | { kind: 'loaded'; result: DiscoverResult }
  /** R29 Unit A: the v2 three-leg menu — the drive + get-there + get-home. */
  | { kind: 'loaded_v2'; result: DiscoverResultV2 }
  | { kind: 'empty'; disclosures: string[] }
  | { kind: 'unavailable' }
  /** The server REJECTED the scan and said why (out of region, rate limit,
   *  engine down) — its own words, never "check your connection" (review). */
  | { kind: 'rejected'; headline: string; body: string; retryable: boolean }
  /** A transport failure — the one case where the connection IS the cause. */
  | { kind: 'error'; body: string };

type LocState = 'idle' | 'fetching' | 'denied' | 'error';

/** A tapped seed route (the map line, or an All-roads row). */
interface SeedSelection {
  title: string;
  /** MEASURED and pre-formatted, or null when the row did not carry the
   *  value — `Stat` renders nothing for null, never a "? km" placeholder (§18). */
  distance: string | null;
  duration: string | null;
  tags: string[];
  /** The seed row — present when the tapped line maps back to a loaded row,
   *  which is what makes it followable in place. */
  route?: MapRouteRow;
}

/** A tapped spot pin. */
interface SpotSelection {
  title: string;
  /** The spot's type, as a map-legend word. */
  line: string;
  spotId?: string;
  /** 'user' for a pin someone added — the only kind that can carry photos. */
  spotSource?: string;
  /** The raw DB spot type, for the legend's swatch (shared `spotColors`). */
  spotType?: string;
  /** Where the pin is — the camera eases to it. */
  point?: LatLng;
}

/** What the shelf is showing in place of its list. */
type Detail =
  | { of: 'drive'; id: string }
  | { of: 'seed'; sel: SeedSelection }
  | { of: 'spot'; sel: SpotSelection };

// --- Helpers ----------------------------------------------------------------------

/** Spots worth handing to the Add-spot nudge: a generous box around the view,
 *  not the whole region. ~2 km is far wider than NUDGE_RADIUS_M, so panning a
 *  little after opening still nudges correctly. */
function nearbySpots(all: SpotRow[], center: [number, number] | null): SpotRow[] {
  if (center === null) return all.slice(0, 500);
  const [lng, lat] = center;
  return all.filter((s) => Math.abs(s.lat - lat) < 0.02 && Math.abs(s.lng - lng) < 0.03);
}

/** A map_routes row as a followable Route. No turns are stored for seed
 *  routes, so follow-mode takes its legacy path (re-match by position). */
function routeFromMapRow(r: MapRouteRow): Route {
  return {
    geometry: r.geometry,
    is_loop: r.is_loop,
    waypoints: [],
    distance_m: r.distance_m,
    duration_s: r.duration_s,
    curviness: r.curviness,
    elevation_profile: null,
    climb_m: r.climb_m,
    highway_flag: false,
    toll_flag: false,
    ferry_flag: false,
    unpaved_flag: false,
    character_tags: r.character_tags as Route['character_tags'],
    intensity: r.intensity as Route['intensity'],
    free_tags: r.free_tags,
    visibility: r.visibility as Route['visibility'],
    owner_id: null,
    origin_type: r.origin_type as Route['origin_type'],
    forked_from: null,
    stops: [],
    name: r.name,
    maneuvers: null,
  };
}

/** Marker colours per spot type, flattened for Mapbox's `match` expression.
 *  Sourced from the ONE shared table (theme.spotColors) rather than a second
 *  hand-kept copy, which is how a `meetup` pin once drew with no colour. */
const SPOT_MATCH = Object.entries(spotColors).flat() as [string, string, ...string[]];

/** Shared empties — one identity each, so "no drives" never invalidates a memo.
 *  Never mutated (the screen only ever reads these). */
const NO_DRIVES: NearbyDrive[] = [];
const NO_CORE_DRIVES: CoreDrive[] = [];
const NO_ROWS: MapRouteRow[] = [];

/** Whole minutes → a friendly duration ("45 min" / "1 h 50 min" / "2 h"). */
function fmtDur(s: number): string {
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}

/** Curviness → an engagement WORD (Hard rule D — never speed/velocity). */
function curveWord(c: number): string {
  if (c >= 2.0) return 'Very winding';
  if (c >= 1.0) return 'Winding';
  return 'Gentle bends';
}

/**
 * A failed scan → the honest phase. The server's rejections carry their own
 * plain-words reason (backend errorBody) and a code the panel can name; only a
 * transport failure may blame the connection. Before this every non-404
 * rejection read "check your connection" with a Try again that could never
 * succeed for an out-of-region pin (review finding, 2026-09-07).
 */
export function classifyFailure(err: unknown): Phase {
  if (err instanceof DiscoverUnavailableError) return { kind: 'unavailable' };
  if (err instanceof ApiError) {
    const headline =
      err.code === 'rate_limited'
        ? 'One moment'
        : err.code === 'out_of_region'
          ? 'Outside the covered region'
          : err.status >= 500
            ? 'Couldn’t scan right now'
            : 'That scan didn’t start';
    return {
      kind: 'rejected',
      headline,
      body: err.message,
      retryable: err.code === 'rate_limited' || err.status >= 500,
    };
  }
  if (err instanceof NetworkError) {
    return {
      kind: 'error',
      body: transportMessage(
        err,
        'Couldn’t scan for drives — check your connection and try again.',
      ),
    };
  }
  // a shape the app could not read (schema skew): not the connection's fault
  return {
    kind: 'rejected',
    headline: 'Couldn’t read the scan',
    body: 'Discover returned something unexpected — try again.',
    retryable: true,
  };
}

/** The scan phase as the state table's status word. */
function scanStatus(phase: Phase): ScanStatus {
  switch (phase.kind) {
    case 'need_origin':
      return 'unset';
    case 'loading':
      return 'loading';
    case 'loaded':
    case 'loaded_v2':
      return 'loaded';
    case 'empty':
      return 'empty';
    default:
      return 'failed';
  }
}

/** The v2 card's honesty line. BD-203: both commute legs are simply the
 *  fastest route to/from the join — nothing measured whether a second road
 *  exists, so the card must not claim there is none. */
function coreHonesty(d: CoreDrive): string {
  return d.barProfile === 'cell_relaxed'
    ? `best around here · ${Math.round(d.core.backroadShare * 100)}% backroad`
    : d.sameWayHome
      ? 'same way there and back (fastest route)'
      : 'different way home';
}

/** A box around a tapped pin for the camera to ease into: ~400 m a side, so
 *  the pin lands mid-map at a zoom where the road it is on is legible. Map
 *  geometry, not paint. */
const PIN_FIT_DEG = 0.004;
function pinBounds(p: LatLng): Bounds {
  return {
    ne: [p.lng + PIN_FIT_DEG, p.lat + PIN_FIT_DEG],
    sw: [p.lng - PIN_FIT_DEG, p.lat - PIN_FIT_DEG],
  };
}

const HONESTY = {
  routesLoading: 'Loading routes…',
  routesFailed: "Couldn't load routes — the map still works. Check the connection and try again.",
  needOrigin: 'Set your start point and we’ll light up the region’s best roads within reach.',
  scanning: 'Scanning the region’s best roads within reach…',
  locationOff: 'Location is off — drop a pin with “Pick on map” instead.',
  locationFailed: 'Couldn’t get your location — drop a pin instead.',
  noStandout: 'No standout drives within reach of here — try a start closer to the hills.',
  unavailable: 'Discover isn’t available right now. Planning still works.',
} as const;

// --- The screen -----------------------------------------------------------------

export default function MapHome(props: MapHomeProps): ReactElement {
  const { colors } = useTheme();
  const topInset = useTopInset();
  const tabBarHeight = useTabBarHeight();
  const { height: windowH } = useWindowDimensions();
  const { status, freshAccessToken } = useAuth();
  const { draft, setDraft } = usePlanDraft();
  const origin = draft.origin?.point ?? null;
  const canAct = props.navigation !== undefined;

  // --- injectables ------------------------------------------------------------------
  const loadRoutes = props.loadRoutes ?? fetchMapRoutes;
  const loadSpots = props.loadSpots ?? fetchMapSpots;
  const listPhotos = props.listPhotosFn ?? listSpotPhotos;
  const loadRoute = props.fetchRouteFn ?? fetchRouteById;
  const knownLocation = props.knownLocation ?? getKnownLocation;
  const locate = props.locate ?? getCurrentLocation;
  const fetchDrives =
    props.fetchDrives ??
    ((o: LatLng) => fetchDiscoverDrives({ baseUrl: getApiBaseUrl(), sessionId }, o));
  // `null` explicitly DISABLES v2 (tests pin the v1 path with it), so this must
  // distinguish null from undefined — `??` would treat both as "use the default"
  // and send test renders to the real network.
  const fetchCores =
    props.fetchCores !== undefined
      ? props.fetchCores
      : DISCOVER_V2
        ? (o: LatLng) => fetchDiscoverCores({ baseUrl: getApiBaseUrl(), sessionId }, o)
        : null;

  // --- state -------------------------------------------------------------------------
  const [mode, setMode] = useState<HomeMode>('nearby');
  const [detail, setDetail] = useState<Detail | null>(null);
  /** The shelf's COMMITTED detent — what the camera and the attribution pad by. */
  const [committed, setCommitted] = useState<HomeDetent>('half');
  const shelf = useRef<ShelfHandle>(null);

  const [routes, setRoutes] = useState<RoutesPhase>({ phase: 'loading' });
  const [spots, setSpots] = useState<SpotRow[]>([]);
  /** Where the OS already knows the user is, used ONLY to open the camera.
   *  `getKnownLocation` checks the permission it needs and never asks for it,
   *  so arriving on this tab cannot raise a dialog. */
  const [openAt, setOpenAt] = useState<LatLng | null>(null);
  /** Photos of the opened user pin; [] while loading or when there are none
   *  (the strip simply stays hidden — a photo failure never blocks the detail). */
  const [detailPhotos, setDetailPhotos] = useState<PhotoRef[]>([]);
  /** "Follow this drive" fetches the full row first; true while it does. */
  const [opening, setOpening] = useState(false);
  /** Where the user is looking right now — handed to Add-spot so it opens on
   *  this view instead of a hard-coded city at region zoom. */
  const center = useRef<[number, number] | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: 'need_origin' });
  const [locState, setLocState] = useState<LocState>('idle');
  /** The drive whose line was tapped on the map — ringed in the list. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Bumped by "Try again" (and by refocus after a failure) so the scan
   *  re-fires for the SAME origin. */
  const [attempt, setAttempt] = useState(0);

  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // --- the state table ----------------------------------------------------------------
  const scan = scanStatus(phase);
  const state: HomeState =
    detail === null
      ? mode === 'nearby'
        ? { kind: 'browse', mode: 'nearby', scan }
        : { kind: 'browse', mode: 'allRoads' }
      : detail.of === 'drive'
        ? { kind: 'detail', of: 'drive' }
        : { kind: 'detail', of: detail.of, from: mode, scan };
  const view = homeView(state);

  const detents = useMemo(() => homeDetents(windowH, topInset), [windowH, topInset]);
  const committedH = detents[committed];

  // Entering a state opens the shelf where the table says (a detail: half,
  // with the tapped line fitted above it). A ref, not a prop: the same detent
  // is asked for again after the user dragged away from it.
  const stateKey =
    detail === null
      ? `browse:${mode}`
      : detail.of === 'drive'
        ? `drive:${detail.id}`
        : detail.of === 'seed'
          ? `seed:${detail.sel.route?.id ?? detail.sel.title}`
          : `spot:${detail.sel.spotId ?? detail.sel.title}`;
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    shelf.current?.snapTo(view.detentOnEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires on a state change only
  }, [stateKey]);

  // --- the seed map --------------------------------------------------------------------
  const pullSpots = useCallback(() => {
    void (async () => {
      try {
        // The SIGNED-IN token when we have one: map_spots is SECURITY INVOKER,
        // so the credential is what decides whether the user's OWN pins come
        // back. With the anon key they never do — you add a spot and the map
        // you added it to stays empty.
        const token = await freshAccessToken().catch(() => null);
        setSpots(await loadSpots(getSupabaseConfig(), undefined, token));
      } catch {
        // enrichment-only: a spot failure never blocks the map (§18)
      }
    })();
    // freshAccessToken is re-created on every auth change, which would re-run
    // this on every render; `status` is the meaningful trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSpots, status]);

  const loadRoutesOnly = useCallback(() => {
    setRoutes({ phase: 'loading' });
    loadRoutes(getSupabaseConfig())
      .then((rows) => setRoutes({ phase: 'loaded', rows }))
      .catch(() => setRoutes({ phase: 'error' }));
  }, [loadRoutes]);

  /** Retry: everything. */
  const load = useCallback(() => {
    loadRoutesOnly();
    pullSpots();
  }, [loadRoutesOnly, pullSpots]);

  // Routes once; spots whenever the credential changes (a sign-in reveals the
  // user's own pins) — a sign-in must not flash "Loading routes…" over lines
  // that are already there.
  useEffect(() => {
    loadRoutesOnly();
  }, [loadRoutesOnly]);
  useEffect(() => {
    pullSpots();
  }, [pullSpots]);

  /** Ask the OS — once per mount, and only if permission is ALREADY granted —
   *  where the user is, so the map opens on their roads rather than on the
   *  whole served region. Nothing else depends on the answer. */
  useEffect(() => {
    let live = true;
    void knownLocation().then((res) => {
      if (live && res.status === 'ok') setOpenAt(res.point);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  // --- the Discover scan -----------------------------------------------------------------
  const useMyLocation = useCallback(() => {
    setLocState('fetching');
    locate()
      .then((res) => {
        if (res.status === 'ok') {
          setDraft({ origin: { source: 'current', point: res.point } });
          setLocState('idle');
        } else {
          setLocState(res.status === 'denied' ? 'denied' : 'error');
        }
      })
      .catch(() => setLocState('error'));
  }, [locate, setDraft]);

  // fetch the menu whenever the origin is (re)set
  useEffect(() => {
    if (!origin) {
      setPhase({ kind: 'need_origin' });
      return;
    }
    let live = true;
    setPhase({ kind: 'loading' });
    setSelectedId(null);
    // A drive detail belongs to the menu that is being replaced.
    setDetail((d) => (d?.of === 'drive' ? null : d));
    const loadV1 = (): Promise<void> =>
      fetchDrives(origin).then((result) => {
        if (!live) return;
        setPhase(
          result.drives.length === 0
            ? { kind: 'empty', disclosures: result.disclosures }
            : { kind: 'loaded', result },
        );
      });
    // R29 Unit A: v2 (drive + get-there + get-home) is the product. U12c
    // (BD-180): an empty measured menu no longer silently loads v1
    // out-and-backs — the server's honest state says what is actually true of
    // the area, instead of a lower-quality lookalike wearing the same UI
    // (Recovery §15).
    const run = fetchCores
      ? fetchCores(origin).then((result) => {
          if (!live) return;
          if (result.drives.length === 0) {
            if (DISCOVER_V1_FALLBACK) return loadV1();
            setPhase({ kind: 'empty', disclosures: result.disclosures });
            return;
          }
          setPhase({ kind: 'loaded_v2', result });
        })
      : loadV1();
    run.catch((err: unknown) => {
      if (!live) return;
      setPhase(classifyFailure(err));
    });
    return () => {
      live = false;
    };
  }, [origin?.lat, origin?.lng, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back to the tab after a failed scan retries it — unless the server
  // said the request itself can never succeed (out of region).
  const retryable =
    phase.kind === 'error' ||
    phase.kind === 'unavailable' ||
    (phase.kind === 'rejected' && phase.retryable);

  // On focus (M10 / R24): re-pull pins so a just-added one is visible and a
  // deleted one's detail does not linger (§18); retry a retryable scan.
  useEffect(() => {
    const off = props.navigation?.addFocusListener?.(() => {
      pullSpots();
      setDetail((d) => (d?.of === 'spot' ? null : d));
      if (retryable) setAttempt((a) => a + 1);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullSpots, retryable]);

  // The opened pin's photos. Only a USER pin can have any, and the photo list
  // is owner-readable, so it is asked for only with a signed-in token; a
  // signed-out tap on someone's pin shows the detail without a strip. Re-keyed
  // by id so a stale list never sits under a new name.
  const detailSpotId = detail?.of === 'spot' ? detail.sel.spotId : undefined;
  const detailSpotSource = detail?.of === 'spot' ? detail.sel.spotSource : undefined;
  useEffect(() => {
    setDetailPhotos((p) => (p.length === 0 ? p : [])); // same reference → no extra render
    if (detailSpotId === undefined || detailSpotSource !== 'user') return;
    if (status !== 'signedIn') return;
    let live = true;
    void (async () => {
      try {
        const token = await freshAccessToken();
        if (!token || !live) return;
        const photos = await listPhotos(
          { baseUrl: getApiBaseUrl(), accessToken: token },
          detailSpotId,
        );
        if (live) setDetailPhotos(photos);
      } catch {
        // enrichment-only: the detail stays useful without its pictures (§18)
      }
    })();
    return () => {
      live = false;
    };
    // freshAccessToken is re-created on every auth change; `status` is the
    // meaningful trigger (same reasoning as pullSpots).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailSpotId, detailSpotSource, status, listPhotos]);

  // --- the data on the map ----------------------------------------------------------------
  const rows = routes.phase === 'loaded' ? routes.rows : NO_ROWS;
  /** The loaded rows, readable from the stable tap handler below. */
  const rowsRef = useRef<MapRouteRow[]>(NO_ROWS);
  rowsRef.current = rows;

  const routeShape = useMemo(
    () => (routes.phase === 'loaded' ? routesToFeatureCollection(routes.rows) : null),
    [routes],
  );
  const regionFit = useMemo(
    () => (routes.phase === 'loaded' ? routesBounds(routes.rows) : null),
    [routes],
  );
  const spotShape = useMemo(() => spotsToFeatureCollection(spots), [spots]);

  // Memoized on `phase` so the two lists keep a stable identity between renders:
  // a fresh `[]` each render re-ran the map's FeatureCollection/bounds memos and
  // handed ShapeSource a new shape every time.
  const drives = useMemo(
    () => (phase.kind === 'loaded' ? phase.result.drives : NO_DRIVES),
    [phase],
  );
  const coreDrives = useMemo(
    () => (phase.kind === 'loaded_v2' ? phase.result.drives : NO_CORE_DRIVES),
    [phase],
  );
  const scanShape = useMemo(
    () =>
      coreDrives.length > 0
        ? coreDrivesToFeatureCollection(coreDrives)
        : discoverDrivesToFeatureCollection(drives),
    [drives, coreDrives],
  );
  const scanBounds = useMemo(
    () => (coreDrives.length > 0 ? coreDrivesBounds(coreDrives) : drivesBounds(drives)),
    [drives, coreDrives],
  );

  /**
   * The opening camera. An origin the user CHOSE outranks the OS's own fix —
   * if they pinned a start two towns over, that is the map they mean to be
   * looking at, even while the menu for it is still being built.
   */
  const openingPoint = origin ?? openAt;
  const openingCenter = useMemo(
    () => (openingPoint ? { point: openingPoint } : null),
    [openingPoint],
  );

  /** The one drive a detail is about, when the menu still has it. */
  const detailCore =
    detail?.of === 'drive' ? coreDrives.find((d) => d.id === detail.id) : undefined;
  const detailDrive =
    detail?.of === 'drive' && detailCore === undefined
      ? drives.find((d) => d.segmentId === detail.id)
      : undefined;
  const detailSpotPoint = detail?.of === 'spot' ? detail.sel.point : undefined;
  const detailSeedRoute = detail?.of === 'seed' ? detail.sel.route : undefined;

  /**
   * What the camera fits, by the state table. `regionFit` is every seeded
   * route at once — the whole served region: correct as the never-empty
   * anonymous view (FR-010), useless as a place to start looking for a road
   * to drive — so when the map knows where to open it hands the camera no fit
   * and lets the opening centre win. The region stays the fallback, still
   * derived from DATA rather than a hard-coded bbox (§46).
   */
  const bounds = useMemo((): Bounds | null => {
    const layerFit = view.mapLayer === 'scan' ? scanBounds : openingPoint ? null : regionFit;
    if (view.camera === 'one') {
      if (detailCore) return coreDrivesBounds([detailCore]);
      if (detailDrive) return drivesBounds([detailDrive]);
      if (detailSeedRoute) return routesBounds([detailSeedRoute]);
      return layerFit;
    }
    if (view.camera === 'pin') {
      // No coordinate for the pin (a feature without geometry): the camera
      // holds — the same fit as before the tap is not a re-fit.
      return detailSpotPoint ? pinBounds(detailSpotPoint) : layerFit;
    }
    return layerFit;
  }, [
    view.mapLayer,
    view.camera,
    scanBounds,
    openingPoint,
    regionFit,
    detailCore,
    detailDrive,
    detailSeedRoute,
    detailSpotPoint,
  ]);

  /**
   * What this screen's chrome covers, so the fitted lines land in the map the
   * user can actually see: the control column up top, the shelf's COMMITTED
   * detent (plus the tab bar it sits on) below. Committed, never in flight —
   * a free drag never re-fits; a commit re-pads the same fit without a flight.
   * Floored at the component's own defaults, so nothing can ever fit tighter
   * than the map did before this chrome existed.
   */
  const cameraInsets = useMemo(
    () => ({
      top: Math.max(DEFAULT_CAMERA_INSETS.top, topInset + FULL_DETENT_CLEARANCE),
      bottom: Math.max(DEFAULT_CAMERA_INSETS.bottom, tabBarHeight + cameraInsetFor(committedH)),
    }),
    [topInset, tabBarHeight, committedH],
  );

  // --- taps ---------------------------------------------------------------------------
  const layerRef = useRef(view.mapLayer);
  layerRef.current = view.mapLayer;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  /** A seed row as its detail. */
  const seedSelection = useCallback((row: MapRouteRow): SeedSelection => {
    return {
      title: row.name,
      distance: `${(row.distance_m / 1000).toFixed(1)} km`,
      duration: `≈${Math.round(row.duration_s / 60)} min`,
      tags: [...(row.is_loop ? ['loop'] : []), ...row.character_tags],
      route: row,
    };
  }, []);

  const onSelectLine = useCallback(
    (p: Record<string, unknown>) => {
      if (typeof p.id !== 'string') return;
      if (layerRef.current === 'scan') {
        setSelectedId(p.id);
        setDetail({ of: 'drive', id: p.id });
        return;
      }
      const name = typeof p.name === 'string' ? p.name : undefined;
      if (!name) return;
      setSelectedId(p.id);
      const row = rowsRef.current.find((r) => r.id === p.id);
      setDetail({
        of: 'seed',
        sel: row
          ? seedSelection(row)
          : {
              title: name,
              distance:
                typeof p.distance_m === 'number' ? `${(p.distance_m / 1000).toFixed(1)} km` : null,
              duration:
                typeof p.duration_s === 'number' ? `≈${Math.round(p.duration_s / 60)} min` : null,
              tags: [
                ...(p.is_loop ? ['loop'] : []),
                ...(Array.isArray(p.character_tags) ? (p.character_tags as string[]) : []),
              ],
            },
      });
    },
    [seedSelection],
  );

  const onSpotPress = useCallback(
    (e: { features: Array<{ properties?: unknown; geometry?: unknown }> }) => {
      const f = e.features[0];
      const p = f?.properties as
        | { id?: string; name?: string; type?: string; source?: string; point_count?: number }
        | undefined;
      if (!p || p.point_count !== undefined) return; // cluster taps: zoom gesture instead
      const g = f?.geometry as { type?: string; coordinates?: unknown } | undefined;
      const c = g?.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : null;
      const point =
        c && typeof c[0] === 'number' && typeof c[1] === 'number'
          ? { lng: c[0], lat: c[1] }
          : undefined;
      setDetail({
        of: 'spot',
        sel: {
          title: p.name || 'Unnamed spot',
          line: (p.type ?? '').replace('_', ' '),
          ...(typeof p.id === 'string' ? { spotId: p.id } : {}),
          ...(typeof p.source === 'string' ? { spotSource: p.source } : {}),
          ...(typeof p.type === 'string' ? { spotType: p.type } : {}),
          ...(point ? { point } : {}),
        },
      });
    },
    [],
  );

  // Memoised as an ELEMENT: rnmapbox's ShapeSource is a PureComponent that
  // JSON.stringifies its `shape` on every render, and a fresh children array
  // defeats its shallow compare — so every detail open/close re-serialised the
  // ~21k-feature collection on the JS thread (review finding). With the same
  // element identity React skips the subtree entirely. `colors` is a stable
  // per-theme object, so it is a safe dependency.
  const spotLayers = useMemo(
    () =>
      spotShape.features.length > 0 ? (
        <ShapeSource
          id="spots"
          shape={spotShape}
          cluster
          clusterRadius={45}
          clusterMaxZoomLevel={14}
          onPress={onSpotPress}
        >
          <CircleLayer
            id="spot-clusters"
            filter={['has', 'point_count']}
            style={{
              circleColor: colors.surface,
              circleRadius: 16,
              circleStrokeColor: AMBER,
              circleStrokeWidth: 2,
            }}
          />
          <SymbolLayer
            id="spot-cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count_abbreviated'],
              textSize: 12,
              textColor: colors.text,
            }}
          />
          <CircleLayer
            id="spot-pin"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: ['match', ['get', 'type'], ...SPOT_MATCH, SPOT_FALLBACK],
              circleRadius: 9,
              circleStrokeColor: colors.bg,
              circleStrokeWidth: 2,
            }}
          />
          <SymbolLayer
            id="spot-pin-label"
            filter={['!', ['has', 'point_count']]}
            style={{
              textField: ['get', 'label'],
              textSize: 10,
              textColor: '#ffffff',
              textAllowOverlap: true,
            }}
          />
        </ShapeSource>
      ) : null,
    [spotShape, colors, onSpotPress],
  );

  // --- actions --------------------------------------------------------------------------
  /** Launch a drive: instant Result with the pre-built route, else /plan flow. */
  const go = useCallback(
    (drive: NearbyDrive) => {
      const route = nearbyDriveToRoute(drive);
      if (route) {
        props.navigation?.navigate('Result', { route });
      } else if (origin) {
        props.navigation?.navigate('Progress', {
          request: buildDiscoverPlanRequest(drive, origin),
        });
      }
    },
    [origin, props.navigation],
  );

  /** R29: a v2 tap opens Result with the three legs concatenated into one
   *  Route whose `legs` field carries the measured split — RouteDetail's
   *  three-leg bar renders it without any screen surgery. */
  const goCore = useCallback(
    (d: CoreDrive) => {
      props.navigation?.navigate('Result', { route: coreDriveToRoute(d) });
    },
    [props.navigation],
  );

  /** Follow a seed drive: with its FULL geometry + turns when the row can be
   *  read (the map line is the simplified copy), else the map line as before —
   *  an enrichment that fails must not dead-end the button. */
  const openFollow = (row: MapRouteRow): void => {
    if (opening) return;
    setOpening(true);
    void (async () => {
      let route: Route = routeFromMapRow(row);
      try {
        const token = await freshAccessToken().catch(() => null);
        const full = await loadRoute(getSupabaseConfig(), row.id, token);
        if (full) route = { ...full, name: full.name ?? row.name };
      } catch {
        // the simplified line still follows
      }
      if (!alive.current) return;
      setOpening(false);
      props.navigation?.navigate('Follow', { route });
    })();
  };

  const onMode = useCallback((next: HomeMode) => {
    setMode(next);
    setDetail(null);
    setSelectedId(null);
  }, []);

  /** Back from a detail: the browse state the table names. */
  const leaveDetail = useCallback(() => {
    const to = view.leavesTo;
    if (to && to.kind === 'browse') setMode(to.mode);
    setDetail(null);
  }, [view.leavesTo]);

  const onDetent = useCallback((key: HomeDetent) => setCommitted(key), []);

  // --- the shelf's contents ---------------------------------------------------------------
  const menuDisclosures =
    phase.kind === 'loaded_v2' || phase.kind === 'loaded' ? phase.result.disclosures : [];

  const items = useMemo((): HomeShelfItem[] => {
    if (mode === 'allRoads') {
      return rows.map((r) => ({
        id: r.id,
        kicker: { color: AMBER, label: r.is_loop ? 'Loop' : 'A → B' },
        name: r.name,
        stats: [
          { value: `${(r.distance_m / 1000).toFixed(1)} km`, label: 'distance' },
          { value: `≈${Math.round(r.duration_s / 60)} min`, label: 'duration' },
        ],
        tags: r.character_tags,
        trailing: 'open',
        accessibilityLabel: r.name,
        onPress: () => {
          setSelectedId(r.id);
          setDetail({ of: 'seed', sel: seedSelection(r) });
        },
      }));
    }
    if (coreDrives.length > 0) {
      return coreDrives.map((d) => ({
        id: d.id,
        kicker: { color: AMBER, label: curveWord(d.core.curviness) },
        name: d.name,
        stats: [{ value: `${Math.round(d.core.duration_s / 60)} min`, label: 'the drive' }],
        legs: {
          there: d.connectorOut.duration_s,
          drive: d.core.duration_s,
          home: d.connectorHome.duration_s,
        },
        figures: coreTripLabel(d),
        footnote: coreHonesty(d),
        trailing: 'go',
        accessibilityLabel: `Let's go — ${d.name}`,
        onPress: () => goCore(d),
      }));
    }
    return drives.map((d) => ({
      id: d.segmentId,
      kicker: { color: AMBER, label: curveWord(d.curviness) },
      ...(d.source === 'classic' ? { badge: 'Classic' } : {}),
      name: d.name,
      stats: [{ value: fmtDur(driveDurationS(d)), label: 'the drive' }],
      footnote: `~${Math.round(d.driveTimeToStartS / 60)} min to the start${
        d.urbanShare < 0.15 ? ' · quiet & rural' : ''
      }`,
      trailing: 'go',
      accessibilityLabel: `Let's go — ${d.name}`,
      onPress: () => go(d),
    }));
  }, [mode, rows, coreDrives, drives, seedSelection, goCore, go]);

  const count =
    mode === 'allRoads'
      ? rows.length > 0
        ? `${rows.length} ${rows.length === 1 ? 'road' : 'roads'}`
        : null
      : items.length > 0
        ? `${items.length} ${items.length === 1 ? 'drive' : 'drives'}`
        : null;

  // The status rows — all of both screens' §18 states, inside the shelf.
  const notes: HomeShelfNote[] = [];
  const seedsOnMap = view.mapLayer === 'seeds';
  if (seedsOnMap && routes.phase === 'loading' && (mode === 'allRoads' || scan === 'unset')) {
    notes.push({
      key: 'routes-loading',
      symbol: 'busy',
      tone: 'muted',
      text: HONESTY.routesLoading,
    });
  }
  if (seedsOnMap && routes.phase === 'error') {
    notes.push({
      key: 'routes-failed',
      symbol: 'wifiSlash',
      tone: 'danger',
      text: HONESTY.routesFailed,
    });
  }
  if (mode === 'nearby') {
    if (locState === 'denied') {
      notes.push({
        key: 'loc-denied',
        symbol: 'locationSlash',
        tone: 'notice',
        text: HONESTY.locationOff,
      });
    }
    if (locState === 'error') {
      notes.push({
        key: 'loc-error',
        symbol: 'locationSlash',
        tone: 'notice',
        text: HONESTY.locationFailed,
      });
    }
    switch (phase.kind) {
      case 'need_origin':
        notes.push({
          key: 'need-origin',
          symbol: 'infoCircle',
          tone: 'muted',
          text: HONESTY.needOrigin,
        });
        break;
      case 'loading':
        notes.push({ key: 'scanning', symbol: 'busy', tone: 'muted', text: HONESTY.scanning });
        break;
      case 'empty':
        // BD-203: EVERY disclosure, not just the first — the server leads
        // with the empty-state line and follows with the honest counts.
        notes.push({
          key: 'empty',
          symbol: 'infoCircle',
          tone: 'notice',
          text: phase.disclosures.length > 0 ? phase.disclosures.join(' ') : HONESTY.noStandout,
        });
        break;
      case 'unavailable':
        notes.push({
          key: 'unavailable',
          symbol: 'infoCircle',
          tone: 'notice',
          text: HONESTY.unavailable,
        });
        break;
      case 'rejected':
        notes.push({
          key: 'rejected',
          symbol: 'exclamationmarkTriangle',
          tone: 'danger',
          headline: phase.headline,
          text: phase.body,
        });
        break;
      case 'error':
        notes.push({ key: 'transport', symbol: 'wifiSlash', tone: 'danger', text: phase.body });
        break;
      default:
        break;
    }
  }

  /** The one control under the notes: the scan's Try again where it applies,
   *  else the seed map's Retry. */
  const action: HomeShelfAction | null =
    mode === 'nearby' && retryable
      ? {
          title: 'Try again',
          accessibilityLabel: 'Retry scanning',
          onPress: () => setAttempt((a) => a + 1),
        }
      : seedsOnMap && routes.phase === 'error'
        ? { title: 'Retry', onPress: load }
        : null;

  const listHeader =
    mode === 'nearby' ? (
      <View style={styles.listHeader}>
        <Text variant="headline">Great drives near you</Text>
        <View style={styles.originRow}>
          <Button
            title={
              locState === 'fetching' ? 'Locating…' : origin ? 'Update location' : 'Use my location'
            }
            variant="secondary"
            onPress={useMyLocation}
            style={styles.flex}
          />
          <Button
            title="Pick on map"
            variant="secondary"
            onPress={() => props.navigation?.navigate('PickPoint', { target: 'origin' })}
            style={styles.flex}
          />
        </View>
      </View>
    ) : null;

  // BD-203: a non-empty menu's disclosures ("2 more were mostly getting-there
  // — not shown", the same-way-back note) sit under the list, all of them.
  const listFooter =
    mode === 'nearby' && menuDisclosures.length > 0 ? (
      <Text variant="footnote" tone="muted" style={styles.listFooter}>
        {menuDisclosures.join(' ')}
      </Text>
    ) : null;

  /** The menu's identity — the list container fades in once when it lands. */
  const listKey = `${mode}:${phase.kind}:${routes.phase}`;

  const backLabel = mode === 'nearby' ? 'All drives' : 'All roads';
  const detailSpec = useMemo((): HomeShelfDetail | null => {
    if (detail === null) return null;
    if (detail.of === 'drive') {
      if (detailCore) {
        return {
          key: detailCore.id,
          backLabel,
          onBack: leaveDetail,
          kicker: { color: AMBER, label: curveWord(detailCore.core.curviness) },
          name: detailCore.name,
          stats: [
            { value: `${Math.round(detailCore.core.duration_s / 60)} min`, label: 'the drive' },
          ],
          legs: {
            there: detailCore.connectorOut.duration_s,
            drive: detailCore.core.duration_s,
            home: detailCore.connectorHome.duration_s,
          },
          figures: coreTripLabel(detailCore),
          footnote: coreHonesty(detailCore),
          action: canAct
            ? {
                title: 'Let’s go',
                accessibilityLabel: `Let's go — ${detailCore.name}`,
                onPress: () => goCore(detailCore),
              }
            : null,
        };
      }
      if (detailDrive) {
        return {
          key: detailDrive.segmentId,
          backLabel,
          onBack: leaveDetail,
          kicker: { color: AMBER, label: curveWord(detailDrive.curviness) },
          ...(detailDrive.source === 'classic' ? { badge: 'Classic' } : {}),
          name: detailDrive.name,
          stats: [{ value: fmtDur(driveDurationS(detailDrive)), label: 'the drive' }],
          footnote: `~${Math.round(detailDrive.driveTimeToStartS / 60)} min to the start${
            detailDrive.urbanShare < 0.15 ? ' · quiet & rural' : ''
          }`,
          action: canAct
            ? {
                title: 'Let’s go',
                accessibilityLabel: `Let's go — ${detailDrive.name}`,
                onPress: () => go(detailDrive),
              }
            : null,
        };
      }
      return null; // the menu no longer has it
    }
    if (detail.of === 'seed') {
      const s = detail.sel;
      const row = s.route;
      return {
        key: row?.id ?? s.title,
        backLabel,
        onBack: leaveDetail,
        kicker: {
          color: AMBER,
          label: row ? curveWord(row.curviness) : s.tags.includes('loop') ? 'Loop' : 'A → B',
        },
        name: s.title,
        stats: [
          { value: s.distance, label: 'distance' },
          { value: s.duration, label: 'duration' },
        ],
        tags: s.tags,
        action:
          row !== undefined && canAct
            ? {
                title: opening ? 'Opening…' : 'Follow this drive',
                accessibilityLabel: 'Follow this drive',
                disabled: opening,
                onPress: () => openFollow(row),
              }
            : null,
      };
    }
    const s = detail.sel;
    return {
      key: s.spotId ?? s.title,
      backLabel,
      onBack: leaveDetail,
      ...(s.line !== '' ? { kicker: { color: spotColor(s.spotType ?? ''), label: s.line } } : {}),
      name: s.title,
      photos: detailPhotos,
      action:
        s.spotId !== undefined && canAct
          ? {
              title: 'Details',
              accessibilityLabel: 'Spot details',
              variant: 'secondary',
              onPress: () => props.navigation?.navigate('Spot', { id: s.spotId, name: s.title }),
            }
          : null,
    };
    // openFollow is rebuilt per render on purpose (it reads `opening`); the
    // detail is keyed by everything it draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    detail,
    detailCore,
    detailDrive,
    detailPhotos,
    backLabel,
    leaveDetail,
    canAct,
    goCore,
    go,
    opening,
  ]);

  // --- the chrome over the map ---------------------------------------------------------------
  /** The bottom edge of the control column: two 44 pt circles and the gap
   *  between them, under the top inset. The SDK compass is pushed below it so
   *  the two never stack in the same corner (SPEC MapHome item 2). */
  const controlColumnBottom = topInset + spacing.md + CONTROL_PILL * 2 + spacing.sm * 2;

  const overlay = (
    <>
      <StatusScrim />
      <View pointerEvents="box-none" style={[styles.controls, { top: topInset + spacing.md }]}>
        {canAct && (
          <PressableScale
            accessibilityLabel="Add a spot"
            onPress={() =>
              props.navigation!.navigate('AddSpot', {
                // Only what the FR-033 nudge can use. All ~21k rows through
                // navigation state stalls the push and keeps them alive for
                // the life of the stack.
                knownSpots: nearbySpots(spots, center.current),
                ...(center.current ? { startAt: center.current } : {}),
              })
            }
          >
            <Material role="pill" style={styles.pill}>
              <Symbol name="plus" size="lg" />
            </Material>
          </PressableScale>
        )}
        <PressableScale accessibilityLabel="Use my location" onPress={useMyLocation}>
          <Material role="pill" style={styles.pill}>
            <Symbol
              name={draft.origin?.source === 'current' ? 'locationFill' : 'location'}
              size="lg"
            />
          </Material>
        </PressableScale>
      </View>
    </>
  );

  const scanOnMap = view.mapLayer === 'scan';

  return (
    <DriveLinesMap
      featureCollection={scanOnMap ? scanShape : routeShape}
      perLeg={scanOnMap && coreDrives.length > 0}
      sourceId={scanOnMap ? 'discover-drives' : 'seed-routes'}
      bounds={bounds}
      center={openingCenter}
      cameraInsets={cameraInsets}
      attributionOffset={tabBarHeight + committedH}
      compassOffset={controlColumnBottom}
      onSelectLine={onSelectLine}
      onCenterChanged={(c) => {
        center.current = c;
      }}
      banner={overlay}
      sheet={
        <HomeShelf
          ref={shelf}
          detents={detents}
          initial={view.detentOnEntry}
          onDetent={onDetent}
          bottom={tabBarHeight}
          mode={mode}
          onMode={onMode}
          count={count}
          notes={notes}
          action={action}
          list={{ key: listKey, items, selectedId, header: listHeader, footer: listFooter }}
          detail={detailSpec}
          testID="home-shelf"
        />
      }
    >
      {spotLayers}
    </DriveLinesMap>
  );
}

/** The control column's circles — the `Material role="pill"` size. */
const CONTROL_PILL = 44;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  controls: {
    position: 'absolute',
    right: spacing.gutter,
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  pill: { width: CONTROL_PILL, height: CONTROL_PILL },
  listHeader: { gap: spacing.md, paddingBottom: spacing.xs },
  originRow: { flexDirection: 'row', gap: spacing.sm },
  listFooter: { paddingTop: spacing.xs },
});
