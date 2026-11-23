import test from 'node:test';
import assert from 'node:assert/strict';
import { extendLine, pathLength, purchaseInjection, replacementReward, scoreLines, unionMasks, visibleLength } from '../src/game.js';
import { decodeLogits, skeletonize, traceMask } from '../src/trace.js';
import { palmOutline, polygonMask } from '../src/palm-region.js';

test('length measures line geometry rather than mask area', () => {
  assert.equal(pathLength([[0, 0], [3, 4], [6, 8]]), 10);
  assert.equal(visibleLength([[1, 5], [9, 5]], new Uint8Array(100), 10), 8);
});

test('covered line segments are excluded; transparent holes stay visible', () => {
  const mask = new Uint8Array(100);
  for (const x of [4, 5, 6]) mask[5 * 10 + x] = 1;
  assert.equal(visibleLength([[1, 5], [9, 5]], mask, 10), 5);
  const inverse = Uint8Array.from(mask, value => 1 - value);
  assert.equal(visibleLength([[1, 5], [9, 5]], inverse, 10), 3);
});

test('overlapping mechanical parts only pay for newly covered pixels', () => {
  const a = Uint8Array.from([1, 1, 0, 0]);
  const b = Uint8Array.from([0, 1, 1, 0]);
  const palm = Uint8Array.from([1, 1, 1, 1]);
  assert.deepEqual([...unionMasks([a, b], 2)], [1, 1, 1, 0]);
  assert.deepEqual(replacementReward(a, b, palm, 100), { newArea: 1, money: 1 });
  assert.deepEqual(replacementReward(a, a, palm, 100), { newArea: 0, money: 0 });
});

test('reward grows with newly covered palm area and is zero outside the palm', () => {
  const palm = Uint8Array.from([0, 1, 1, 1, 0, 0]);
  const empty = new Uint8Array(palm.length);
  const outside = Uint8Array.from([1, 0, 0, 0, 1, 1]);
  const partial = Uint8Array.from([1, 0, 1, 0, 1, 0]);
  const within = Uint8Array.from([0, 1, 1, 1, 0, 0]);
  const rate = 100;
  assert.deepEqual(replacementReward(empty, outside, palm, rate), { newArea: 0, money: 0 });
  assert.deepEqual(replacementReward(empty, partial, palm, rate), { newArea: 1, money: 1 });
  assert.deepEqual(replacementReward(empty, within, palm, rate), { newArea: 3, money: 3 });
  assert.deepEqual(replacementReward(partial, within, palm, rate), { newArea: 2, money: 2 });
});

test('palm outline includes the palm core but excludes fingers and background', () => {
  const points = Array.from({ length: 21 }, () => [256, 300]);
  Object.assign(points, {
    0: [256, 430], 2: [130, 350], 4: [55, 260],
    5: [185, 250], 8: [150, 70], 9: [245, 235], 12: [245, 40],
    13: [300, 245], 16: [320, 80], 17: [350, 265], 20: [410, 135],
  });
  const mask = polygonMask(palmOutline(points), 512);
  assert.equal(mask[340 * 512 + 256], 1);
  assert.equal(mask[100 * 512 + 245], 0);
  assert.equal(mask[350 * 512 + 40], 0);
  assert.equal(mask[475 * 512 + 256], 0);
  const mirrored = polygonMask(palmOutline(points.map(([x, y]) => [512 - x, y])), 512);
  let difference = 0;
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    if (mask[y * 512 + x] !== mirrored[y * 512 + (511 - x)]) difference++;
  }
  assert.ok(difference <= 4, 'The same palm must be eligible after mirroring.');
  assert.throws(() => palmOutline(Array.from({ length: 21 }, () => [0, 0])), /Palm area/);
});

test('polygon masks are clipped to the playable image', () => {
  const mask = polygonMask([[-2, -2], [3, -2], [3, 2], [-2, 2]], 4);
  assert.deepEqual([...mask], [1, 1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test('injection costs exactly 80 and adds 24 pixels to the selected line only', () => {
  const lines = [0, 1, 2].map(i => ({ points: [[100, 100 + i * 10], [140, 100 + i * 10]] }));
  const result = purchaseInjection(lines, 1, 120);
  assert.equal(result.ok, true);
  assert.equal(result.money, 40);
  assert.equal(pathLength(result.lines[1].points), 64);
  assert.equal(pathLength(lines[1].points), 40);
  assert.equal(result.lines[0], lines[0]);
  assert.equal(result.lines[2], lines[2]);
  assert.equal(purchaseInjection(lines, 0, 79).ok, false);
});

test('injected segments under machinery add no score', () => {
  const line = { points: [[100, 100], [140, 100]] };
  const changed = extendLine(line).line;
  const mask = new Uint8Array(512 * 512).fill(1);
  assert.equal(pathLength(changed.points), 64);
  assert.equal(scoreLines([changed], mask).total, 0);
});

test('injection respects the frame and does not charge a line with no room', () => {
  const edge = { points: [[1, 200], [510, 200]] };
  const result = purchaseInjection([edge], 0, 100);
  assert.equal(result.ok, false);
  assert.match(result.message, /No charge/);
  const near = extendLine({ points: [[500, 10], [509, 10]] });
  assert.equal(near.added, 24); // The opposite end has room.
  assert.ok(near.line.points.every(([x, y]) => x >= 1 && x <= 510 && y >= 1 && y <= 510));
});

function fixtureMask() {
  const size = 512;
  const mask = new Uint8Array(size * size);
  for (let c = 1; c <= 3; c++) for (let x = 100; x < 250; x++) for (let offset = -1; offset <= 1; offset++) mask[(c * 100 + offset) * size + x] = c;
  return { mask, probabilities: new Float32Array(size * size).fill(0.95) };
}

test('skeleton tracing returns three paths using predicted pixels only', () => {
  const { mask, probabilities } = fixtureMask();
  const lines = traceMask(mask, probabilities);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(pathLength(line.points) > 140 && pathLength(line.points) < 155);
    assert.ok(line.points.every(([x, y]) => mask[y * 512 + x] === line.classId));
  }
});

for (let missing = 1; missing <= 3; missing++) {
  test(`missing class ${missing} rejects the whole result with the exact line name`, () => {
    const { mask, probabilities } = fixtureMask();
    for (let i = 0; i < mask.length; i++) if (mask[i] === missing) mask[i] = 0;
    assert.throws(() => traceMask(mask, probabilities), new RegExp(['Heart Line', 'Head Line', 'Life Line'][missing - 1]));
  });
}

test('short disconnected fragments are not joined into an invented line', () => {
  const { mask, probabilities } = fixtureMask();
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) mask[i] = 0;
  for (const start of [50, 200, 350]) for (let x = start; x < start + 25; x++) mask[100 * 512 + x] = 1;
  assert.throws(() => traceMask(mask, probabilities), /Heart Line/);
});

test('low confidence, empty and non-finite outputs do not produce results', () => {
  const { mask, probabilities } = fixtureMask();
  assert.throws(() => traceMask(mask, probabilities.fill(.4)), /Unable to detect/);
  assert.throws(() => traceMask(new Uint8Array(mask.length), probabilities), /Heart Line, Head Line, Life Line/);
  assert.throws(() => decodeLogits(new Float32Array(16).fill(NaN), 2), /Invalid model output/);
  assert.throws(() => decodeLogits(new Float32Array(2), 2), /dimensions/);
  assert.deepEqual([...skeletonize(new Uint8Array(25), 5)], Array(25).fill(0));
});
