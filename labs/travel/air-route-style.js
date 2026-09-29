// User-approved travel direction style. Itinerary data must not override these values.
export const AIR_ROUTE_STYLE = Object.freeze({
  id: 'air-arc-v1',
  roofClearance: 12,
  minRise: 35,
  maxRise: 95,
  riseRatio: .4,
  curveSegments: 48,
  lineWidth: 2.5,
  haloWidth: 5,
  haloColor: '#faf7ef',
  headLength: 10,
  headHalfWidth: 5,
  headStrokeWidth: 3,
});
export const airRouteStrokes = color => [
  [AIR_ROUTE_STYLE.haloColor, AIR_ROUTE_STYLE.haloWidth],
  [color, AIR_ROUTE_STYLE.lineWidth],
];
export const airArrowPath = () => {
  const {headLength:l,headHalfWidth:w}=AIR_ROUTE_STYLE;
  return `M-${l} -${w} L0 0 L-${l} ${w}`;
};
