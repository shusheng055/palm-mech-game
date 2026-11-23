import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/palm.png');

async function recognize(page, file = fixture) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload Photo', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('score')).toHaveText(/^\d+$/);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function installPart(page) {
  // Among three distinct offers at least one has an opaque centre.
  await page.getByRole('button', { name: /Armor Plate|Joint Bracket|Prong Frame/ }).first().click();
  const target = await page.locator('.line-layer').evaluate(canvas => {
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, 512, 512);
    const points = [];
    for (let y = 60; y < 450; y++) for (let x = 60; x < 450; x++) {
      const i = (y * 512 + x) * 4;
      if (data[i + 3] > 230 && data[i] < 40) points.push([x, y]);
    }
    return points[Math.floor(points.length / 2)];
  });
  const box = await page.getByTestId('stage').boundingBox();
  await page.getByTestId('stage').click({ position: { x: target[0] * box.width / 512, y: target[1] * box.height / 512 } });
  const previewScore = await page.getByTestId('score').innerText();
  const button = page.getByRole('button', { name: /Install \+¥/ });
  const reward = Number((await button.innerText()).match(/¥(\d+)/)[1]);
  await button.click();
  await expect(page.getByTestId('money')).toHaveText(`¥${reward}`);
  await expect(page.getByTestId('score')).toHaveText(previewScore);
  return { reward, target };
}

