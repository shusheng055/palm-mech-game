// Approximate the palm surface from MediaPipe joints (wrist to finger bases).
// The landmarks describe joint centres, so small anatomical margins estimate
// the edges without treating the entire hand's bounding box as skin.
export function palmOutline(points) {
  if (points.length < 21 || points.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) {
    throw new Error('Palm area could not be detected.');
  }
  const wrist = points[0], thumb = points[2];
  const knuckles = [5, 9, 13, 17].map(index => points[index]);
  const [index, middle, ring, little] = knuckles;
  const centre = knuckles.reduce(([x, y], point) => [x + point[0] / 4, y + point[1] / 4], [0, 0]);
  const length = Math.hypot(centre[0] - wrist[0], centre[1] - wrist[1]);
  if (length < 1) throw new Error('Palm area could not be detected.');
  const forward = [(centre[0] - wrist[0]) / length, (centre[1] - wrist[1]) / length];
  let across = [-forward[1], forward[0]];
  const lateral = (index[0] - little[0]) * across[0] + (index[1] - little[1]) * across[1];
  if (lateral < 0) across = across.map(value => -value);
  const width = Math.abs(lateral);
  if (width < 1) throw new Error('Palm area could not be detected.');

  const offset = (point, side, along = 0) => [
    point[0] + across[0] * width * side + forward[0] * length * along,
    point[1] + across[1] * width * side + forward[1] * length * along,
  ];
  const between = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  // Traverse the wrist, thenar edge, thumb web, finger bases and little-finger
  // edge. Use the thumb MCP only, leaving the free fingers outside the mask.
  return [
    offset(wrist, 0.42, 0.01),
    offset(between(wrist, thumb, 0.55), 0.17),
    offset(thumb, 0.04),
    offset(between(thumb, index, 0.55), -0.07),
    offset(index, 0.14, 0.08),
    offset(middle, 0, 0.09),
    offset(ring, 0, 0.08),
    offset(little, -0.16, 0.05),
    offset(between(wrist, little, 0.56), -0.29),
    offset(wrist, -0.42, 0.01),
  ];
}

// Fill a polygon using pixel centres. The result uses the same row-major,
// binary layout as the mechanical SVG alpha masks and is clipped to the canvas.
export function polygonMask(polygon, size) {
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    const yc = y + 0.5;
    const crossings = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      if ((a[1] > yc) === (b[1] > yc)) continue;
      crossings.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const start = Math.max(0, Math.ceil(crossings[i] - 0.5));
      const end = Math.min(size, Math.ceil(crossings[i + 1] - 0.5));
      if (end > start) mask.fill(1, y * size + start, y * size + end);
    }
  }
  return mask;
}
