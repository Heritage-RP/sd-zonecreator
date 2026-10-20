/**
 * Satellite map image size and GTA world ↔ map (Leaflet CRS.Simple) conversions, shared by the zone creator and the
 * Fork patch: pick session (PointPicker). Values from upstream ZoneCreator.tsx, unchanged.
 */

export const IMG_WIDTH = 4096;
export const IMG_HEIGHT = 6144;

export const GTA_BOUNDS = {
  minX: -4000,
  maxX: 4500,
  minY: -4000,
  maxY: 8000
};

const SCALE_X = 0.454685;
const SCALE_Y = -0.454830;
const OFFSET_X = 1882.72;
const OFFSET_Y = 3826.58;

export const gtaToLatLng = (gtaX: number, gtaY: number): [number, number] => {
  const lng = gtaX * SCALE_X + OFFSET_X;
  const lat = IMG_HEIGHT - (gtaY * SCALE_Y + OFFSET_Y);
  return [lat, lng];
};

export const latLngToGta = (lat: number, lng: number): { x: number; y: number } => {
  const x = (lng - OFFSET_X) / SCALE_X;
  const y = (IMG_HEIGHT - lat - OFFSET_Y) / SCALE_Y;
  return { x, y };
};
