/**
 * Smoke test against live Google Maps with the unpacked extension loaded.
 *   npm run build && npm run e2e
 * Set PW_CHROMIUM_PATH to use a specific Chromium build. Screenshots go to test-results/.
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT = resolve('.output/chrome-mv3');
let ctx: BrowserContext;

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'maps-plus-')), {
    headless: !process.env.HEADED,
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--lang=en-US',
      // Software WebGL so Maps can render the vector map headlessly.
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
});
test.afterAll(async () => ctx?.close());

async function open(url: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('consent.google')) {
    await page
      .getByRole('button', { name: /reject all/i })
      .first()
      .click();
    await page.waitForURL(/google\.com\/maps/);
  }
  return page;
}

/** Text of the Pano Date pill (lives in an open shadow root). */
const pill = (page: Page) => page.locator('#maps-plus-pano-date').locator('button.pill');

test('pano date: button appears once and resolves a capture time', async () => {
  const page = await open(
    'https://www.google.com/maps/@40.7580033,-73.9855681,3a,75y,210.41h,90.32t/data=!3m7!1e1!3m5!1sywskIOsAFskiKHt5fwIUWA!2e0!6shttps:%2F%2Fstreetviewpixels-pa.googleapis.com!7i16384!8i8192?hl=en',
  );
  await expect(pill(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#maps-plus-pano-date')).toHaveCount(1);
  await expect(page.locator('#maps-plus-lasso-control')).toHaveCount(0); // no lasso in Street View
  await pill(page).click();
  await expect(pill(page)).toHaveAttribute('data-state', 'done', { timeout: 45_000 });
  const title = await pill(page).getAttribute('title');
  expect(title).toContain('2024-08');
  expect(title).toContain('America/New_York');
  await page.screenshot({ path: 'test-results/pano-date.png' });
});

test('lasso: captured places are selected and listed', async () => {
  const page = await open('https://www.google.com/maps/@48.8583701,2.2944813,16z?hl=en');
  const ctl = page.locator('#maps-plus-lasso-control').locator('button.btn');
  await expect(ctl).toBeVisible({ timeout: 30_000 });

  // Simulate the MAIN-world interceptor posting three saved places over the bridge.
  await page.evaluate(() => {
    window.postMessage(
      {
        channel: 'maps-plus:bridge:v1:7c1e2b',
        kind: 'saved-places',
        endpoint: '/maps/preview/entitylist/getlist',
        places: [
          {
            name: 'Eiffel Tower',
            lat: 48.8583701,
            lng: 2.2944813,
            lists: ['Paris'],
            note: '<b>not bold</b>',
          },
          { name: 'Trocadéro', lat: 48.8616, lng: 2.2893, lists: ['Paris'] },
          { name: 'Louvre (outside)', lat: 48.8606, lng: 2.3376, lists: ['Paris'] },
        ],
      },
      location.origin,
    );
  });
  await page.waitForTimeout(800);
  await ctl.click();
  const overlay = page.locator('#maps-plus-lasso-overlay canvas');
  await expect(overlay).toBeVisible();
  const box = (await overlay.boundingBox())!;
  // Circle from the map centre, 400 px radius at z16 (~630 m): catches the tower and Trocadéro
  // (~520 m / 333 px away) but not the Louvre (~3.1 km).
  // The URL centre is the centre of the full-window map container (verified 2026-11-13).
  const cx = 700;
  const cy = 450;
  expect(cx).toBeGreaterThan(box.x);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 5 });
  await page.mouse.move(cx + 400, cy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/lasso.png' });

  const panel = page.locator('#maps-plus-lasso-panel');
  await expect(panel.locator('h2')).toHaveText('2 saved places', { timeout: 10_000 });
  await expect(panel.locator('li .name')).toHaveText(['Eiffel Tower', 'Trocadéro']);
  await expect(panel.locator('.note')).toHaveText('<b>not bold</b>');

  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^maps-plus-paris-\d{4}-\d{2}-\d{2}\.csv$/);
});
