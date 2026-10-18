// polska odmiana liczebników: plural(5, 'linia', 'linie', 'linii') -> 'linii'
export const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? few : many;
export const przystanki = n => plural(n, 'przystanek', 'przystanki', 'przystanków');
export const linii = n => plural(n, 'linia', 'linie', 'linii');
export const dmy = iso => { const [y, m, d] = iso.split('-'); return `${+d}.${m}.${y}`; };
// ---------------------------------------------------------------------------
// Szczegóły linii: odjazdy z najbliższego przystanku + czas przejazdu po trasie
// ---------------------------------------------------------------------------
export const esc = t => String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export const fmt = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const inMin = d => d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`;
export const zaMin = d => d <= 0 ? 'teraz' : `za ${inMin(d)}`;
export const nDeps = n => `${n} ${n === 1 ? 'odjazd' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? 'odjazdy' : 'odjazdów'}`;
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
// litera po literze (ł → l, ó → o…), więc indeksy w złożonym tekście zgadzają się z oryginałem
const foldCh = c => c === 'ł' || c === 'Ł' ? 'l' : c.toLowerCase().normalize('NFD').charAt(0);
export const fold = s => s.split('').map(foldCh).join('');
