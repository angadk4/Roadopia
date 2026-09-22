/**
 * The merged home's state table, pinned without a device (redesign — SPEC
 * "Test changes": `lib/__tests__/home_states.test.ts` (new) — "every home
 * state → detent, layer, exits").
 *
 * What a node test can hold: which lines are on the map in every state (the
 * never-empty map, FR-010), where the shelf opens on entry, what the camera
 * fits, and what "back" returns to. How the shelf FEELS getting there is the
 * device pass.
 */

import { describe, expect, it } from 'vitest';

import {
  COLLAPSED_DETENT_H,
  FULL_DETENT_CLEARANCE,
  HALF_DETENT_FRACTION,
  homeDetents,
  homeView,
  type HomeState,
  type ScanStatus,
} from '../home_states';

const SCANS: readonly ScanStatus[] = ['unset', 'loading', 'loaded', 'empty', 'failed'];

describe('homeView — browse', () => {
  it('Near you shows the SEEDS until a menu has loaded, then the scan (the never-empty map)', () => {
    for (const scan of SCANS) {
      const view = homeView({ kind: 'browse', mode: 'nearby', scan });
      expect(view.mapLayer).toBe(scan === 'loaded' ? 'scan' : 'seeds');
      expect(view.camera).toBe('layer');
      expect(view.detentOnEntry).toBe('half');
      expect(view.leavesTo).toBeNull(); // a root: nothing to go back to
    }
  });

  it('All roads is the seed map at half, a root', () => {
    expect(homeView({ kind: 'browse', mode: 'allRoads' })).toEqual({
      detentOnEntry: 'half',
      mapLayer: 'seeds',
      camera: 'layer',
      leavesTo: null,
    });
  });
});

describe('homeView — detail', () => {
  it('a Discover drive keeps the scan on the map, fits the one drive, and leaves to the loaded menu', () => {
    expect(homeView({ kind: 'detail', of: 'drive' })).toEqual({
      detentOnEntry: 'half',
      mapLayer: 'scan',
      camera: 'one',
      leavesTo: { kind: 'browse', mode: 'nearby', scan: 'loaded' },
    });
  });

  it('a seed route fits the one line over the seeds and leaves to the mode it came from', () => {
    const fromRoads = homeView({ kind: 'detail', of: 'seed', from: 'allRoads', scan: 'unset' });
    expect(fromRoads.mapLayer).toBe('seeds');
    expect(fromRoads.camera).toBe('one');
    expect(fromRoads.detentOnEntry).toBe('half');
    expect(fromRoads.leavesTo).toEqual({ kind: 'browse', mode: 'allRoads' });

    // Opened from Near you while the scan had nothing on the map yet: back is
    // the same Near-you state, scan status intact.
    const fromNearby = homeView({ kind: 'detail', of: 'seed', from: 'nearby', scan: 'empty' });
    expect(fromNearby.leavesTo).toEqual({ kind: 'browse', mode: 'nearby', scan: 'empty' });
  });

  it('a spot eases the camera to the pin and keeps whatever lines the browse mode had', () => {
    const overScan = homeView({ kind: 'detail', of: 'spot', from: 'nearby', scan: 'loaded' });
    expect(overScan.camera).toBe('pin');
    expect(overScan.mapLayer).toBe('scan');
    expect(overScan.leavesTo).toEqual({ kind: 'browse', mode: 'nearby', scan: 'loaded' });

    const overSeeds = homeView({ kind: 'detail', of: 'spot', from: 'allRoads', scan: 'loaded' });
    expect(overSeeds.mapLayer).toBe('seeds');
    expect(overSeeds.leavesTo).toEqual({ kind: 'browse', mode: 'allRoads' });
  });

  it('every state opens the shelf at half (SPEC: half on entry, everywhere)', () => {
    const states: HomeState[] = [
      { kind: 'browse', mode: 'nearby', scan: 'unset' },
      { kind: 'browse', mode: 'allRoads' },
      { kind: 'detail', of: 'drive' },
      { kind: 'detail', of: 'seed', from: 'nearby', scan: 'loaded' },
      { kind: 'detail', of: 'spot', from: 'allRoads', scan: 'unset' },
    ];
    for (const s of states) expect(homeView(s).detentOnEntry).toBe('half');
  });

  it('back from a detail always lands on a browse state, never on another detail', () => {
    const details: HomeState[] = [
      { kind: 'detail', of: 'drive' },
      { kind: 'detail', of: 'seed', from: 'nearby', scan: 'failed' },
      { kind: 'detail', of: 'spot', from: 'nearby', scan: 'loading' },
    ];
    for (const d of details) {
      const back = homeView(d).leavesTo;
      expect(back?.kind).toBe('browse');
      expect(homeView(back!).leavesTo).toBeNull();
    }
  });
});

describe('homeDetents', () => {
  it('collapsed 132 · half 48 % of the window · full = window − (topInset + 56)', () => {
    const d = homeDetents(852, 59); // iPhone 14 Pro, Dynamic Island inset
    expect(d.collapsed).toBe(COLLAPSED_DETENT_H);
    expect(d.half).toBe(Math.round(852 * HALF_DETENT_FRACTION));
    expect(d.full).toBe(852 - (59 + FULL_DETENT_CLEARANCE));
    expect(d.collapsed).toBeLessThan(d.half);
    expect(d.half).toBeLessThan(d.full);
  });

  it('never lets full fall under collapsed on a tiny window (the detents stay ordered)', () => {
    const d = homeDetents(120, 40);
    expect(d.full).toBeGreaterThanOrEqual(d.collapsed);
  });
});
