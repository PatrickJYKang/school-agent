/** Isolated fixture for the actual trusted Playwright guard. No personal data or model. */
const assert = require('node:assert/strict');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { chromium } = require('playwright');
const initialize = require('./guard.cjs').default;

void (async () => {
  const directory = await mkdtemp('/tmp/browser-guard-fixture-');
  process.env.SCHOOL_BROWSER_POLICY_FILE = directory + '/policy.json';
  await writeFile(process.env.SCHOOL_BROWSER_POLICY_FILE, JSON.stringify({ enabled: true }));
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    proxy: { server: 'http://proxy:4750', bypass: '<-loopback>' },
    env: {
      HOME: directory,
      TMPDIR: directory,
      PATH: process.env.PATH,
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
    },
  });
  const checks = {};
  try {
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
    const page = await context.newPage();
    await initialize({ page });
    await page.setContent('<title>Synthetic public-browser guard fixture</title><p>Fixture</p>');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const failed = page.waitForEvent('requestfailed');
      await page.evaluate(async (method) => {
        try {
          await fetch('https://demo.playwright.dev/synthetic-browser-guard', {
            method,
            body: 'synthetic test data',
          });
        } catch {
          /* Expected guard denial. */
        }
      }, method);
      assert.match((await failed).failure().errorText, /BLOCKED_BY_CLIENT/);
    }
    checks.mutatingMethodsBlocked = true;
    const denied = page.waitForEvent('requestfailed');
    await page.evaluate(async () => {
      try {
        await fetch('http://127.0.0.1:3118/session');
      } catch {
        /* Expected guard denial. */
      }
    });
    assert.match((await denied).failure().errorText, /BLOCKED_BY_CLIENT/);
    checks.privateSubresourcesBlocked = true;
    const websocket = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const socket = new WebSocket('wss://demo.playwright.dev/');
          socket.onopen = () => resolve('opened');
          socket.onclose = () => resolve('closed');
          socket.onerror = () => resolve('closed');
          setTimeout(() => resolve('timeout'), 3000);
        }),
    );
    assert.equal(websocket, 'closed');
    checks.websocketsBlocked = true;
    const popupEvent = page.waitForEvent('popup');
    await page.evaluate(() => {
      window.open('https://demo.playwright.dev/');
    });
    const popup = await popupEvent;
    if (!popup.isClosed()) await popup.waitForEvent('close');
    assert.equal(context.pages().length, 1);
    checks.popupsClosed = true;
    const downloadEvent = page.waitForEvent('download');
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'data:text/plain,synthetic';
      a.download = 'synthetic.txt';
      document.body.append(a);
      a.click();
    });
    assert.ok(await (await downloadEvent).failure());
    checks.downloadsCancelled = true;
    console.log(JSON.stringify(checks));
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
})().catch(() => {
  console.error('Browser guard fixture failed; no private diagnostics were printed.');
  process.exitCode = 1;
});
