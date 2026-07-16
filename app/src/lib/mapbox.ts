/**
 * Mapbox SDK bootstrap (M7-T02). Import-once side effect: sets the client-safe
 * pk. token (Hard rule H) before any MapView mounts. Maps SDK ONLY — the Nav
 * SDK is prohibited and never referenced (Hard rule F).
 */

import Mapbox from '@rnmapbox/maps';

import { getMapboxPublicToken } from './runtime';

Mapbox.setAccessToken(getMapboxPublicToken());

export default Mapbox;
