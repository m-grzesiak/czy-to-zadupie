// Fixed page elements and small UI helpers (notice, announcements, loading pill).
const byId = id => document.getElementById(id);

export const radiusInput = byId('radius');
export const radiusVal = byId('radius-val');
export const dataNote = byId('data-note');
export const routeStatus = byId('route-status');
export const panelEl = byId('panel');
export const layoutEl = byId('layout');
export const appEl = byId('app');
// empty panel (start card) from the HTML, restored by showEmpty
export const EMPTY_HTML = byId('results').innerHTML;

// ---------------------------------------------------------------------------
// Phone (up to 760 px): full-screen map, panel as a bottom sheet.
// States: start card (no place, #app.st-empty), low „peek” sheet and expanded „full”
// (#layout.sheet-peek / .sheet-full), selected line (#panel.line-open) and reach area (#panel.iso-open,
// low sheet with settings only). On desktop the classes change nothing.
// ---------------------------------------------------------------------------
export const MQ_MOBILE = window.matchMedia('(max-width: 760px)');
export const isMobile = () => MQ_MOBILE.matches;
// touch screen: bigger stop dots and more tolerance for finger taps
export const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;

// notice above the results (e.g. location error); empty text hides it
const noticeEl = byId('notice');
export function showNotice(text) { noticeEl.hidden = !text; noticeEl.textContent = text || ''; }
// screen readers: announce the new panel title
const srStatus = byId('sr-status');
export function announce() {
  const t = byId('panel-title').textContent, s = byId('panel-sub').textContent;
  srStatus.textContent = s ? `${t}. ${s}` : t;
}
// "Wczytuję…" pill over the map; several loads at once = one pill
const loadingEl = byId('loading');
const loadingJobs = new Map();
export function setLoading(job, text) {
  if (text) loadingJobs.set(job, text); else loadingJobs.delete(job);
  loadingEl.hidden = !loadingJobs.size;
  if (loadingJobs.size) loadingEl.querySelector('span').textContent = [...loadingJobs.values()].pop();
}
