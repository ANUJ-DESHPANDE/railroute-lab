import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });

async function run() {
  await page.getByRole('button', {name: /Run A\* search/}).click();
  await page.waitForFunction(() => document.querySelector('#verified')?.textContent?.includes('agree'));
}

try {
  await page.goto('http://127.0.0.1:8000', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => document.querySelector('#verified')?.textContent?.includes('agree'));
  assert.match(await page.locator('#route-path').innerText(), /West Tunnel/);
  assert.equal(await page.locator('#astar-time').innerText(), await page.locator('#dijkstra-time').innerText());
  await page.screenshot({path: 'demo-screenshot.png', fullPage: true});

  await page.getByRole('button', {name: /Next expansion/}).click();
  assert.match(await page.locator('#step-count').innerText(), /2 OF/);
  await page.locator('#view-source').click();
  await page.waitForFunction(() => document.querySelector('#source-code')?.textContent?.includes('def _search('));
  assert.match(await page.locator('#source-code').innerText(), /def _search\(/);
  await page.locator('#close-source').click();

  await page.locator('.reliability summary').click();
  await page.locator('#show-reliable').click();
  assert.match(await page.locator('#playback-label').innerText(), /Science Hall/);
  await page.locator('#departure').fill('08:30');
  await run();
  assert.match(await page.locator('#route-path').innerText(), /East Tunnel/);

  await page.locator('#departure').fill('12:00');
  await page.locator('#close-west').check();
  await run();
  assert.match(await page.locator('#route-path').innerText(), /East Tunnel/);

  await page.locator('#close-east').check();
  await page.getByRole('button', {name: /Run A\* search/}).click();
  await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('No route'));
  assert.equal(await page.locator('#verified').innerText(), 'No reachable route');
  assert.ok(Number(await page.locator('#astar-nodes').innerText()) > 1);
  assert.match(await page.locator('#step-count').innerText(), /OF/);

  await page.locator('#goal').selectOption('Design Studio');
  await run();
  assert.match(await page.locator('#route-path').innerText(), /Design Studio/);
  assert.match(await page.locator('#verified').innerText(), /agree/);
  await page.locator('#goal').selectOption('North Library');

  await page.locator('#close-west').uncheck();
  await page.locator('#close-east').uncheck();
  await page.locator('#seed').fill('42');
  await run();
  assert.equal(await page.locator('#seed').inputValue(), '42');
  assert.match(await page.locator('#verified').innerText(), /agree/);
  assert.equal((await page.request.get('http://127.0.0.1:8000/api/graph?seed=100000')).status(), 400);
  assert.equal((await page.request.get('http://127.0.0.1:8000/api/route?start=Unknown&goal=North%20Library')).status(), 400);
  console.log('Browser scenarios passed: default, trace, source, reliability, morning, closures, disconnected, new seed.');
  assert.deepEqual(errors.filter((item) => !item.startsWith('400 ')), []);
} finally {
  await browser.close();
}
