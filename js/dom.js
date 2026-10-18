// Stałe elementy strony i drobne pomocnicze funkcje interfejsu (komunikat, ogłoszenia, pigułka wczytywania).
const byId = id => document.getElementById(id);

export const radiusInput = byId('radius');
export const radiusVal = byId('radius-val');
export const dataNote = byId('data-note');
export const routeStatus = byId('route-status');
export const panelEl = byId('panel');
export const layoutEl = byId('layout');
export const appEl = byId('app');
// pusty panel (karta startowa) z HTML — przywracany przez showEmpty
export const EMPTY_HTML = byId('results').innerHTML;

// ---------------------------------------------------------------------------
// Telefon (do 760 px): mapa na cały ekran, panel jako arkusz wysuwany od dołu.
// Stany: karta startowa (bez miejsca, #app.st-empty), niski arkusz „peek” i rozwinięty „full”
// (#layout.sheet-peek / .sheet-full), wybrana linia (#panel.line-open) i zasięg (#panel.iso-open,
// niski arkusz z samymi ustawieniami). Na komputerze klasy nic nie zmieniają.
// ---------------------------------------------------------------------------
export const MQ_MOBILE = window.matchMedia('(max-width: 760px)');
export const isMobile = () => MQ_MOBILE.matches;
// ekran dotykowy: większe kropki przystanków i większa tolerancja trafienia palcem
export const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;

// komunikat nad wynikami (np. błąd lokalizacji); pusty tekst chowa
const noticeEl = byId('notice');
export function showNotice(text) { noticeEl.hidden = !text; noticeEl.textContent = text || ''; }
// czytniki ekranu: ogłoś nowy tytuł panelu
const srStatus = byId('sr-status');
export function announce() {
  const t = byId('panel-title').textContent, s = byId('panel-sub').textContent;
  srStatus.textContent = s ? `${t}. ${s}` : t;
}
// pigułka "Wczytuję…" nad mapą; kilka wczytań naraz = jedna pigułka
const loadingEl = byId('loading');
const loadingJobs = new Map();
export function setLoading(job, text) {
  if (text) loadingJobs.set(job, text); else loadingJobs.delete(job);
  loadingEl.hidden = !loadingJobs.size;
  if (loadingJobs.size) loadingEl.querySelector('span').textContent = [...loadingJobs.values()].pop();
}
