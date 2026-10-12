import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const page = await browser.newPage({viewport: {width: 1536, height: 690}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });

async function run() {
  await page.getByRole('button', {name: /Run A\* search/}).click();
  await page.waitForFunction(() => document.querySelector('#verified')?.textContent?.includes('agree'));
  const layout = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    mapHeight: document.querySelector('.map-frame').getBoundingClientRect().height,
    mapBottom: document.querySelector('.map-frame').getBoundingClientRect().bottom,
    inputsBottom: document.querySelector('.inputs').getBoundingClientRect().bottom,
    algorithmBottom: document.querySelector('.algorithm').getBoundingClientRect().bottom,
    evidenceBottom: document.querySelector('.evidence').getBoundingClientRect().bottom,
  }));
  assert.ok(layout.pageHeight <= layout.viewportHeight + 1, JSON.stringify(layout));
  assert.ok(layout.mapHeight > 300, JSON.stringify(layout));
  assert.ok(Math.max(layout.mapBottom, layout.inputsBottom, layout.algorithmBottom, layout.evidenceBottom) <= layout.viewportHeight + 1, JSON.stringify(layout));
}

try {
  await page.goto('http://127.0.0.1:8000', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => document.querySelector('#verified')?.textContent?.includes('agree'));
  assert.deepEqual(await page.locator('#route-path .route-stop').allInnerTexts(), ['A', 'B', 'C', 'D']);
  assert.equal(await page.locator('#astar-time').innerText(), await page.locator('#dijkstra-time').innerText());
  await page.screenshot({path: 'demo-screenshot.png', fullPage: true});
  assert.equal(await page.locator('.masthead').count(), 0);
  assert.equal(await page.locator('#vehicle-focus').count(), 0);
  assert.equal(await page.locator('#neighbor-list .candidate-card').count(), 3);
  assert.equal(await page.locator('.map-node-label').count(), 14);
  assert.deepEqual((await page.locator('.map-node-label b').allInnerTexts()).sort(), 'ABCDEFGHIJKLMN'.split(''));
  assert.equal(await page.locator('.map-node-label[hidden]').count(), 0);
  const labelOverlap = await page.locator('.map-node-label').evaluateAll((labels) => {
    const rectangles = labels.map((label) => label.getBoundingClientRect());
    return rectangles.some((a, i) => rectangles.slice(i + 1).some((b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  });
  assert.equal(labelOverlap, false, 'Map node labels overlap');
  assert.deepEqual(await page.locator('#start option').allInnerTexts(), 'ABCDEFGHIJKLMN'.split(''));
  assert.equal(await page.locator('#start').locator('option:checked').innerText(), 'A');
  assert.equal(await page.locator('#goal').locator('option:checked').innerText(), 'D');
  assert.match(await page.locator('#neighbor-list .candidate-card').first().innerText(), /→ B/);
  assert.match(await page.locator('#neighbor-list .candidate-card').first().innerText(), /h to D\s+3\.6 min/);
  assert.match(await page.locator('#next-reason').innerText(), /Next: B.*f 4\.6/);
  assert.equal(await page.locator('#frontier-list .waiting-row').count(), 3);
  assert.match(await page.locator('#frontier-list').innerText(), /E.*I/s);
  await page.locator('.heuristic-detail summary').click();
  assert.match(await page.locator('#heuristic-working').innerText(), /km ÷ 15 km\/h/);
  await page.locator('.heuristic-detail summary').click();
  assert.match(await page.locator('#map-stage').innerText(), /SEARCH 1\/11.*A/);
  assert.equal(await page.locator('.edge-cost').count(), 0);
  const mapWidth = await page.locator('.simulation').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(mapWidth >= 450 && mapWidth <= 520, `map width ${mapWidth}`);
  const comparisonPage = await browser.newPage({viewport: {width: 1536, height: 830}, deviceScaleFactor: 1});
  comparisonPage.on('pageerror', (error) => errors.push(error.message));
  comparisonPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  comparisonPage.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await comparisonPage.goto(`http://127.0.0.1:8000${await page.locator('#compare-link').getAttribute('href')}`, {waitUntil: 'networkidle'});
  await comparisonPage.waitForFunction(() => document.querySelector('#trip-label')?.textContent?.includes('A → D'));
  assert.equal(await comparisonPage.locator('#astar-map .node').count(), 14);
  assert.equal(await comparisonPage.locator('#dijkstra-map .node').count(), 14);
  assert.match(await comparisonPage.locator('#astar-count').innerText(), /1\/11/);
  assert.match(await comparisonPage.locator('#dijkstra-count').innerText(), /1\/14/);
  await comparisonPage.screenshot({path: 'comparison-qa.png', fullPage: true});
  await comparisonPage.locator('#step').evaluate((element) => { element.value = element.max; element.dispatchEvent(new Event('input', {bubbles: true})); });
  assert.match(await comparisonPage.locator('#astar-path').innerText(), /A → B → C → D/);
  assert.match(await comparisonPage.locator('#dijkstra-count').innerText(), /14\/14/);
  await Promise.all([
    comparisonPage.waitForURL(/departure=08%3A30/),
    comparisonPage.getByRole('button', {name: '08:30'}).click(),
  ]);
  await comparisonPage.waitForFunction(() => document.querySelector('#crossing-values')?.textContent?.includes('15.5 min'));
  assert.match(await comparisonPage.locator('#crossing-values').innerText(), /1\.39 km.*15\.5 min.*1\.72 km.*12\.5 min/s);
  await comparisonPage.locator('#step').evaluate((element) => { element.value = element.max; element.dispatchEvent(new Event('input', {bubbles: true})); });
  assert.match(await comparisonPage.locator('#astar-path').innerText(), /A → E → F → G → H → D/);
  await comparisonPage.screenshot({path: 'comparison-morning-qa.png', fullPage: true});
  await comparisonPage.setViewportSize({width: 390, height: 844});
  assert.ok(await comparisonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await comparisonPage.close();
  await page.setViewportSize({width: 1366, height: 650});
  const compact = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
    panelBottom: document.querySelector('.algorithm').getBoundingClientRect().bottom,
  }));
  assert.ok(compact.scrollHeight <= compact.viewportHeight + 1, JSON.stringify(compact));
  await page.setViewportSize({width: 390, height: 844});
  const mobile = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    mapHeight: document.querySelector('.map-frame').getBoundingClientRect().height,
  }));
  assert.ok(mobile.scrollWidth <= mobile.viewportWidth + 1, JSON.stringify(mobile));
  assert.ok(mobile.mapHeight > 300, JSON.stringify(mobile));
  await page.setViewportSize({width: 1536, height: 690});

  await page.locator('#show-final').click();
  await page.screenshot({path: 'final-route-qa.png'});
  assert.match(await page.locator('#map-stage').innerText(), /FASTEST · A → D/);
  assert.equal(await page.locator('#step-node').innerText(), 'D');
  assert.equal(await page.locator('.edge-cost-route').count(), 0);
  await page.getByRole('button', {name: /Previous expansion/}).click();
  assert.match(await page.locator('#map-stage').innerText(), /SEARCH 11\/11/);
  await page.locator('.jump-steps summary').click();
  await page.locator('#trace-list button').first().click();

  await page.getByRole('button', {name: /Next expansion/}).click();
  await page.screenshot({path: 'second-step-qa.png'});
  assert.match(await page.locator('#step-count').innerText(), /2 OF/);
  assert.match(await page.locator('#neighbor-summary').innerText(), /connected roads/);
  assert.match(await page.locator('#next-reason').innerText(), /Next: E.*found earlier from A/);
  assert.match(await page.locator('#frontier-list .waiting-row').first().innerText(), /E\s+via A/);
  await page.locator('#trace-list button').nth(9).click();
  await page.locator('#play-search').click();
  await page.waitForFunction(() => document.querySelector('#map-stage')?.textContent?.includes('FASTEST'), {timeout: 5000});
  assert.equal(await page.locator('#step-node').innerText(), 'D');
  await page.locator('#view-source').click();
  await page.waitForFunction(() => document.querySelector('#source-code')?.textContent?.includes('def _search('));
  assert.match(await page.locator('#source-code').innerText(), /def _search\(/);
  await page.locator('#close-source').click();

  await page.locator('.reliability summary').click();
  await page.locator('#show-reliable').click();
  assert.match(await page.locator('#playback-label').innerText(), /A/);
  await page.locator('#departure').fill('08:30');
  await run();
  assert.deepEqual(await page.locator('#route-path .route-stop').allInnerTexts(), ['A', 'E', 'F', 'G', 'H', 'D']);

  await page.locator('#departure').fill('12:00');
  await page.locator('#close-west').check();
  await run();
  assert.deepEqual(await page.locator('#route-path .route-stop').allInnerTexts(), ['A', 'E', 'F', 'G', 'H', 'D']);

  await page.locator('#close-east').check();
  await page.getByRole('button', {name: /Run A\* search/}).click();
  await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('No route'));
  assert.equal(await page.locator('#verified').innerText(), 'No reachable route');
  assert.ok(Number(await page.locator('#astar-nodes').innerText()) > 1);
  assert.match(await page.locator('#step-count').innerText(), /OF/);
  await page.locator('.jump-steps summary').click();
  await page.locator('#trace-list button').filter({hasText: 'B'}).click();
  assert.match(await page.locator('#neighbor-list').innerText(), /CLOSED/);
  await page.locator('#trace-list button').last().click();
  assert.equal(await page.locator('#frontier-next').innerText(), 'Queue empty');

  await page.locator('#goal').selectOption('I');
  await run();
  assert.equal((await page.locator('#route-path .route-stop').allInnerTexts()).at(-1), 'I');
  assert.match(await page.locator('#verified').innerText(), /agree/);
  await page.locator('#goal').selectOption('D');

  await page.locator('#close-west').uncheck();
  await page.locator('#close-east').uncheck();
  await page.locator('#seed').fill('42');
  await run();
  assert.equal(await page.locator('#seed').inputValue(), '42');
  assert.match(await page.locator('#verified').innerText(), /agree/);
  await page.locator('#start').selectOption('B');
  await page.locator('#goal').selectOption('G');
  await run();
  const junctionRoute = await page.locator('#route-path .route-stop').allInnerTexts();
  assert.equal(junctionRoute[0], 'B');
  assert.equal(junctionRoute.at(-1), 'G');
  assert.equal((await page.request.get('http://127.0.0.1:8000/api/graph?seed=100000')).status(), 400);
  assert.equal((await page.request.get('http://127.0.0.1:8000/api/route?start=Unknown&goal=D')).status(), 400);
  console.log('Browser scenarios passed: default, trace, source, reliability, morning, closures, disconnected, new seed.');
  assert.deepEqual(errors.filter((item) => !item.startsWith('400 ')), []);
} finally {
  await browser.close();
}
