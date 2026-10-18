import { defineConfig } from '@playwright/test';

const PORT = process.env.MAPA_PORT || 8765;   // separate port when several runs go at once

// Page tests in headless Chromium. The page is served from the repo directory (python3 -m http.server),
// Leaflet comes from node_modules, OSM tiles and Photon are stubbed (see helpers.mjs).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  globalTimeout: 180_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  workers: 3,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/golden/{arg}{ext}',
  use: {
    channel: 'chrome',   // installed Google Chrome (no Playwright browser download)
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  },
  webServer: {
    // MAPA_DIR: another directory with the page (e.g. a copy of the previous commit to record goldens)
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${process.env.MAPA_DIR || '..'}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
