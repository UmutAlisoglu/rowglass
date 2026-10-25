const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const C = require('../src/core.js');

(async () => {
  const output = path.resolve('.qa'); await mkdir(output, { recursive: true });
  let server;
  const base = process.env.TEST_URL || 'http://127.0.0.1:8792/';
  if (!process.env.TEST_URL) {
    server = spawn(process.execPath, [path.resolve('scripts/serve.cjs')], { env: { ...process.env, PORT: '8792' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      server.stdout.once('data', resolve); server.once('error', reject); server.once('exit', code => reject(new Error(`Preview exited: ${code}`)));
    });
  }
  const browser = await chromium.launch({ ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}), headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const errors = [], network = [], writes = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function () { throw new Error('Unexpected storage write'); };
      void original;
    });
    context.on('request', request => {
      if (!/^(?:file:|data:|blob:)/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) network.push(request.url());
      if (request.method() !== 'GET') writes.push(request.method());
    });
    const page = await context.newPage();
    await page.goto(base);
    assert.equal(await page.locator('#compare').isDisabled(), true);
    for (const [sample, changed, added, removed, unchanged] of [['inventory',3,1,1,2],['prices',2,1,1,1],['parts',2,1,1,2],['contacts',2,1,1,1],['content',2,1,1,1]]) {
      await page.locator('#example').selectOption(sample); await page.locator('#load-example').click(); await page.locator('#compare').click();
      const counts = await page.locator('.stat strong').allTextContents(); assert.deepEqual(counts, [changed,added,removed,unchanged].map(String), sample);
    }
    console.log('PASS all five use-case examples produce correct counts.');
    await page.locator('#example').selectOption('inventory'); await page.locator('#load-example').click(); await page.locator('#compare').click();
    await page.getByRole('button', { name: 'Changed', exact: true }).click(); assert.equal(await page.locator('#result-table tbody tr').count(), 3);
    await page.locator('#search').fill('Notebook'); assert.equal(await page.locator('#result-table tbody tr').count(), 1);
    await page.locator('#result-table tbody button').click(); assert.equal(await page.locator('#row-dialog').isVisible(), true); assert.match(await page.locator('#row-dialog-body').innerText(), /Quantity[\s\S]*24[\s\S]*18/);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#row-dialog').isVisible(), false);
    await page.locator('#search').fill('');
    const download = async (selector, filename) => {
      const pending = page.waitForEvent('download'); await page.locator(selector).click(); const file = await pending;
      const destination = path.join(output, filename); await file.saveAs(destination); return destination;
    };
    const report = await download('#save-report', 'report.html');
    await page.locator('.export-more summary').click();
    const csv = await download('#save-csv', 'changes.csv'); const json = await download('#save-json', 'changes.json');
    assert.equal(JSON.parse(await readFile(json, 'utf8')).counts.changed, 3);
    assert.ok(C.parse(await readFile(csv, 'utf8')).rows.length > 5);
    const reportPage = await context.newPage(); await reportPage.goto(pathToFileURL(report).href);
    assert.equal(await reportPage.locator('tbody tr').count(), 5);
    assert.equal(await reportPage.locator('script').count(), 0);
    await reportPage.screenshot({ path: path.join(output, 'report.png'), fullPage: true }); await reportPage.close();
    console.log('PASS filters, search, row inspection, and real HTML/CSV/JSON downloads.');

    async function files(left, right) {
      await page.locator('#clear-all').click();
      await page.locator('#before-file').setInputFiles({ name: 'before.csv', mimeType: 'text/csv', buffer: Buffer.from(left) });
      await page.locator('#after-file').setInputFiles({ name: 'after.csv', mimeType: 'text/csv', buffer: Buffer.from(right) });
      await page.locator('#compare').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('#compare').disabled);
    }
    await files('ID,V\nA,1\nA,2', 'ID,V\nA,1'); await page.locator('#key-primary').selectOption('ID'); await page.locator('#compare').click();
    assert.match(await page.locator('#compare-error').innerText(), /share a matching value/); assert.equal(await page.locator('#results').isVisible(), false);
    await files('ID,Site,V\nA,East,1\nA,West,2', 'ID,Site,V\nA,West,3\nA,East,1');
    await page.locator('#key-primary').selectOption('ID'); await page.locator('#key-secondary').selectOption('Site'); await page.locator('#compare').click();
    assert.equal(await page.locator('.stat-changed strong').innerText(), '1');
    await files('ID,V\nA,old', 'ID,V\nA,<img src=x onerror=alert(1)>'); await page.locator('#compare').click();
    assert.equal(await page.locator('#result-table img').count(), 0); assert.match(await page.locator('#result-table').innerText(), /<img src=x/);
    const hostileReport = await download('#save-report', 'escaped-report.html');
    assert.doesNotMatch(await readFile(hostileReport, 'utf8'), /<img src=x/);
    await page.locator('#clear-all').click();
    assert.equal(await page.locator('#results').isVisible(), false); assert.equal(await page.locator('#result-table tbody tr').count(), 0);
    assert.equal(await page.locator('#before-paste').inputValue(), ''); assert.equal(await page.locator('#compare').isDisabled(), true);
    console.log('PASS real file inputs, duplicate-key errors, composite keys, safe rendering and clear session.');

    await page.locator('[data-side=before] .paste-option summary').click();
    await page.locator('#before-paste').fill('ID,V\n001, Alex '); await page.locator('[data-paste=before]').click();
    await page.locator('[data-side=after] .paste-option summary').click();
    await page.locator('#after-paste').fill('ID,V\n001,alex'); await page.locator('[data-paste=after]').click();
    await page.locator('.rules-panel summary').click(); await page.locator('#trim').check(); await page.locator('#ignore-case').check(); await page.locator('#compare').click();
    assert.equal(await page.locator('.stat-unchanged strong').innerText(), '1');
    assert.match(await page.locator('#empty-results').innerText(), /No row changes/);
    await page.locator('#trim').uncheck(); assert.equal(await page.locator('#results').isVisible(), false);
    console.log('PASS paste workflow, normalization, and stale-result invalidation.');

    for (const width of [1440, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(base);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `empty @${width}`);
      await page.locator('#load-example').click(); await page.locator('#compare').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `results @${width}`);
      await page.locator('#workspace').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `app-${width}.png`), fullPage: true });
    }
    const offline = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
    const offlinePage = await offline.newPage();
    await offlinePage.goto(pathToFileURL(path.resolve('dist/index.html')).href);
    await offlinePage.locator('#load-example').click(); await offlinePage.locator('#compare').click();
    assert.equal(await offlinePage.locator('.stat-changed strong').innerText(), '3');
    await offline.close();
    assert.deepEqual(errors, []); assert.deepEqual(network, []); assert.deepEqual(writes, []);
    console.log('PASS phone/tablet/desktop layouts, offline portable build, no external requests or storage writes.');
  } finally { await browser.close(); if (server) server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
