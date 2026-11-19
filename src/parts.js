import { SIZE } from './game.js';
import { assetUrl, makeCanvas } from './vision.js';

export const PART_TYPES = [
  { type: 'plate', name: '装甲板', width: 168, height: 128, rate: 2 },
  { type: 'hinge', name: '关节支架', width: 132, height: 184, rate: 3 },
  { type: 'ring', name: '环形接头', width: 160, height: 160, rate: 4 },
  { type: 'claw', name: '三叉骨架', width: 186, height: 158, rate: 3 },
  { type: 'elbow', name: 'L 形护板', width: 164, height: 180, rate: 2.5 },
];

let imagesPromise;
export function loadPartImages() {
  imagesPromise ||= Promise.all(PART_TYPES.map(part => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([part.type, image]);
    image.onerror = () => reject(new Error('机械图片加载失败，请检查 public/parts 文件。'));
    image.src = assetUrl(`parts/${part.type}.svg`);
  }))).then(entries => Object.fromEntries(entries)).catch(error => { imagesPromise = null; throw error; });
  return imagesPromise;
}

export function randomOffers() {
  const pool = [...PART_TYPES];
  const random = new Uint32Array(6);
  crypto.getRandomValues(random);
  return Array.from({ length: 3 }, (_, i) => {
    const part = pool.splice(random[i] % pool.length, 1)[0];
    const scale = 0.8 + (random[i + 3] % 41) / 100;
    return { ...part, id: `${i}-${random[i]}`, width: Math.round(part.width * scale), height: Math.round(part.height * scale) };
  });
}

export function partMask(part, image) {
  const canvas = makeCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, part.x - part.width / 2, part.y - part.height / 2, part.width, part.height);
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  return Uint8Array.from({ length: SIZE * SIZE }, (_, i) => pixels[i * 4 + 3] >= 128 ? 1 : 0);
}

export function drawPart(ctx, part, image) {
  ctx.drawImage(image, part.x - part.width / 2, part.y - part.height / 2, part.width, part.height);
}
