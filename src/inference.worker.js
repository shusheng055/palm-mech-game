import * as ort from 'onnxruntime-web/wasm';
import { decodeLogits, traceMask } from './trace.js';

let sessionPromise;

async function getSession(baseUrl) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = new URL('runtime/ort/', baseUrl).href;
      const response = await fetch(new URL('models/student_fp16.onnx', baseUrl));
      if (!response.ok) throw new Error(`ONNX model unavailable (HTTP ${response.status}).`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== 11284720) throw new Error('ONNX model file is incomplete.');
      try {
        return await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      } catch (error) {
        console.error(error);
        throw new Error('ONNX model failed to load.');
      }
    })().catch((error) => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}

self.onmessage = async ({ data: { id, rgba, baseUrl } }) => {
  let input;
  let outputs;
  try {
    const session = await getSession(baseUrl);
    const started = performance.now();
    const plane = 512 * 512;
    const pixels = new Uint8ClampedArray(rgba);
    const tensor = new Float32Array(3 * plane);
    const means = [0.485, 0.456, 0.406];
    const stds = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) {
      tensor[c * plane + i] = (pixels[i * 4 + c] / 255 - means[c]) / stds[c];
    }
    input = new ort.Tensor('float32', tensor, [1, 3, 512, 512]);
    outputs = await session.run({ [session.inputNames[0]]: input });
    const output = outputs[session.outputNames[0]];
    if (output.dims.join(',') !== '1,4,512,512') throw new Error('Unexpected model output dimensions.');
    const { mask, probabilities } = decodeLogits(output.data);
    const lines = traceMask(mask, probabilities);
    self.postMessage({ id, lines, milliseconds: Math.round(performance.now() - started) });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  } finally {
    input?.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
  }
};
