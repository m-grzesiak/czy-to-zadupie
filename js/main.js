import { MQ_MOBILE, isMobile, setLoading } from './dom.js';
import { indexStops, loadStops } from './data.js';
import { applyMaxBounds, initMap, locateCtl, map, zoomCtl } from './map/view.js';
import { renderDataInfo, showEmpty } from './ui/panel.js';
import { applyState } from './ui/url.js';
import { setSheetVar, updateSheet } from './ui/sheet.js';
// Pozostałe moduły: część z nich przy wczytaniu podpina nasłuchy (history, search, events),
// a lista ustala kolejność ich wykonania.
import './state.js';
import './util.js';
import './config.js';
import './icons.js';
import './walk.js';
import './routing/heap.js';
import './routing/transit.js';
import './routing/street.js';
import './routing/csa.js';
import './map/stops.js';
import './map/route.js';
import './map/iso.js';
import './iso.js';
import './ui/iso-box.js';
import './ui/line.js';
import './ui/board.js';
import './ui/place.js';
import './ui/target.js';
import './ui/history.js';
import './ui/search.js';
import './ui/events.js';

// przejście telefon ↔ komputer (szerokość 760 px): kontrolki mapy, granice i arkusz
function onLayoutChange() {
  if (zoomCtl && locateCtl) {   // kolejność jak przy starcie: na komputerze + − nad lokalizacją
    locateCtl.remove();
    zoomCtl.setPosition(isMobile() ? 'bottomright' : 'topleft');
    locateCtl.setPosition(isMobile() ? 'topright' : 'topleft').addTo(map);
  }
  applyMaxBounds();
  setSheetVar();
  if (map) map.invalidateSize();
}

// start: dane przystanków → mapa → widok z adresu strony (albo pusty panel)
async function init() {
  MQ_MOBILE.addEventListener('change', onLayoutChange);
  await loadStops();
  indexStops();
  initMap();
  window.__mapa = { map };   // dostęp z konsoli i z testów (tests/helpers.mjs)
  updateSheet();
  setSheetVar();
  setLoading('data', null);
  renderDataInfo();
  if (location.hash.length > 1) applyState(); else showEmpty();
  window.addEventListener('popstate', applyState);
}
init();
