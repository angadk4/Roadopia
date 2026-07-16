/**
 * Node-safe stand-in for '@rnmapbox/maps' (vitest alias — M7-T02). Renders map
 * primitives as plain host elements so screen smoke tests exercise OUR wiring;
 * real map behaviour is verified on device (M7-T09).
 */

import { createElement, type ReactElement, type ReactNode } from 'react';

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function host(tag: string) {
  return function Host(props: AnyProps): ReactElement {
    const { children, ...rest } = props;
    // Non-serializable props (functions, objects) are dropped from the JSON
    // tree by react-test-renderer automatically; keep them for completeness.
    return createElement(tag, rest, children);
  };
}

export const MapView = host('mapbox-mapview');
export const Camera = host('mapbox-camera');
export const ShapeSource = host('mapbox-shapesource');
export const LineLayer = host('mapbox-linelayer');
export const CircleLayer = host('mapbox-circlelayer');
export const SymbolLayer = host('mapbox-symbollayer');
export const Images = host('mapbox-images');

const Mapbox = {
  setAccessToken(): void {},
  StyleURL: { Dark: 'mapbox://styles/mapbox/dark-v11', Light: 'mapbox://styles/mapbox/light-v11' },
};

export default Mapbox;
