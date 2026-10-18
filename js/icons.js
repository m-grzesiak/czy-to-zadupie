export const ICON_X = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const ICON_BACK = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Własna pinezka jako inline SVG — domyślna ikonka Leaflet to plik PNG z folderu
// images/, którego CDN nie dostarcza razem z samym JS/CSS, więc bez tego byłaby
// niewidoczna (złamany link do obrazka).
export const clickIcon = L.divIcon({
  className: '',
  html: `<svg width="26" height="36" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 23 13 23s13-13.5 13-23C26 5.8 20.2 0 13 0z" fill="#c98a2c"/>
    <circle cx="13" cy="13" r="5.5" fill="#fff"/>
  </svg>`,
  iconSize: [26, 36],
  iconAnchor: [13, 36],
});
export const ISO_ICON = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></svg>`;
export const CHIP_MINUS = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const CHIP_PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7h9M7 2.5v9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const CHIP_X = '<svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const targetIcon = L.divIcon({
  className: '',
  html: `<svg width="24" height="34" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 0C5.8 0 0 5.8 0 13c0 9.5 13 23 13 23s13-13.5 13-23C26 5.8 20.2 0 13 0z" fill="#184f95"/>
    <path d="M9 7.5v11M9 8h8l-2 3 2 3H9" fill="#fff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  iconSize: [24, 34], iconAnchor: [12, 34],
});
export const SR_ICON = {
  addr: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 14.5s4.8-4.3 4.8-8A4.8 4.8 0 0 0 3.2 6.5c0 3.7 4.8 8 4.8 8z"/><circle cx="8" cy="6.4" r="1.7"/></svg>',
  street: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 1.5L3 14.5M11 1.5l2 13M8 2.5v2M8 7v2M8 11.5v2"/></svg>',
  area: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M1.5 4l4.3-2 4.4 2 4.3-2v10l-4.3 2-4.4-2-4.3 2z"/><path d="M5.8 2v10M10.2 4v10"/></svg>',
  recent: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.3 1.6"/></svg>',
};
