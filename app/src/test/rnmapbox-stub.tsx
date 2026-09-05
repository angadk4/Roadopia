/**
 * Node-safe stand-in for '@rnmapbox/maps' (vitest alias — M7-T02). Renders map
 * primitives as plain host elements so screen smoke tests exercise OUR wiring;
 * real map behaviour is verified on device (M7-T09).
 *
 * Device pass (2026-09-04): MapView forwards a ref with the two view→map
 * methods the screens now use (press-time centre resolution), answering from
 * MOCK_MAP so a test can place the "camera" wherever it likes.
 */

import {
  createElement,
  forwardRef,
  useImperativeHandle,
  type ReactElement,
  type ReactNode,
} from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function host(tag: string) {
  return function Host(props: AnyProps): ReactElement {
    const { children, ...rest } = props;
    // Non-serializable props (functions, objects) are dropped from the JSON
    // tree by react-test-renderer automatically; keep them for completeness.
    return createElement(tag, rest, children);
  };
}

export interface MapViewHandle {
  /** [x, y] in dp → [lng, lat]. */
  getCoordinateFromView(point: [number, number]): Promise<[number, number]>;
  getCenter(): Promise<[number, number]>;
}

/** Test-settable answers for the MapView ref methods ([lng, lat]). */
export const MOCK_MAP: {
  center: [number, number];
  coordinateFromView: (point: [number, number]) => [number, number];
} = {
  center: [-79.8, 43.6],
  coordinateFromView: () => MOCK_MAP.center,
};

export const MapView = forwardRef<MapViewHandle, AnyProps>(function MapView(props, ref) {
  useImperativeHandle(ref, () => ({
    getCoordinateFromView: (point) => Promise.resolve(MOCK_MAP.coordinateFromView(point)),
    getCenter: () => Promise.resolve(MOCK_MAP.center),
  }));
  const { children, ...rest } = props;
  return createElement('mapbox-mapview', rest, children as ReactNode);
});
export const Camera = host('mapbox-camera');
export const ShapeSource = host('mapbox-shapesource');
export const LineLayer = host('mapbox-linelayer');
export const CircleLayer = host('mapbox-circlelayer');
export const SymbolLayer = host('mapbox-symbollayer');
export const Images = host('mapbox-images');
export const UserLocation = host('mapbox-userlocation');

export const UserTrackingMode = {
  Follow: 'normal',
  FollowWithHeading: 'compass',
  FollowWithCourse: 'course',
} as const;

const Mapbox = {
  setAccessToken(): void {},
  StyleURL: { Dark: 'mapbox://styles/mapbox/dark-v11', Light: 'mapbox://styles/mapbox/light-v11' },
  CircleLayer,
};

export default Mapbox;
