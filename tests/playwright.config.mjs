import { defineConfig } from '@playwright/test';

const PORT = process.env.MAPA_PORT || 8765;   // osobny port, gdy kilka przebiegów działa naraz

// Testy strony przez headless Chromium. Strona jest serwowana z katalogu repo (python3 -m http.server),
// Leaflet podstawiany z node_modules, kafelki OSM i Photon zastępowane (patrz helpers.mjs).
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
    channel: 'chrome',   // zainstalowany Google Chrome (bez pobierania przeglądarki Playwrighta)
    baseURL: `http://127.0.0.1:${PORT}/`,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
  },
  webServer: {
    // MAPA_DIR: inny katalog ze stroną (np. kopia z poprzedniego commitu do nagrania wzorców)
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${process.env.MAPA_DIR || '..'}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
  },
});
