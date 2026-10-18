// Stan aplikacji: wybrane miejsce, linia, zasięg, cel, typ dnia… (jedno źródło prawdy dla widoków)
export const state = {
  stopMode: null, // {name, lat, lon, poles} gdy kliknięto przystanek
  radiusCircle: null,
  radiusMeters: 500,
  pointLabel: null, // adres z wyszukiwarki dla wybranego punktu (przeciągnięcie pinezki go kasuje)
  lastNearby: [],
  pointReach: null, // Map stopId -> metry po ulicach | null (brak dojścia); null = nie liczono
  lastOutside: null, // najbliższe przystanki poza okręgiem, gdy w okręgu nie ma żadnego
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
  isoTime: null, // tryb czasu: data ISO i minuty od północy
  target: null,
  targetPopOn: false,
  pickingTarget: false,
  boardLimit: 16,
  reach: null,
  placeStats: null,
  applyingState: false,
  restoringPlace: false,
};
