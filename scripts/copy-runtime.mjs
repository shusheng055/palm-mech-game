import { cp, mkdir } from 'node:fs/promises';

// Serve every inference asset locally; no CDN is used by the application.
for (const [source, target] of [
  ['node_modules/@mediapipe/tasks-vision/wasm', 'public/runtime/vision'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'public/runtime/ort/ort-wasm-simd-threaded.wasm'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'public/runtime/ort/ort-wasm-simd-threaded.mjs'],
]) {
  await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true });
  await cp(source, target, { recursive: true });
}
await cp('third-party', 'public/licenses', { recursive: true });
console.log('Local inference runtimes ready.');
