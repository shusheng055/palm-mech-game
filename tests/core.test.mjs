import test from 'node:test';
import assert from 'node:assert/strict';
import { extendLine, pathLength, purchaseInjection, replacementReward, scoreLines, unionMasks, visibleLength } from '../src/game.js';
import { decodeLogits, skeletonize, traceMask } from '../src/trace.js';

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
  assert.deepEqual([...unionMasks([a, b], 2)], [1, 1, 1, 0]);
  assert.deepEqual(replacementReward(a, b, 100), { newArea: 1, money: 1 });
  assert.deepEqual(replacementReward(a, a, 100), { newArea: 0, money: 0 });
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
