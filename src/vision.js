import { SIZE } from './game.js';

export const assetUrl = (path) => new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href;
let landmarkerPromise;

async function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const files = await FilesetResolver.forVisionTasks(assetUrl('runtime/vision'));
      return HandLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: assetUrl('models/hand_landmarker.task'), delegate: 'CPU' },
        runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
      });
    })().catch((error) => {
      landmarkerPromise = null;
      throw new Error(`本地手部定位模型或运行文件加载失败，无法识别。${error.message || error}`);
    });
  }
  return landmarkerPromise;
}

export function makeCanvas(width = SIZE, height = SIZE) {
  return Object.assign(document.createElement('canvas'), { width, height });
}

export async function fileToCanvas(file) {
  if (!file.type.startsWith('image/')) throw new Error('请选择有效的 JPG、PNG 或 WebP 图片。');
  if (file.size > 25 * 1024 * 1024) throw new Error('图片超过 25 MB，请缩小后重试。');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (bitmap.width < 128 || bitmap.height < 128) throw new Error('图片太小，请使用至少 128×128 的清晰手掌照片。');
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = makeCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch (error) {
    throw new Error(error.message.startsWith('图片') ? error.message : '无法读取图片，请使用有效的 JPG、PNG 或 WebP 照片。');
  } finally { bitmap?.close(); }
}

export async function normalizePalm(source) {
  const detector = await getLandmarker();
  const result = detector.detect(source);
  if (!result.landmarks.length) throw new Error('未检测到手掌，无法识别感情线、智慧线、生命线。请张开一只手，掌心正对镜头，并改善光线。');
  if (result.landmarks.length !== 1) throw new Error('检测到多只手。请只保留一只手掌后重试。');
  const points = result.landmarks[0].map(({ x, y }) => [x * source.width, y * source.height]);
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const dx = points[9][0] - points[0][0];
  const dy = points[9][1] - points[0][1];
  const angle = -Math.PI / 2 - Math.atan2(dy, dx);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rotated = points.map(([x, y]) => [(x - cx) * cos - (y - cy) * sin, (x - cx) * sin + (y - cy) * cos]);
  const xs = rotated.map(p => p[0]), ys = rotated.map(p => p[1]);
  const margin = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.15;
  const x0 = Math.min(...xs) - margin, y0 = Math.min(...ys) - margin;
  const width = Math.max(...xs) - x0 + margin, height = Math.max(...ys) - y0 + margin;
  const normalized = makeCanvas();
  const ctx = normalized.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const mirror = result.handedness[0]?.[0]?.categoryName === 'Right';
  // Match the upstream crop: fingers up, Left chirality, plain 512×512 resize.
  if (mirror) { ctx.translate(SIZE, 0); ctx.scale(-1, 1); }
  ctx.scale(SIZE / width, SIZE / height);
  ctx.translate(-x0, -y0);
  ctx.rotate(angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(source, 0, 0);
  return normalized;
}
