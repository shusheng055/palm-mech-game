import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/palm.png');

async function recognize(page, file = fixture) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传手掌照片', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByTestId('score')).toHaveText(/^\d+$/);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function installPart(page) {
  // Among three distinct offers at least one has an opaque centre.
  await page.getByRole('button', { name: /装甲板|关节支架|三叉骨架/ }).first().click();
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
  const button = page.getByRole('button', { name: /安装并获得/ });
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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('手相改造');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.getByRole('button', { name: '购买注射 · ¥80' })).toBeDisabled();
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
  await page.getByRole('button', { name: '购买注射 · ¥80' }).click();
  await expect(page.getByTestId('money')).toHaveText(`¥${reward - 80}`);
  const after = parseFloat(await page.locator('tbody tr').first().locator('td').first().innerText());
  expect(after - before).toBeCloseTo(24, 0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('选择掌纹', { exact: true }).selectOption('1');
  await recognize(page);
  await expect(page.getByTestId('money')).toHaveText('¥0');
  await expect(page.getByTestId('score')).toHaveText(String(initial));
  expect(await page.locator('.part-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 512).data.some(value => value > 0))).toBe(false);
  await expect(page.getByLabel('选择掌纹', { exact: true })).toHaveValue('0');
  await expect(page.locator('.offers button')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('a real ONNX rejection leaves no invented lines or score', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('上传手掌照片', { exact: true }).setInputFiles(path.resolve('tests/fixtures/rejected-palm.png'));
  await expect(page.getByRole('alert')).toContainText('未可靠识别：感情线、智慧线、生命线');
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.locator('.offers button')).toHaveCount(0);
  expect(await page.locator('.line-layer').evaluate(canvas => canvas.getContext('2d').getImageData(0, 0, 512, 512).data.some(value => value > 0))).toBe(false);
});

test('missing model reports HTTP 404 and never enables gameplay', async ({ page }) => {
  await page.route('**/models/student_fp16.onnx', route => route.fulfill({ status: 404, body: 'Missing model' }));
  await page.goto('/');
  await page.getByLabel('上传手掌照片', { exact: true }).setInputFiles(fixture);
  await expect(page.getByRole('alert')).toContainText('ONNX 模型无法获取（HTTP 404）');
  await expect(page.getByTestId('score')).toHaveText('—');
  await expect(page.getByRole('button', { name: '购买注射 · ¥80' })).toBeDisabled();
  await page.unroute('**/models/student_fp16.onnx');
  await recognize(page); // Retrying after a transient model error really recovers.
});

test('camera capture uses the real model and resets previous modifications', async ({ page }) => {
  await page.goto('/');
  await recognize(page);
  const initial = await page.getByTestId('score').innerText();
  await installPart(page);
  await page.getByRole('button', { name: '打开摄像头', exact: true }).click();
  const video = page.getByLabel('摄像头画面', { exact: true });
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: '拍照并识别' }).click();
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
  await page.getByRole('button', { name: '打开摄像头', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('摄像头权限被拒绝');
  await expect(page.getByRole('button', { name: '打开摄像头', exact: true })).toBeEnabled();
});
