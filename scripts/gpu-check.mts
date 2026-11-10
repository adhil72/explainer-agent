/**
 * Measures how fast this machine draws video frames with each of Chrome's backends (CPU and GPU), using a finished video's spec.
 * Usage: npm run gpu-check [-- jobs/<id>]   Writes the fastest working backend to .gpu.json, which the video settings offer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { getCompositions, renderMedia, selectComposition } from '@remotion/renderer';
import { JOBS_DIR, ROOT } from '../src/config.ts';

const jobDir = process.argv[2] ?? fs.readdirSync(JOBS_DIR).map((d) => path.join(JOBS_DIR, d)).find((d) => fs.existsSync(path.join(d, 'spec.json')));
if (!jobDir) { console.log('Render one video first: this check uses its frames.'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(path.join(jobDir, 'spec.json'), 'utf8'));
const serveUrl = await bundle({ entryPoint: path.join(ROOT, 'video', 'index.ts'), publicDir: path.join(jobDir, 'public') });
const inputProps = { spec };
const frames = Math.min(150, spec.durationInFrames);
const out = path.join(os.tmpdir(), 'gpu-check.mp4');
const results: { gl: string; fps: number }[] = [];
console.log(`Drawing ${frames} frames of ${path.basename(jobDir)} (${spec.width}x${spec.height}) with each backend:\n`);
for (const gl of ['swangle', 'angle', 'egl', 'vulkan', 'angle-egl'] as const) {
  try {
    const chromiumOptions = { gl };
    await getCompositions(serveUrl, { inputProps, chromiumOptions });
    const comp = await selectComposition({ serveUrl, id: 'Explainer', inputProps, chromiumOptions });
    const t0 = Date.now();
    await renderMedia({
      serveUrl, composition: comp, inputProps, codec: 'h264', outputLocation: out, frameRange: [0, frames - 1], chromiumOptions, muted: true,
      concurrency: Math.max(1, Math.floor(os.cpus().length / 2)), timeoutInMilliseconds: 60_000, logLevel: 'error',
    });
    const fps = frames / ((Date.now() - t0) / 1000);
    results.push({ gl, fps });
    console.log(`  ${gl.padEnd(10)} ${fps.toFixed(1).padStart(6)} fps   ${gl === 'swangle' ? '(CPU)' : '(GPU)'}`);
  } catch (e) {
    console.log(`  ${gl.padEnd(10)}  failed: ${String((e as Error).message).split('\n')[0].slice(0, 90)}`);
  }
}
const best = results.sort((a, b) => b.fps - a.fps)[0];
const cpu = results.find((r) => r.gl === 'swangle');
if (best) {
  fs.writeFileSync(path.join(ROOT, '.gpu.json'), JSON.stringify({ best: best.gl, fps: best.fps, cpuFps: cpu?.fps ?? null, results, checked: new Date().toISOString() }, null, 2));
  console.log(`\nFastest: ${best.gl} (${best.fps.toFixed(1)} fps${cpu && best.gl !== 'swangle' ? `, ${(best.fps / cpu.fps).toFixed(2)}x the CPU` : ''}). Saved to .gpu.json.`);
}
