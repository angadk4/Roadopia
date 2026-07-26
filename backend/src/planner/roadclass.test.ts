import type { LineString } from '@shared/types';
import { describe, expect, it } from 'vitest';

import type { TraceEdge } from '../valhalla/trace';

import { classRunsOf, classRunStatsOf, maxClassRunInfo } from './residential';
import {
  BACKROAD_CLASSES,
  bucketOf,
  classMixOf,
  cleanDriveVerdict,
  turnsPer10minOf,
} from './roadclass';

const edge = (roadClass: string, lengthM: number, use?: string): TraceEdge => ({
  roadClass,
  lengthM,
  ...(use !== undefined ? { use } : {}),
});

describe('bucketOf (R25-U0 — audit-v11 convention)', () => {
  it('buckets the trace vocabulary the way the audit did', () => {
    expect(bucketOf(edge('motorway', 100))).toBe('highway');
    expect(bucketOf(edge('trunk', 100))).toBe('highway'); // Hwy 10/26/89 ARE highways
    expect(bucketOf(edge('primary', 100))).toBe('main');
    expect(bucketOf(edge('secondary', 100))).toBe('main');
    expect(bucketOf(edge('tertiary', 100))).toBe('backroad');
    expect(bucketOf(edge('unclassified', 100))).toBe('backroad');
    expect(bucketOf(edge('residential', 100))).toBe('hood');
    expect(bucketOf(edge('service_other', 100))).toBe('hood');
  });

  it('ramps/turn channels count as highway regardless of parent class', () => {
    expect(bucketOf(edge('secondary', 100, 'ramp'))).toBe('highway');
    expect(bucketOf(edge('tertiary', 100, 'turn_channel'))).toBe('highway');
  });
});

describe('classMixOf', () => {
  it('length-weights and sums to 1', () => {
    const mix = classMixOf([
      edge('trunk', 1000),
      edge('secondary', 2000),
      edge('tertiary', 6000),
      edge('residential', 1000),
    ])!;
    expect(mix.highwayShare).toBeCloseTo(0.1, 5);
    expect(mix.mainShare).toBeCloseTo(0.2, 5);
    expect(mix.backroadShare).toBeCloseTo(0.6, 5);
    expect(mix.hoodShare).toBeCloseTo(0.1, 5);
    const sum =
      mix.highwayShare + mix.mainShare + mix.backroadShare + mix.hoodShare + mix.otherShare;
    expect(sum).toBeCloseTo(1, 5);
  });

  it('null on an empty trace — unknown is never 0% highway', () => {
    expect(classMixOf([])).toBeNull();
  });
});

describe('turnsPer10minOf', () => {
  it('counts total maneuvers per 10 driving minutes (audit definition)', () => {
    const route = {
      duration_s: 3600,
      maneuvers: Array.from({ length: 18 }, () => ({ type: 'turn_right', instruction: '' })),
    } as never;
    expect(turnsPer10minOf(route)).toBeCloseTo(3.0, 5);
  });
});

describe('cleanDriveVerdict (frozen R25 bar)', () => {
  const cleanInput = {
    mix: {
      highwayShare: 0,
      mainShare: 0.3,
      backroadShare: 0.65,
      hoodShare: 0.03,
      otherShare: 0.02,
    },
    hoodRunM: 200,
    turnsPer10min: 3.5,
    loopiness: 0.3,
    durErrAbs: 0.1,
    uturns: 0,
    spursWide: 0,
    microloops: 0,
    retraceRunM: 0,
    traced: true,
  };

  it('a genuinely clean drive is clean', () => {
    expect(cleanDriveVerdict(cleanInput)).toEqual({ clean: true, defects: [] });
  });

  it('each bar contributes a named defect', () => {
    expect(
      cleanDriveVerdict({
        ...cleanInput,
        mix: { ...cleanInput.mix, highwayShare: 0.05 },
      }).defects,
    ).toContain('highway');
    expect(
      cleanDriveVerdict({
        ...cleanInput,
        mix: { ...cleanInput.mix, mainShare: 0.66, backroadShare: 0.3 },
      }).defects,
    ).toContain('main_majority');
    expect(cleanDriveVerdict({ ...cleanInput, hoodRunM: 800 }).defects).toContain('hood');
    expect(cleanDriveVerdict({ ...cleanInput, turnsPer10min: 6.2 }).defects).toContain('turns');
    expect(cleanDriveVerdict({ ...cleanInput, loopiness: 0.05 }).defects).toContain('shape');
    expect(cleanDriveVerdict({ ...cleanInput, durErrAbs: 0.4 }).defects).toContain('timing');
    expect(cleanDriveVerdict({ ...cleanInput, uturns: 1 }).defects).toContain('offence');
    expect(cleanDriveVerdict({ ...cleanInput, traced: false }).defects).toContain('unmeasured');
  });

  it('A→B (loopiness null) is never judged on shape', () => {
    const v = cleanDriveVerdict({ ...cleanInput, loopiness: null });
    expect(v.defects).not.toContain('shape');
  });
});

describe('classRunsOf ≡ maxClassRunInfo (R25-U0 delegation proof)', () => {
  // 5-point straight line, 4 edges of 1000 m each; classes B A A B
  const geometry: LineString = {
    type: 'LineString',
    coordinates: [
      [-80.0, 43.5],
      [-79.9876, 43.5],
      [-79.9752, 43.5],
      [-79.9628, 43.5],
      [-79.9504, 43.5],
    ],
  };
  const edges = [
    edge('tertiary', 1000),
    edge('residential', 1000),
    edge('residential', 1000),
    edge('tertiary', 1000),
  ];
  const origin = { lat: 0, lng: 0 }; // far away — no grace effect

  it('finds the residential run and the max matches the walker', () => {
    const runs = classRunsOf(edges, geometry, new Set(['residential']), origin, 0)!;
    expect(runs.runs).toHaveLength(1);
    expect(runs.runs[0]!.runM).toBeCloseTo(2000, 0);
    const info = maxClassRunInfo(edges, geometry, new Set(['residential']), origin, 0);
    expect(info.runM).toBeCloseTo(2000, 0);
    expect(info.mid).not.toBeNull();
  });

  it('continuity stats: two backroad runs of 1000 m each', () => {
    const stats = classRunStatsOf(edges, geometry, BACKROAD_CLASSES, origin, 0);
    expect(stats.count).toBe(2);
    expect(stats.longestM).toBeCloseTo(1000, 0);
    expect(stats.meanM).toBeCloseTo(1000, 0);
  });
});
