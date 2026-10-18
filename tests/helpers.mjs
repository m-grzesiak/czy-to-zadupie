import { expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const LEAFLET_JS = readFileSync(here('./node_modules/leaflet/dist/leaflet.js'));
const LEAFLET_CSS = readFileSync(here('./node_modules/leaflet/dist/leaflet.css'));
const PHOTON = JSON.parse(readFileSync(here('./fixtures/photon-karmelicka.json'), 'utf8'));

const getMap = () => window.__mapa?.map ?? map;   // eslint-disable-line no-undef

// Tuesday, 8:00 — a weekday within the data range
export const TUESDAY_8 = '2026-10-20T08:00:00+02:00';

// Clock, Leaflet from node_modules, OSM tiles (204), Photon from a file. Returns the list of page errors.
export async function setup(page, { time = TUESDAY_8 } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date(time));
  await page.route('**/leaflet.min.js', r => r.fulfill({ body: LEAFLET_JS, contentType: 'application/javascript' }));
  await page.route('**/leaflet.min.css', r => r.fulfill({ body: LEAFLET_CSS, contentType: 'text/css' }));
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 204 }));
  await page.route(/photon\.komoot\.io/, r => r.fulfill({ json: PHOTON }));
  return errors;
}

// opens the page with the given hash and waits until everything is computed
export async function open(page, hash = '') {
  await page.goto('index.html' + (hash ? '#' + hash : ''));
  await expect(page.locator('#loading')).toBeHidden();
  await settle(page);
}

// waits for the network to go idle and the panel and map to stop changing
export async function settle(page) {
  await page.waitForLoadState('networkidle');
  let prev = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(120);
    const cur = await page.evaluate(gm => {
      const m = (0, eval)(gm)(), c = m.getCenter();
      // map in motion (pan / zoom animation) = not done yet
      const moving = m._animatingZoom || (m._panAnim && m._panAnim._inProgress) || m._flyToFrame;
      return document.body.innerText + '|' + location.hash + '|' + c.lat.toFixed(6) + ',' + c.lng.toFixed(6) + '@' + m.getZoom()
        + '|' + document.querySelectorAll('.leaflet-overlay-pane canvas, .leaflet-marker-pane > *, .leaflet-tooltip').length
        + (moving ? '|moving' + Math.random() : '');
    }, '(' + getMap.toString() + ')');
    if (cur === prev && !/Liczę|Wczytuję|Sprawdzam…|Szukam…/.test(cur)) return;
    prev = cur;
  }
}


// screen point for coordinates (relative to the page)
export async function pagePoint(page, lat, lon) {
  return page.evaluate(([lat, lon, gm]) => {
    const m = (0, eval)(gm)();
    const p = m.latLngToContainerPoint([lat, lon]), r = m.getContainer().getBoundingClientRect();
    return { x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) };
  }, [lat, lon, '(' + getMap.toString() + ')']);
}

export async function hoverLL(page, lat, lon) {
  const p = await pagePoint(page, lat, lon);
  await page.mouse.move(p.x - 30, p.y - 30);
  await page.mouse.move(p.x, p.y, { steps: 8 });
  // Leaflet throttles mousemove (32 ms) — the last move may have been dropped, so once more to the same point
  await page.waitForTimeout(80);
  await page.mouse.move(p.x + 1, p.y);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(150);
  return p;
}

export async function clickLL(page, lat, lon) {
  const p = await hoverLL(page, lat, lon);
  await page.mouse.click(p.x, p.y);
  await settle(page);
}

export async function tapLL(page, lat, lon) {
  const p = await pagePoint(page, lat, lon);
  await page.touchscreen.tap(p.x, p.y);
  await settle(page);
}

// finger swipe on the panel (synthetic TouchEvent, as in CLAUDE.md)
export async function swipePanel(page, dy) {
  await page.evaluate(dy => {
    const el = document.getElementById('panel'), r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y0 = r.top + 40;
    const t = y => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(y0)], changedTouches: [t(y0)], bubbles: true }));
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(y0 + dy)], bubbles: true }));
  }, dy);
  await settle(page);
}

const norm = s => (s || '').replace(/[ \t ]+/g, ' ').split('\n').map(x => x.trim()).filter(Boolean);

// Page state to compare with the saved golden: panel text, URL, classes, map cards, view
export async function state(page) {
  const s = await page.evaluate(gm => {
    const m = (0, eval)(gm)();
    const txt = sel => [...document.querySelectorAll(sel)].map(e => e.innerText).join('\n');
    const cls = sel => document.querySelector(sel)?.className || '';
    const c = m.getCenter();
    return {
      hash: decodeURIComponent(location.hash),
      app: cls('#app'), layout: cls('#layout'), panel: cls('#panel'),
      panelText: document.getElementById('panel').innerText,
      chip: txt('.iso-chip'),
      hover: txt('.leaflet-hover-pane'),
      popup: txt('.leaflet-popup-content'),
      tooltips: txt('.leaflet-tooltip'),
      legend: txt('.stop-legend'),
      view: { lat: +c.lat.toFixed(3), lon: +c.lng.toFixed(3), zoom: +m.getZoom().toFixed(1) },
    };
  }, '(' + getMap.toString() + ')');
  for (const k of ['panelText', 'chip', 'hover', 'popup', 'tooltips', 'legend']) s[k] = norm(s[k]);
  return s;
}

export async function expectState(page, name) {
  expect(JSON.stringify(await state(page), null, 1)).toMatchSnapshot(name + '.json');
}
