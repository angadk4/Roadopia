import { z } from 'zod';

import { LatLngSchema } from './route';

/**
 * Car-spot domain model (M0-T06). Authority: Master Spec §22.
 * The human-knowledge layer + the agent's set of routable places.
 */

/** Spot types (§22). */
export const SpotTypeSchema = z.enum([
  'great_road',
  'viewpoint',
  'coffee',
  'fuel',
  'meetup',
  'rest',
  'food', // restaurants + fast food (R16-1); cafés stay 'coffee'
]);
export type SpotType = z.infer<typeof SpotTypeSchema>;

/** `osm` = seeded import (owner_id null, display-only in MVP); `user` = community. */
export const SpotSourceSchema = z.enum(['osm', 'user']);
export type SpotSource = z.infer<typeof SpotSourceSchema>;

export const SpotSchema = z.object({
  id: z.string().uuid().optional(),
  location: LatLngSchema,
  type: SpotTypeSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Storage URLs; images are EXIF-stripped + re-encoded server-side before retrieval (§56). */
  photo_urls: z.array(z.string()).optional(),
  owner_id: z.string().uuid().nullable(), // null = OSM-seeded
  source: SpotSourceSchema,
});
export type Spot = z.infer<typeof SpotSchema>;
