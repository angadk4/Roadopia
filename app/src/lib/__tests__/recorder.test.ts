import type { RouteThroughOutput } from '@shared/types';
import { describe, expect, it } from 'vitest';

import {
  ACCURACY_MAX_M,
  addFix,
  canMatch,
  elapsedS,
  IDLE_RECORDER,
  MAX_POINTS,
  MIN_SPACING_M,
  rawDistanceM,
  startRecording,
  stopRecording,
  toRecordedRoute,
} from '../recorder';

/** M9-T03..T05 — the pure recorder machine (FR-060..062). */

const MATCHED = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-79.9, 43.2],
      [-79.85, 43.25],
    ],
  },
  distance_m: 12_000,
  duration_s: 700, // the ENGINE's estimate — must NOT become the saved time
  legs: [],
  maneuvers: [],
  has_highway: false,
  has_toll: false,
  has_ferry: false,
  has_unpaved: true,
} as unknown as RouteThroughOutput;

/** ~11 m of latitude per step at these magnitudes. */
const STEP = 0.0001;

function drive(n: number, t0 = 0): ReturnType<typeof startRecording> {
  let s = startRecording(t0);
  for (let i = 0; i < n; i++) {
    s = addFix(s, { lat: 43.2 + i * STEP, lng: -79.9, accuracyM: 10 });
  }
  return s;
}

describe('recorder gates', () => {
  it('drops bad-accuracy and too-close fixes, counting them honestly', () => {
    let s = startRecording(0);
    s = addFix(s, { lat: 43.2, lng: -79.9, accuracyM: 10 });
    s = addFix(s, { lat: 43.2, lng: -79.9, accuracyM: ACCURACY_MAX_M + 1 }); // noisy
    s = addFix(s, { lat: 43.2 + 0.00001, lng: -79.9, accuracyM: 10 }); // ~1 m < MIN_SPACING_M
    expect(s.points).toHaveLength(1);
    expect(s.droppedFixes).toBe(2);
    expect(MIN_SPACING_M).toBeLessThanOrEqual(ACCURACY_MAX_M);
  });

  it('ignores fixes when not recording and caps the buffer', () => {
    expect(addFix(IDLE_RECORDER, { lat: 43, lng: -79, accuracyM: 5 }).points).toHaveLength(0);
    let s = drive(3);
    (s as { points: unknown[] }).points = new Array(MAX_POINTS).fill({ lat: 43.2, lng: -79.9 });
    const before = s.points.length;
    s = addFix(s, { lat: 44, lng: -79, accuracyM: 5 });
    expect(s.points.length).toBe(before);
  });

  it('elapsed uses real wall time and freezes at stop', () => {
    let s = drive(5, 1_000);
    expect(elapsedS(s, 61_000)).toBe(60);
    s = stopRecording(s, 121_000);
    expect(elapsedS(s, 999_999)).toBe(120);
  });
});

describe('canMatch', () => {
  it('a parking-lot shuffle is not a drive', () => {
    expect(canMatch(drive(5))).toBe(false); // few points, short
    expect(canMatch(drive(60))).toBe(true); // 60 × ~11 m ≈ 660 m
    expect(rawDistanceM(drive(60))).toBeGreaterThan(500);
  });
});

describe('toRecordedRoute', () => {
  it('keeps the REAL recorded time, not the engine estimate', () => {
    let s = drive(60, 0);
    s = stopRecording(s, 30 * 60 * 1000); // 30 real minutes
    const r = toRecordedRoute(MATCHED, s);
    expect(r.duration_s).toBe(1800);
    expect(r.duration_s).not.toBe(MATCHED.duration_s);
  });

  it('is honest: recorded origin, private, no AI provenance, snap flags kept', () => {
    let s = drive(60);
    s = stopRecording(s, 60_000);
    const r = toRecordedRoute(MATCHED, s);
    expect(r.origin_type).toBe('recorded');
    expect(r.visibility).toBe('private');
    expect(r.generation_request_id).toBeNull();
    expect(r.unpaved_flag).toBe(true);
    expect(r.is_loop).toBe(false); // an out-and-along line, ends far apart
  });
});
