import { describe, expect, it, vi } from 'vitest';

import type { SpotRow } from '../data';
import { DataError } from '../data';
import {
  createSpot,
  fetchSpotById,
  nearestSameType,
  NUDGE_RADIUS_M,
  parseTags,
  SPOT_TAG_LEN_MAX,
  SPOT_TAGS_MAX,
  updateSpot,
  validateSpotDraft,
} from '../spots';

/** M10-T01/T03/T04 — spot validation, nudge geometry, authed calls. */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };
const UUID = '7c9e6679-7425-40de-963d-92a4d1c8e2a1';

function draftOf(over: Partial<Parameters<typeof validateSpotDraft>[0]> = {}) {
  return {
    lat: 43.3,
    lng: -79.9,
    type: 'viewpoint',
    name: 'Ridge Lookout',
    description: '',
    tags: [],
    ...over,
  };
}

describe('validation (FR-031: pin + type + name required)', () => {
  it('requires a real type and a non-blank name', () => {
    expect(validateSpotDraft(draftOf())).toBeNull();
    expect(validateSpotDraft(draftOf({ type: 'racetrack' }))).toContain('type');
    expect(validateSpotDraft(draftOf({ name: '   ' }))).toContain('name');
  });

  it('parseTags splits, trims, drops empties and bounds the list', () => {
    expect(parseTags(' quiet, gravel lot ,,')).toEqual(['quiet', 'gravel lot']);
    const many = parseTags(Array.from({ length: 20 }, (_, i) => `t${i}`).join(','));
    expect(many).toHaveLength(SPOT_TAGS_MAX);
    expect(parseTags('x'.repeat(99))[0]).toHaveLength(SPOT_TAG_LEN_MAX);
  });
});

describe('proximity nudge (FR-033 — warn, never block)', () => {
  const spots: SpotRow[] = [
    { id: '1', name: 'Close Same', type: 'coffee', lat: 43.3005, lng: -79.9, source: 'osm' }, // ~55 m
    { id: '2', name: 'Close Other', type: 'fuel', lat: 43.3001, lng: -79.9, source: 'osm' }, // ~11 m, other type
    { id: '3', name: 'Far Same', type: 'coffee', lat: 43.31, lng: -79.9, source: 'user' }, // ~1.1 km
  ];

  it('finds the nearest SAME-type spot within the radius only', () => {
    const hit = nearestSameType(spots, { lat: 43.3, lng: -79.9 }, 'coffee');
    expect(hit!.name).toBe('Close Same');
    expect(hit!.distanceM).toBeLessThan(NUDGE_RADIUS_M);
    // the 11 m fuel spot never nudges a coffee pin; the 1.1 km coffee is out of range
    expect(nearestSameType(spots, { lat: 43.3, lng: -79.9 }, 'viewpoint')).toBeNull();
  });
});

describe('createSpot', () => {
  it('sends the bounded payload with the caller token and returns the id', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(UUID),
    }));
    const id = await createSpot(
      CFG,
      'user-token',
      draftOf({ name: '  Ridge Lookout  ', description: 'd'.repeat(9000) }),
      fetchMock as never,
    );
    expect(id).toBe(UUID);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toContain('/rpc/create_spot');
    expect(init.headers['authorization']).toBe('Bearer user-token');
    const body = JSON.parse(init.body) as { p: { name: string; description: string } };
    expect(body.p.name).toBe('Ridge Lookout'); // trimmed
    expect(body.p.description.length).toBeLessThanOrEqual(500); // bounded early
  });

  it('rejects an invalid draft before any network call', async () => {
    const fetchMock = vi.fn();
    await expect(createSpot(CFG, 't', draftOf({ name: '' }), fetchMock as never)).rejects.toThrow(
      DataError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('updateSpot / fetchSpotById honesty', () => {
  it('updateSpot returns false when RLS filtered the row (not yours / OSM)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => 'false' }));
    expect(await updateSpot(CFG, 't', UUID, { name: 'X' }, fetchMock as never)).toBe(false);
  });

  it('fetchSpotById returns null for an invisible/gone spot, never throws', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }));
    expect(await fetchSpotById(CFG, UUID, null, fetchMock as never)).toBeNull();
  });
});
