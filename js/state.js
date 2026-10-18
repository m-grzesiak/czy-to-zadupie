// App state: selected place, line, reach area, target, day type… (single source of truth for views)
export const state = {
  stopMode: null, // {name, lat, lon, poles} when a stop was clicked
  radiusCircle: null,
  radiusMeters: 500,
  pointLabel: null, // address from search for the selected point (dragging the pin clears it)
  lastNearby: [],
  pointReach: null, // Map stopId -> metres along streets | null (unreachable on foot); null = not computed
  lastOutside: null, // nearest stops outside the circle when there are none inside
  selectedRouteKey: null,
  selectedVariant: 0,
  selectedDay: null,
  ldTab: 'trasa',
  ldKurs: null,
  ldBefore: false,
  ldEarly: false,
  sheetState: 'peek',
  iso: null, // {origin, T, labels: Map(id -> {t, prev, ti, from, to, walk})}
  isoT: 20,
  isoMode: 'typical', // 'typical' | 'time'
  isoDay: 'w',
  isoDate: null,
  isoTime: null, // time mode: ISO date and minutes after midnight
  target: null,
  targetPopOn: false,
  pickingTarget: false,
  boardLimit: 16,
  reach: null,
  placeStats: null,
  applyingState: false,
  restoringPlace: false,
};
