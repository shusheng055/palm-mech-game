import { SIZE } from './game.js';
import { assetUrl, makeCanvas } from './vision.js';

export const PART_TYPES = [
  { type: 'plate', name: 'Armor Plate', width: 126, height: 96, rate: 2 },
  { type: 'hinge', name: 'Joint Bracket', width: 99, height: 138, rate: 3 },
  { type: 'ring', name: 'Ring Coupling', width: 120, height: 120, rate: 4 },
  { type: 'claw', name: 'Prong Frame', width: 140, height: 119, rate: 3 },
  { type: 'elbow', name: 'L-Plate', width: 123, height: 135, rate: 2.5 },
];

let imagesPromise;
export function loadPartImages() {
  imagesPromise ||= Promise.all(PART_TYPES.map(part => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([part.type, image]);
    image.onerror = () => reject(new Error('Mechanical parts failed to load.'));
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
