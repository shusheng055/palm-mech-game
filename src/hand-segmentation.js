// MagicTouch with the pinned MediaPipe runtime returns category 0 for the
// selected object and 255 for background (a single-channel foreground model).
const OBJECT = 0;
const BACKGROUND = 255;

export function handSeed(points, size) {
  const wrist = points[0], middleKnuckle = points[9];
  const x = (wrist[0] + middleKnuckle[0]) / 2;
  const y = (wrist[1] + middleKnuckle[1]) / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= size || y >= size) {
    throw new Error('Hand segmentation failed.');
  }
  return [x, y];
}

export function decodeBackgroundMask(categories, size, seed) {
  if (categories.length !== size * size || categories.some(value => value !== OBJECT && value !== BACKGROUND)) {
    throw new Error('Invalid hand segmentation mask.');
  }
  const [x, y] = seed.map(Math.floor);
  if (x < 0 || y < 0 || x >= size || y >= size || categories[y * size + x] !== OBJECT) {
    throw new Error('Hand segmentation failed.');
  }

  // Retain the model's foreground component containing the automatic hand
  // prompt. Disconnected predicted specks are not eligible replacement pixels.
  // 1 means background, 0 means the selected hand foreground.
  const backgroundMask = new Uint8Array(categories.length).fill(1);
  const queue = new Int32Array(categories.length);
  let head = 0, tail = 1;
  const start = y * size + x;
  queue[0] = start;
  backgroundMask[start] = 0;
  while (head < tail) {
    const pixel = queue[head++];
    const px = pixel % size, py = Math.floor(pixel / size);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (backgroundMask[next] && categories[next] === OBJECT) {
        backgroundMask[next] = 0;
        queue[tail++] = next;
      }
    }
  }
  if (tail < categories.length * 0.01 || tail > categories.length * 0.95) {
    throw new Error('Hand segmentation failed.');
  }
  return backgroundMask;
}

// Verify the selected object overlaps the detected hand joints. Landmarks
// are used to select and validate the mask, never to invent its boundary.
export function validateHandMask(backgroundMask, points, size) {
  const onHand = ([x, y]) => {
    const cx = Math.round(x), cy = Math.round(y);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px >= 0 && py >= 0 && px < size && py < size && backgroundMask[py * size + px] === 0) return true;
    }
    return false;
  };
  if (points.filter(onHand).length < 12 || [0, 5, 9, 13, 17].filter(i => onHand(points[i])).length < 4) {
    throw new Error('Hand segmentation failed.');
  }
}
