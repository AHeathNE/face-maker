// Copies MediaPipe WASM from node_modules and downloads the landmark model (one-time).
import { cp, mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '../../node_modules/@mediapipe/tasks-vision');
await mkdir(join(here, 'public/wasm'), { recursive: true });
await cp(join(pkgDir, 'wasm'), join(here, 'public/wasm'), { recursive: true });

const models = {
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'hair_segmenter.tflite': 'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/latest/hair_segmenter.tflite',
};
for (const [name, url] of Object.entries(models)) {
  const file = join(here, 'public/models', name);
  if (await access(file).then(() => true, () => false)) continue;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model download failed for ${name}: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}
console.log('cutter setup done');
