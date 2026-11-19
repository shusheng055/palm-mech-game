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
      if (!response.ok) throw new Error(`ONNX 模型无法获取（HTTP ${response.status}）。请检查 public/models/student_fp16.onnx。`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== 11284720) throw new Error('ONNX 模型文件缺失或不完整，无法识别。请恢复原仓库的 student_fp16.onnx（11,284,720 字节）。');
      try {
        return await ort.InferenceSession.create(buffer, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      } catch (error) {
        throw new Error(`本地 ONNX 模型加载失败，未生成识别结果。${error.message || error}`);
      }
    })().catch((error) => { sessionPromise = null; throw error; });
  }
  return sessionPromise;
}

self.onmessage = async ({ data: { id, rgba, baseUrl } }) => {
  let input;
  let outputs;
  try {
    self.postMessage({ id, progress: '加载本地掌纹模型…' });
    const session = await getSession(baseUrl);
    self.postMessage({ id, progress: '正在本地识别三条掌纹…' });
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
    if (output.dims.join(',') !== '1,4,512,512') throw new Error('模型输出契约不匹配，无法识别。');
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
