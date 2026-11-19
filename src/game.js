export const SIZE = 512;
export const INJECTION_COST = 80;
export const INJECTION_LENGTH = 24;
export const LINE_NAMES = ['Heart Line', 'Head Line', 'Life Line'];

export function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

export function visibleLength(points, coverage, size = SIZE) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const segment = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(segment * 2));
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (x >= 0 && y >= 0 && x < size && y < size && !coverage[y * size + x]) {
        length += segment / steps;
      }
    }
  }
  return length;
}

export function scoreLines(lines, coverage, size = SIZE) {
  const lengths = lines.map((line) => visibleLength(line.points, coverage, size));
  return { lengths, total: Math.round(lengths.reduce((sum, length) => sum + length, 0) * 10) };
}

export function unionMasks(masks, size = SIZE) {
  const union = new Uint8Array(size * size);
  for (const mask of masks) {
    for (let i = 0; i < union.length; i++) if (mask[i]) union[i] = 1;
  }
  return union;
}

export function replacementReward(existing, candidate, rate) {
  let newArea = 0;
  for (let i = 0; i < candidate.length; i++) if (candidate[i] && !existing[i]) newArea++;
  return { newArea, money: Math.floor(newArea * rate / 100) };
}

// The added path is explicitly a game modification, never a model prediction.
export function extendLine(line, amount = INJECTION_LENGTH, size = SIZE) {
  const options = [false, true].map((reverse) => {
    const points = reverse ? [...line.points].reverse() : [...line.points];
    const end = points.at(-1);
    let prev = points[0];
    for (let i = points.length - 2; i >= 0; i--) {
      prev = points[i];
      if (Math.hypot(end[0] - prev[0], end[1] - prev[1]) >= 12) break;
    }
    const distance = Math.hypot(end[0] - prev[0], end[1] - prev[1]);
    if (!distance) return { points, added: 0 };
    const dx = (end[0] - prev[0]) / distance;
    const dy = (end[1] - prev[1]) / distance;
    let room = amount;
    if (dx > 0) room = Math.min(room, (size - 2 - end[0]) / dx);
    if (dx < 0) room = Math.min(room, (1 - end[0]) / dx);
    if (dy > 0) room = Math.min(room, (size - 2 - end[1]) / dy);
    if (dy < 0) room = Math.min(room, (1 - end[1]) / dy);
    room = Math.max(0, room);
    for (let t = 1; t <= Math.ceil(room); t++) {
      const step = Math.min(t, room);
      points.push([end[0] + dx * step, end[1] + dy * step]);
    }
    return { points, added: room };
  });
  const chosen = options.sort((a, b) => b.added - a.added)[0];
  return { line: { ...line, points: chosen.points }, added: chosen.added };
}

export function purchaseInjection(lines, index, money) {
  if (money < INJECTION_COST || !lines[index]) return { ok: false, message: 'Insufficient funds.' };
  const { line, added } = extendLine(lines[index]);
  if (added < 1) return { ok: false, message: 'Cannot extend this line. No charge.' };
  return { ok: true, lines: lines.map((old, i) => i === index ? line : old), money: money - INJECTION_COST, added };
}
