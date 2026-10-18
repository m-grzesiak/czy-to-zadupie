// Polish plural forms: plural(5, 'linia', 'linie', 'linii') -> 'linii'
export const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;
export const przystanki = n => plural(n, 'przystanek', 'przystanki', 'przystanków');
export const linii = n => plural(n, 'linia', 'linie', 'linii');
export const dmy = iso => { const [y, m, d] = iso.split('-'); return `${+d}.${m}.${y}`; };
export const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const inMin = d => d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`;
export const zaMin = d => d <= 0 ? 'teraz' : `za ${inMin(d)}`;
export const nDeps = n => `${n} ${plural(n, 'odjazd', 'odjazdy', 'odjazdów')}`;
export const DOW = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
export function localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayISO() { return localISO(new Date()); }
export const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('pl', { maximumFractionDigits: 1 })} km`;
// letter by letter (ł → l, ó → o…), so indices in the folded text match the original
const foldCh = c => c === 'ł' || c === 'Ł' ? 'l' : c.toLowerCase().normalize('NFD').charAt(0);
export const fold = s => s.split('').map(foldCh).join('');
// time without a leading zero: 7:05 instead of 07:05
export const hm = m => fmt(m).replace(/^0/, '');
// consecutive days from `from` (ISO date, today by default)
export function nextDays(n = 7, from = null) {
  const base = from ? new Date(from + 'T12:00') : new Date();
  return Array.from({ length: n }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return localISO(d); });
}
// day label on a button: Dziś, Jutro, „wt. 21.10”
export function dayChipLabel(iso, i) {
  if (i === 0) return 'Dziś';
  if (i === 1) return 'Jutro';
  const d = new Date(iso + 'T12:00');
  return `${DOW[d.getDay()]} ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
// list from localStorage (valid items only); error or private mode = empty list
export function loadList(key, valid) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v.filter(x => x && valid(x)) : [];
  } catch (e) { return []; }
}
export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode: only until the session ends */ }
}
