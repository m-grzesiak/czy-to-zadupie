   // "ref|type" -> [przystanki obsługiwane przez linię]

export const radiusInput = document.getElementById('radius');
export const radiusVal = document.getElementById('radius-val');
export const dataNote = document.getElementById('data-note');
export const routeStatus = document.getElementById('route-status');
const noticeEl = document.getElementById('notice');
const srStatus = document.getElementById('sr-status');
export const EMPTY_HTML = document.getElementById('results').innerHTML;
// ---------------------------------------------------------------------------
// Telefon (do 760 px): mapa na cały ekran, panel jako arkusz wysuwany od dołu.
// Stany: karta startowa (bez miejsca, #app.st-empty), niski arkusz „peek” i rozwinięty „full”
// (#layout.sheet-peek / .sheet-full), wybrana linia (#panel.line-open) i zasięg (#panel.iso-open,
// niski arkusz z samymi ustawieniami). Na komputerze klasy nic nie zmieniają.
// ---------------------------------------------------------------------------
export const MQ_MOBILE = window.matchMedia('(max-width: 760px)');
export const isMobile = () => MQ_MOBILE.matches;
export const panelEl = document.getElementById('panel');
export const layoutEl = document.getElementById('layout');
export const appEl = document.getElementById('app');
// komunikat nad wynikami (np. błąd lokalizacji); pusty tekst chowa
export function showNotice(text) { noticeEl.hidden = !text; noticeEl.textContent = text || ''; }
// czytniki ekranu: ogłoś nowy tytuł panelu
export function announce() {
  const t = document.getElementById('panel-title').textContent, s = document.getElementById('panel-sub').textContent;
  srStatus.textContent = s ? `${t}. ${s}` : t;
}
// pigułka "Wczytuję…" nad mapą; kilka wczytań naraz = jedna pigułka
const loadingEl = document.getElementById('loading');
const loadingJobs = new Map();
export function setLoading(job, text) {
  if (text) loadingJobs.set(job, text); else loadingJobs.delete(job);
  loadingEl.hidden = !loadingJobs.size;
  if (loadingJobs.size) loadingEl.querySelector('span').textContent = [...loadingJobs.values()].pop();
}
// Styl kropek przystanków: rozmiar zależy od przybliżenia, przy zasięgu kropki są przygaszone
// ekran dotykowy: większe kropki i większa tolerancja trafienia palcem
export const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;
