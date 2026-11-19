import { LINE_NAMES, pathLength } from './game.js';

const OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function neighbors(index, pixels, size) {
  const x = index % size;
  const y = Math.floor(index / size);
  const found = [];
  for (const [dx, dy] of OFFSETS) {
    if (x + dx < 0 || x + dx >= size || y + dy < 0 || y + dy >= size) continue;
    const next = (y + dy) * size + x + dx;
    if (pixels[next]) found.push(next);
  }
  return found;
}

function largestComponent(binary, size) {
  const seen = new Uint8Array(binary.length);
  let largest = [];
  for (let i = 0; i < binary.length; i++) {
    if (!binary[i] || seen[i]) continue;
    const component = [i];
    seen[i] = 1;
    for (let head = 0; head < component.length; head++) {
      for (const next of neighbors(component[head], binary, size)) {
        if (seen[next]) continue;
        seen[next] = 1;
        component.push(next);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const result = new Uint8Array(binary.length);
  for (const index of largest) result[index] = 1;
  return { binary: result, count: largest.length };
}

// Zhang–Suen thinning measures a centre line, not the area of a thick mask.
export function skeletonize(source, size) {
  const pixels = source.slice();
  let changed = true;
  let iterations = 0;
  while (changed && iterations++ < size) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove = [];
      for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (!pixels[i]) continue;
        const p = [pixels[i - size], pixels[i - size + 1], pixels[i + 1], pixels[i + size + 1], pixels[i + size], pixels[i + size - 1], pixels[i - 1], pixels[i - size - 1]];
        const count = p.reduce((a, b) => a + b, 0);
        if (count < 2 || count > 6) continue;
        const transitions = p.reduce((sum, value, k) => sum + (!value && p[(k + 1) % 8] ? 1 : 0), 0);
        if (transitions !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        remove.push(i);
      }
      if (remove.length) changed = true;
      for (const i of remove) pixels[i] = 0;
    }
  }
  return pixels;
}

// Weighted geodesic sweep. The path only visits actual skeleton pixels;
// disconnected predictions are never bridged with invented line segments.
function farthest(start, skeleton, size) {
  const distance = new Float64Array(skeleton.length).fill(Infinity);
  const parent = new Int32Array(skeleton.length).fill(-1);
  const heap = [[0, start]];
  distance[start] = 0;
  let end = start;
  function push(item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= item[0]) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = item;
  }
  function pop() {
    const first = heap[0];
    const tail = heap.pop();
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][0] < heap[child][0]) child++;
        if (heap[child][0] >= tail[0]) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return first;
  }
  while (heap.length) {
    const [d, i] = pop();
    if (d !== distance[i]) continue;
    if (d > distance[end]) end = i;
    for (const next of neighbors(i, skeleton, size)) {
      const diagonal = next % size !== i % size && Math.floor(next / size) !== Math.floor(i / size);
      const candidate = d + (diagonal ? Math.SQRT2 : 1);
      if (candidate >= distance[next]) continue;
      distance[next] = candidate;
      parent[next] = i;
      push([candidate, next]);
    }
  }
  const path = [];
  for (let i = end; i !== -1; i = parent[i]) path.push([i % size, Math.floor(i / size)]);
  return { end, path: path.reverse() };
}

export function traceMask(mask, probabilities, size = 512) {
  const lines = [];
  const missing = [];
  for (let classId = 1; classId <= 3; classId++) {
    const raw = Uint8Array.from(mask, (value, i) => value === classId && probabilities[i] >= 0.55 ? 1 : 0);
    const component = largestComponent(raw, size);
    const skeleton = skeletonize(component.binary, size);
    const start = skeleton.indexOf(1);
    const points = start < 0 ? [] : farthest(farthest(start, skeleton, size).end, skeleton, size).path;
    const confidence = points.length ? points.reduce((sum, [x, y]) => sum + probabilities[y * size + x], 0) / points.length : 0;
    if (component.count < 60 || pathLength(points) < 45 || confidence < 0.6) {
      missing.push(LINE_NAMES[classId - 1]);
    } else lines.push({ classId, name: LINE_NAMES[classId - 1], points, confidence });
  }
  if (missing.length) throw new Error(`未可靠识别：${missing.join('、')}。`);
  return lines;
}

export function decodeLogits(logits, size = 512) {
  const plane = size * size;
  if (logits.length !== 4 * plane) throw new Error('模型输出尺寸不正确。');
  const mask = new Uint8Array(plane);
  const probabilities = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    let best = 0;
    for (let c = 1; c < 4; c++) if (logits[c * plane + i] > logits[best * plane + i]) best = c;
    const maximum = logits[best * plane + i];
    if (!Number.isFinite(maximum)) throw new Error('模型输出无效。');
    let sum = 0;
    for (let c = 0; c < 4; c++) sum += Math.exp(logits[c * plane + i] - maximum);
    mask[i] = best;
    probabilities[i] = 1 / sum;
  }
  return { mask, probabilities };
}
