// prosty kopiec binarny na tablicy par [t, id] (zasięg bez walk.bin)
export function heapPush(h, x) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
export function heapPop(h) {
  const top = h[0], last = h.pop();
  if (!h.length) return top;
  h[0] = last;
  for (let i = 0; ;) {
    const l = 2 * i + 1, r = l + 1;
    let m = i;
    if (l < h.length && h[l][0] < h[m][0]) m = l;
    if (r < h.length && h[r][0] < h[m][0]) m = r;
    if (m === i) break;
    [h[m], h[i]] = [h[i], h[m]];
    i = m;
  }
  return top;
}
// Kolejka priorytetowa na tablicach typowanych (bez tworzenia obiektów w pętli)
export class TypedHeap {
  constructor(cap = 4096) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    const K = this.k, V = this.v;
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= key) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = key; V[i] = val;
  }
  pop() {   // zwraca wartość; klucz w this.top
    const K = this.k, V = this.v, val = V[0];
    this.top = K[0];
    const n = --this.n;
    if (n > 0) {
      const key = K[n], v = V[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && K[c + 1] < K[c]) c++;
        if (K[c] >= key) break;
        K[i] = K[c]; V[i] = V[c]; i = c;
      }
      K[i] = key; V[i] = v;
    }
    return val;
  }
}
