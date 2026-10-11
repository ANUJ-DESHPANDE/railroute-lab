import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const page = await browser.newPage({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1});
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {if (message.type() === 'error') errors.push(message.text());});
page.on('response', (response) => {if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);});
try {
  await page.goto('http://127.0.0.1:8000', {waitUntil: 'networkidle'});
  await page.waitForFunction(() => document.querySelector('#eta')?.textContent !== '—');
  console.log('initial ETA', await page.locator('#eta').innerText());
  console.log('initial route', await page.locator('#route-name').innerText());
  assert.match(await page.locator('#steps').innerText(), /West Tunnel/);
  await page.screenshot({path: 'demo-screenshot.png', fullPage: true});
  await page.getByRole('button', {name: /Reliable/}).click();
  console.log('reliable route', await page.locator('#route-name').innerText());
  assert.match(await page.locator('#steps').innerText(), /East Tunnel/);
  await page.locator('#departure').fill('08:30');
  await page.getByRole('button', {name: /CALCULATE ROUTE/}).click();
  await page.waitForFunction(() => document.querySelector('#period-pill')?.textContent === 'MORNING PEAK');
  console.log('morning route', await page.locator('#route-name').innerText());
  assert.match(await page.locator('#steps').innerText(), /East Tunnel/);
  await page.getByRole('button', {name: /Fastest/}).click();
  await page.locator('#departure').fill('12:00');
  await page.getByText('West rail underpass').click();
  assert.equal(await page.locator('#close-west').isChecked(), true);
  await page.getByRole('button', {name: /CALCULATE ROUTE/}).click();
  await page.waitForFunction(() => document.querySelector('#period-pill')?.textContent === 'OFF PEAK');
  assert.match(await page.locator('#steps').innerText(), /East Tunnel/);
  await page.getByText('East rail underpass').click();
  assert.equal(await page.locator('#close-east').isChecked(), true);
  await page.getByRole('button', {name: /CALCULATE ROUTE/}).click();
  await page.waitForFunction(() => document.querySelector('#error')?.textContent?.includes('No route'));
  console.log('closed-both message', await page.locator('#error').innerText());
  assert.equal(await page.locator('#eta').innerText(), '—');
  console.log('page errors', errors);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
