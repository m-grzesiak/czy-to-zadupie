import { test, expect } from '@playwright/test';
import { setup, open, settle, hoverLL, clickLL, tapLL, swipePanel, expectState, pagePoint } from './helpers.mjs';

// Scenariusze z CLAUDE.md („Jak testować”). Każdy krok zapisuje stan strony (tekst panelu, adres, klasy,
// karty na mapie, widok) i porównuje go ze wzorcem w golden/ — wzorce nagrywa `npm run golden`.

const RYNEK = [50.06170, 19.93730];
const RONDO_MOGILSKIE = 'stop_203_12519';
const OCHODZA = '10781';
const MIETNIOW = '669701';
const KRAKOW_GLOWNY = [50.06840, 19.94750];
const KURDWANOW = [50.01230, 19.95750];
const PLASZOW_ESTAKADA = [50.03350, 19.97710];
const LAS_WOLSKI = [50.04600, 19.85000];
const p = ([la, lo]) => `${la.toFixed(5)},${lo.toFixed(5)}`;

let errors;
test.beforeEach(async ({ page }) => { errors = await setup(page); });
test.afterEach(() => { expect(errors).toEqual([]); });

test.describe('komputer', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('pusty widok', async ({ page }) => {
    await open(page);
    await expectState(page, 'd-start');
  });

  test('punkt: Rynek Główny', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500`);
    await expect(page.locator('#panel-title')).toHaveText('13 linii w pobliżu');
    await expect(page.locator('#panel-sub')).toContainText(/\d+ linii nocnych/);
    await expect(page.locator('.dest', { hasText: 'Lotnisko' })).toContainText(/3\d min/);
    await expectState(page, 'd-rynek');
    // hover na przystanek w liście pokazuje kartę na mapie
    await page.locator('.stop-item').first().hover();
    await settle(page);
    await expectState(page, 'd-rynek-hover-list');
  });

  test('punkt: promień i typ dnia', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500`);
    await page.locator('#radius').fill('1000');
    await settle(page);
    await expectState(page, 'd-rynek-r1000');
    await page.locator('#day-type').selectOption('s');
    await settle(page);
    await expectState(page, 'd-rynek-sobota');
  });

  test('przykład z karty startowej i klik w mapę', async ({ page }) => {
    await open(page);
    await page.locator('[data-example]', { hasText: 'Kurdwanów' }).click();
    await settle(page);
    await expectState(page, 'd-example-kurdwanow');
    await clickLL(page, 50.0160, 19.9530);
    await expectState(page, 'd-click-map');
  });

  test('miejsce bez przystanków w promieniu', async ({ page }) => {
    await open(page, `p=${p(LAS_WOLSKI)}&r=300`);
    await expectState(page, 'd-empty-area');
    const grow = page.locator('[data-radius-to]');
    if (await grow.count()) { await grow.click(); await settle(page); }
    await expectState(page, 'd-empty-area-grow');
  });

  test('przystanek: Rondo Mogilskie, tablica odjazdów', async ({ page }) => {
    await open(page, `s=${RONDO_MOGILSKIE}`);
    await expectState(page, 'd-stop');
    await page.locator('[data-board-more]').click();
    await settle(page);
    await expectState(page, 'd-stop-more');
    await page.locator('.dep-row').first().hover();
    await settle(page);
    await expectState(page, 'd-stop-dep-hover');
  });

  test('przystanek: klik w kropkę na mapie', async ({ page }) => {
    await open(page, `p=50.06570,19.95970&r=300`);
    await page.locator('.stop-item').first().click();
    await settle(page);
    await expectState(page, 'd-stop-from-list');
    await clickLL(page, 50.065765, 19.959868);
    await expectState(page, 'd-stop-from-map');
  });

  test('linia 5 z Ronda Mogilskiego', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, `s=${RONDO_MOGILSKIE}`);
    await page.locator('#lines-box .badge[data-key="5|tram"]').click();
    await settle(page);
    await expect(page.locator('.dseg [data-dir]')).toHaveCount(2);
    await expectState(page, 'd-line5');
    await page.locator('[data-ldtab="rozklad"]').click();
    await settle(page);
    await expect(page.locator('#ld-tt')).toContainText(/\d+ odjazd/);
    await expectState(page, 'd-line5-rozklad');
    await page.locator('.dseg [data-dir]:not(.on)').click();
    await settle(page);
    await expect(page.locator('#ld-tt')).toContainText(/\d+ odjazd/);
    await expectState(page, 'd-line5-dir2');
    await page.locator('[data-ld-early]').click({ timeout: 2000 }).catch(() => {});
    await page.locator('[data-day]').nth(5).click();
    await settle(page);
    await expectState(page, 'd-line5-day5');
    await page.locator('[data-ldtab="trasa"]').click();
    await page.locator('.ld-nt').nth(2).click();
    await settle(page);
    await page.locator('[data-ld-before]').click({ timeout: 2000 }).catch(() => {});
    await settle(page);
    await expectState(page, 'd-line5-kurs');
    // hover na numer innej linii = podgląd trasy, Esc zamyka linię
    await page.locator('#lines-box .badge').nth(3).hover();
    await settle(page);
    await page.keyboard.press('Escape');
    await settle(page);
    await expectState(page, 'd-line5-esc');
  });

  test('linia z adresu', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500&l=52|bus`);
    await expectState(page, 'd-line-url');
  });

  test('zasięg z Rynku: chip, hover, cel, nowy start, powrót, Esc', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, `p=${p(RYNEK)}&r=500&iso=20`);
    await expectState(page, 'd-iso');
    await page.locator('.iso-chip [data-chip="+"]').click();
    await settle(page);
    expect(await page.evaluate(() => location.hash)).toContain('iso=25');
    await expectState(page, 'd-iso-plus');
    await hoverLL(page, 50.0700, 19.9600);
    await settle(page);
    await expectState(page, 'd-iso-hover-point');
    await page.mouse.move(5, 5);
    await clickLL(page, 50.0580, 19.9200);
    await expectState(page, 'd-iso-target');
    await page.locator('.target-pop [data-pop-origin]').click();
    await settle(page);
    const h = await page.evaluate(() => location.hash);
    expect(h).toMatch(/p=50\.058\d*,19\.920/);
    expect(h).toContain('iso=25');
    expect(h).not.toContain('cel=');
    await expectState(page, 'd-iso-new-origin');
    await page.locator('#back-place').click();
    await settle(page);
    await expectState(page, 'd-iso-back');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settle(page);
    await expectState(page, 'd-iso-esc');
  });

  test('zasięg: suwak, typ dnia, tryb czasu', async ({ page }) => {
    await open(page, `s=${RONDO_MOGILSKIE}`);
    await page.locator('[data-iso="on"]').click();
    await settle(page);
    await expectState(page, 'd-iso-stop');
    await page.locator('#iso-t').fill('40');
    await page.locator('#iso-t').dispatchEvent('change');
    await settle(page);
    await expectState(page, 'd-iso-stop-40');
    await page.locator('[data-iso-day="n"]').click();
    await settle(page);
    await expectState(page, 'd-iso-stop-niedz');
    await page.locator('[data-iso-mode="time"]').click();
    await settle(page);
    await expect(page.locator('#iso-time')).toHaveValue('08:00');
    await expectState(page, 'd-iso-stop-time');
    await page.locator('#iso-time').fill('22:30');
    await page.locator('#iso-time').dispatchEvent('change');
    await expect.poll(() => page.evaluate(() => location.hash)).toContain('t=22:30');
    await settle(page);
    await expectState(page, 'd-iso-stop-time-2230');
    await page.locator('[data-iso="off"]').first().click();
    await settle(page);
    await expectState(page, 'd-iso-stop-off');
  });

  test('tryb czasu: Ochodza Odwiśle w niedzielę o 10:00', async ({ page }) => {
    await open(page, `s=${OCHODZA}&iso=20&d=2026-10-25&t=10:00`);
    await expect(page.locator('#iso-next')).toContainText('Najbliższy odjazd: 235 o 15:59');
    await expectState(page, 'd-ochodza');
    await page.locator('#iso-next [data-iso-at]').click();
    await settle(page);
    await expectState(page, 'd-ochodza-wyjdz');
  });

  test('cel: Mietniów → Kraków Główny', async ({ page }) => {
    await open(page, `s=${MIETNIOW}&cel=${p(KRAKOW_GLOWNY)}`);
    await expect(page.locator('#target-box .tb-time')).toContainText(/(4[5-9]|5\d) min/);
    await expectState(page, 'd-mietniow');
  });

  test('cel: Mietniów → Kraków Główny, wtorek 7:15', async ({ page }) => {
    await open(page, `s=${MIETNIOW}&iso=60&d=2026-10-20&t=07:15&cel=${p(KRAKOW_GLOWNY)}`);
    await expectState(page, 'd-mietniow-time');
  });

  test('cel: Kurdwanów → Dworzec Płaszów Estakada', async ({ page }) => {
    await open(page, `p=${p(KURDWANOW)}&r=500&iso=20&cel=${p(PLASZOW_ESTAKADA)}`);
    await expectState(page, 'd-kurdwanow-plaszow');
  });

  test('cel z listy, moje miejsce, wskazywanie celu', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500`);
    await page.locator('.dest', { hasText: 'Kampus UJ' }).click();
    await settle(page);
    await expectState(page, 'd-dest');
    await page.locator('[data-target-save]').click();
    await page.locator('#place-name').fill('Uczelnia');
    await page.locator('[data-target-save-ok]').click();
    await settle(page);
    await expectState(page, 'd-dest-saved');
    await page.locator('[data-pick-target]').click();
    await clickLL(page, 50.0750, 19.9100);
    await expectState(page, 'd-picked-target');
    await page.locator('[data-target-clear]').click();
    await page.locator('[data-place-del]').first().click();
    await settle(page);
    await expectState(page, 'd-place-deleted');
  });

  test('wyszukiwarka adresów', async ({ page }) => {
    await open(page);
    await page.locator('#sr-input').fill('Karmelicka 12');
    await settle(page);
    await expectState(page, 'd-search-list');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await settle(page);
    await expectState(page, 'd-search-chosen');
    await page.locator('#sr-input').focus();
    await settle(page);
    await expectState(page, 'd-search-recent');
  });

  test('lokalizacja', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 50.0647, longitude: 19.9450 });
    await open(page);
    await page.locator('[data-locate]').click();
    await settle(page);
    await expectState(page, 'd-locate');
  });

  test('historia: Wstecz', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500`);
    await page.locator('.stop-item').first().click();
    await settle(page);
    await page.locator('[data-iso="on"]').click();
    await settle(page);
    await page.goBack();
    await settle(page);
    await expectState(page, 'd-back1');
    await page.goBack();
    await settle(page);
    await expectState(page, 'd-back2');
  });
});

test.describe('telefon', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('karta startowa, arkusz, linia, powrót', async ({ page }) => {
    test.setTimeout(90_000);
    await open(page);
    await expectState(page, 'm-start');
    await tapLL(page, ...RYNEK);
    await expectState(page, 'm-peek');
    await swipePanel(page, -120);
    await expectState(page, 'm-full');
    await swipePanel(page, 120);
    await expectState(page, 'm-peek-again');
    await page.locator('[data-ptab="linie"]').click();
    await settle(page);
    await expectState(page, 'm-tab-linie');
    await page.locator('#m-back').click();
    await settle(page);
    await page.locator('#m-back').click({ timeout: 2000 }).catch(() => {});
    await settle(page);
    expect(await page.evaluate(() => location.hash)).toBe('');
    await expectState(page, 'm-closed');
  });

  test('przystanek: linia z tablicy odjazdów', async ({ page }) => {
    await open(page, `s=${RONDO_MOGILSKIE}`);
    await expectState(page, 'm-stop');
    await page.locator('.dep-row').first().click();
    await settle(page);
    await expectState(page, 'm-line-peek');
    await page.locator('#m-back').click();
    await settle(page);
    await expectState(page, 'm-line-back');
  });

  test('zasięg z Rynku do 40 min', async ({ page }) => {
    await open(page, `p=${p(RYNEK)}&r=500`);
    await page.locator('.iso-chip [data-chip="on"]').click();
    await settle(page);
    for (let i = 0; i < 4; i++) { await page.locator('.iso-chip [data-chip="+"]').click(); await settle(page); }
    expect(await page.evaluate(() => location.hash)).toContain('iso=40');
    await expectState(page, 'm-iso-40');
    const map = await page.locator('#map').boundingBox();
    const pt = await pagePoint(page, 50.0300, 19.9300);
    await page.touchscreen.tap(Math.min(pt.x, map.width - 40), Math.min(pt.y, 300));
    await settle(page);
    await expectState(page, 'm-iso-target');
    await page.locator('.m-search').click();
    await settle(page);
    await expectState(page, 'm-search-open');
  });

  test('wyszukiwarka i lokalizacja na telefonie', async ({ page }) => {
    await open(page);
    await page.locator('#sr-input').fill('Karmelicka');
    await settle(page);
    await expectState(page, 'm-search-list');
    await page.locator('.sr-it').first().click();
    await settle(page);
    await expectState(page, 'm-search-chosen');
  });

  test('mały ekran 360×640 i zmiana szerokości', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await open(page, `p=${p(RYNEK)}&r=500`);
    await expectState(page, 'm-small');
    await page.setViewportSize({ width: 1100, height: 800 });
    await settle(page);
    await expectState(page, 'm-to-desktop');
  });
});
