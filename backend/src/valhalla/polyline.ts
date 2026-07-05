/**
 * Google encoded-polyline decoder for Valhalla shapes (M2-T04).
 *
 * Valhalla encodes route/leg `shape` as an encoded polyline with **precision 6**
 * (1e-6 degrees) in (lat, lng) pair order. We emit GeoJSON-order `[lon, lat]`
 * positions to match the shared `LineString` type. Pure function, no I/O.
 */

export type Position = [lon: number, lat: number];

/** Decode an encoded polyline string into [lon, lat] positions. */
export function decodePolyline(encoded: string, precision = 6): Position[] {
  const factor = 10 ** precision;
  const coords: Position[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    lat += decodeVarint();
    lng += decodeVarint();
    coords.push([lng / factor, lat / factor]);
  }
  return coords;

  function decodeVarint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    // zig-zag: LSB is the sign
    return result & 1 ? ~(result >> 1) : result >> 1;
  }
}