test('real local inference, mechanical occlusion, payment, injection, photo reset and mobile layout', async ({ page }) => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4173/')) external.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Palm Modification');
  expect(await page.locator('html').getAttribute('lang')).toBe('en');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Buy Injection (¥80)' })).toBeDisabled();
  await recognize(page);
  const initial = Number(await page.getByTestId('score').innerText());
  expect(initial).toBeGreaterThan(1000);
  for (let i = 0; i < 3; i++) expect(parseFloat(await page.getByTestId(`length-${i}`).innerText())).toBeGreaterThan(45);
  const { reward, target } = await installPart(page);
  expect(reward).toBeGreaterThanOrEqual(80);
  expect(Number(await page.getByTestId('score').innerText())).toBeLessThan(initial);
  const layering = await page.evaluate(([x, y]) => {
    const photo = document.querySelector('.photo-layer'), lines = document.querySelector('.line-layer'), mech = document.querySelector('.part-layer');
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.canvas.width = ctx.canvas.height = 512;
    for (const layer of [photo, lines, mech]) ctx.drawImage(layer, 0, 0);
    return {
      z: [photo, lines, mech].map(el => getComputedStyle(el).zIndex),
      lineAlpha: lines.getContext('2d').getImageData(x, y, 1, 1).data[3],
      top: [...mech.getContext('2d').getImageData(x, y, 1, 1).data],
      composed: [...ctx.getImageData(x, y, 1, 1).data],
    };
  }, target);
  expect(layering.z).toEqual(['0', '1', '2']);
  expect(layering.lineAlpha).toBeGreaterThan(0);
  expect(layering.top[3]).toBe(255);
  expect(layering.composed).toEqual(layering.top);
  const before = parseFloat(await page.locator('tbody tr').first().locator('td').first().innerText());
  await page.getByRole('button', { name: 'Buy Injection (¥80)' }).click();
  await expect(page.getByTestId('money')).toHaveText(`¥${reward - 80}`);
  const after = parseFloat(await page.locator('tbody tr').first().locator('td').first().innerText());
  expect(after - before).toBeCloseTo(24, 0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Choose Line', { exact: true }).selectOption('1');
  await recognize(page);
  await expect(page.getByTestId('money')).toHaveText('¥0');
  await expect(page.getByTestId('score')).toHaveText(String(initial));
  expect(await page.locator('.part-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 512).data.some(value => value > 0))).toBe(false);
  await expect(page.getByLabel('Choose Line', { exact: true })).toHaveValue('0');
  await expect(page.locator('.offers button')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('a real ONNX rejection leaves no invented lines or score', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Upload Photo', { exact: true }).setInputFiles(path.resolve('tests/fixtures/rejected-palm.png'));
  await expect(page.getByRole('alert')).toContainText('Unable to detect: Heart Line, Head Line, Life Line');
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.locator('.offers button')).toHaveCount(0);
  expect(await page.locator('.line-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 512).data.some(value => value > 0))).toBe(false);
});

test('mechanical reward depends on newly covered palm pixels, including zero outside', async ({ page }) => {
  await page.goto('/');
  await recognize(page);
  const startingScore = await page.getByTestId('score').innerText();
  await page.locator('.offers button').first().click();
  const stage = page.getByTestId('stage');
  const box = await stage.boundingBox();
  const move = (x, y) => stage.click({ position: { x: x * box.width / 512, y: y * box.height / 512 } });
  const install = page.getByRole('button', { name: /Install \+¥/ });
  const amount = async () => Number((await install.innerText()).match(/¥(\d+)/)[1]);
  const area = async () => Number((await page.locator('.placement small').innerText()).replace(/[^0-9]/g, ''));

  // The normalized test photo's palm starts below y=210.
  await move(86, 86);
  await expect(install).toHaveText('Install +¥0');
  await expect(page.locator('.placement small')).toHaveText('0 px²');
  await expect(page.getByTestId('score')).toHaveText(startingScore);
  await move(276, 215);
  await expect.poll(amount).toBeGreaterThan(0);
  const partialMoney = await amount(), partialArea = await area();
  await move(276, 333);
  await expect.poll(amount).toBeGreaterThan(partialMoney);
  expect(await area()).toBeGreaterThan(partialArea);
  await expect(page.getByTestId('money')).toHaveText('¥0');

  // A player can still install an off-palm part, but receives no cash.
  await move(86, 86);
  await expect(install).toHaveText('Install +¥0');
  await expect(install).toBeEnabled();
  await install.click();
  await expect(page.getByTestId('money')).toHaveText('¥0');
  await expect(page.locator('.offers button')).toHaveCount(2);
  expect(await page.locator('.part-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 512).data.some((value, i) => i % 4 === 3 && value > 0))).toBe(true);

  // A second part on the palm pays exactly the previewed amount.
  await page.locator('.offers button').first().click();
  await move(276, 333);
  await expect.poll(amount).toBeGreaterThan(0);
  const earned = await amount();
  await install.click();
  await expect(page.getByTestId('money')).toHaveText(`¥${earned}`);
});

test('missing model reports HTTP 404 and never enables gameplay', async ({ page }) => {
  await page.route('**/models/student_fp16.onnx', route => route.fulfill({ status: 404, body: 'Missing model' }));
  await page.goto('/');
  await page.getByLabel('Upload Photo', { exact: true }).setInputFiles(fixture);
  await expect(page.getByRole('alert')).toContainText('ONNX model unavailable (HTTP 404)');
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Buy Injection (¥80)' })).toBeDisabled();
  await page.unroute('**/models/student_fp16.onnx');
  await recognize(page); // Retrying after a transient model error really recovers.
});

test('camera capture uses the real model and resets previous modifications', async ({ page }) => {
  await page.goto('/');
  await recognize(page);
  const initial = await page.getByTestId('score').innerText();
  await installPart(page);
  await page.getByRole('button', { name: 'Open Camera', exact: true }).click();
  const video = page.getByLabel('Camera Feed', { exact: true });
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Take Photo' }).click();
  await expect(video).toHaveCount(0);
  await expect(page.getByTestId('score')).toHaveText(/^\d+$/);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('money')).toHaveText('¥0');
  await expect(page.locator('.offers button')).toHaveCount(3);
  expect(Number(await page.getByTestId('score').innerText())).toBeGreaterThan(1000);
  expect(Number(initial)).toBeGreaterThan(1000);
});

test('camera permission denial gives an actionable error', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Test permission denial', 'NotAllowedError'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Camera', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Camera access denied');
  await expect(page.getByRole('button', { name: 'Open Camera', exact: true })).toBeEnabled();
});
