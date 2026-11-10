import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition, ensureBrowser } from '@remotion/renderer';
import { MUSIC_DIR, ROOT, config } from '../config.js';
import { formatById, isShort } from '../formats.js';
import { hit, pcmToWav, pop, whoosh } from '../audio.js';
import type { JobState, RenderOpts } from '../schema.js';
import { imageFile, readPlates } from './images.js';
import { hasKit, placeSfx } from '../sfx.js';
import os from 'node:os';
import { bar, bytes, c, detail, dur, num, spinner } from '../ui.js';
import type { SpecBeat, ThumbSpec, ThemeName, Timing, VideoSpec, Word } from '../../video/spec.js';

/** Width / height of a PNG or JPEG, read from its header. */
function imageAspect(file: string): number | null {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 1, 4) === 'PNG') return b.readUInt32BE(16) / b.readUInt32BE(20);
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return b.readUInt16BE(i + 7) / b.readUInt16BE(i + 5);
      i += 2 + len;
    }
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return (1 + b.readUIntLE(24, 3)) / (1 + b.readUIntLE(27, 3));
    if (chunk === 'VP8 ') return (b.readUInt16LE(26) & 0x3fff) / (b.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return (1 + (v & 0x3fff)) / (1 + ((v >> 14) & 0x3fff)); }
  }
  return null;
}

/** The writer gives numbers as short text ("2.5", "1,200", "~380"); turn them into numbers. */
const toNum = (v?: string | number) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const decimalsOf = (v?: string | number) => {
  const m = /\.(\d+)/.exec(String(v ?? '').replace(/,/g, ''));
  return m ? Math.min(2, m[1].length) : 0;
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const tokens = (s: string) => s.split(/\s+/).map(norm).filter(Boolean);

/** Index of the first word where the cue starts, searching from `from`. Falls back to the cue's first rare word. */
function findCue(words: Word[], cue: string, from: number): number {
  const want = tokens(cue);
  if (!want.length) return -1;
  const have = words.map((w) => norm(w.w));
  for (let i = from; i <= have.length - want.length; i++) if (want.every((t, k) => have[i + k] === t)) return i;
  const key = [...want].sort((a, b) => b.length - a.length)[0];
  for (let i = from; i < have.length; i++) if (have[i] === key) return Math.max(from, i - want.indexOf(key));
  return -1;
}

/** Turn the script + word timings into the render spec: when each beat starts and ends, and when list items pop in. */
export function buildSpec(job: JobState, timing: Timing, opts: RenderOpts = DEFAULT_RENDER): VideoSpec {
  const f = formatById(job.brief.formatId);
  const script = job.script!;
  const fps = opts.fps;
  const pub = path.join(job.dir, 'public');
  const scenes = script.scenes.map((sc, si) => {
    const span = timing.scenes[si];
    const words = timing.words.filter((w) => w.scene === si);
    let from = 0;
    const starts: number[] = sc.beats.map((b, bi) => {
      if (bi === 0) return span.start;
      const i = findCue(words, b.cue, from);
      if (i < 0) return NaN;
      from = i + 1;
      return Math.max(span.start, words[i].s - 0.12);
    });
    // Beats whose cue was not found are spread evenly between their neighbours.
    for (let i = 1; i < starts.length; i++) {
      if (!Number.isNaN(starts[i])) continue;
      let j = i;
      while (j < starts.length && Number.isNaN(starts[j])) j++;
      const a = starts[i - 1], b = j < starts.length ? starts[j] : span.end;
      for (let k = i; k < j; k++) starts[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    }
    // Keep beats in order and on screen at least ~1.2s.
    for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 1.2);
    const beats: SpecBeat[] = [];
    sc.beats.forEach((b, bi) => {
      const start = starts[bi];
      const end = bi < sc.beats.length - 1 ? starts[bi + 1] : span.end;
      if (start >= span.end - 0.4) return; // squeezed out
      const file = b.asset ?? (b.imagePrompt ? imageFile(b.imagePrompt) : '');
      const image = b.kind === 'image' && file && fs.existsSync(path.join(pub, file)) ? file : undefined;
      const beat: SpecBeat = {
        kind: b.kind === 'image' && !image ? 'title' : b.kind,
        start, end: Math.min(end, span.end),
        heading: b.heading, highlight: b.highlight, sub: b.sub, value: toNum(b.value), prefix: b.prefix, suffix: b.suffix, decimals: decimalsOf(b.value),
        items: b.items?.map((it) => ({ ...it, value: toNum(it.value) })), left: b.left, right: b.right, icon: b.icon, image, focus: b.focus,
      };
      if (beat.kind === 'stat' && beat.value === undefined) beat.kind = 'title'; // a stat with no usable number becomes a title card
      if (b.items?.length) {
        const inBeat = words.filter((w) => w.s >= start - 0.05 && w.s < beat.end);
        const dur = beat.end - start;
        let at = 0;
        beat.itemTimes = b.items.map((it, k) => {
          const i = findCue(inBeat, it.label.split(/\s+/)[0], at);
          const even = start + 0.25 + (dur * 0.6 * k) / Math.max(1, b.items!.length);
          if (i >= 0) { at = i + 1; return Math.max(start + 0.15, inBeat[i].s - 0.1); }
          return even;
        });
        for (let k = 1; k < beat.itemTimes.length; k++) beat.itemTimes[k] = Math.max(beat.itemTimes[k], beat.itemTimes[k - 1] + 0.3);
      }
      beats.push(beat);
    });
    return { chapter: sc.chapter, start: span.start, end: span.end, beats };
  });

  let music: string | undefined;
  const tracks = musicTracks();
  const choice = opts.music === 'random' ? tracks[Math.floor(Math.random() * tracks.length)] : tracks.find((t) => t === opts.music);
  if (choice) {
    music = `music${path.extname(choice)}`;
    fs.copyFileSync(path.join(MUSIC_DIR, choice), path.join(pub, music));
  }

  // Scene pictures (illustrated style) with the positions of their parts.
  const plateInfo = readPlates(job);
  const plates = script.scenes.map((_, si) => {
    const p = plateInfo[`scene${si}`];
    if (!p || !fs.existsSync(path.join(pub, p.file))) return null;
    return { file: p.file, aspect: imageAspect(path.join(pub, p.file)) ?? f.width / f.height, parts: p.parts };
  });

  return {
    width: f.width, height: f.height, fps,
    captions: opts.captions,
    plates: plates.some(Boolean) ? plates : undefined,
    durationInFrames: Math.ceil(timing.duration * fps),
    vertical: f.vertical, safe: f.safe,
    theme: job.brief.theme as ThemeName,
    palette: job.brief.theme === 'custom' ? job.assets?.palette : undefined,
    title: script.title,
    showChapters: !isShort(f),
    scenes, words: timing.words,
    voice: 'voice.wav', music, musicVolume: opts.musicVolume, sfx: opts.sfx,
  };
}

/** Music files in assets/music. */
export const musicTracks = () => (fs.existsSync(MUSIC_DIR) ? fs.readdirSync(MUSIC_DIR).filter((m) => /\.(mp3|wav|m4a|aac|ogg)$/i.test(m)).sort() : []);

/** Quality presets: x264 CRF (lower = better) and encoder speed (slower = smaller file at the same quality). */
export const QUALITY = {
  best: { crf: 15, preset: 'slow', label: 'Best (CRF 15, slow encode, largest file)' },
  high: { crf: 18, preset: 'medium', label: 'High (CRF 18) — recommended for upload' },
  balanced: { crf: 22, preset: 'medium', label: 'Balanced (CRF 22, smaller file)' },
  small: { crf: 27, preset: 'fast', label: 'Small / quick preview (CRF 27, fast)' },
} as const;

export const DEFAULT_RENDER: RenderOpts = { scale: 1, fps: 30, quality: 'high', captions: true, sfx: true, music: 'random', musicVolume: config.musicVolume, gl: 'swangle' };

function writeSfx(pub: string) {
  const dir = path.join(pub, 'sfx');
  fs.mkdirSync(dir, { recursive: true });
  const put = (name: string, pcm: Buffer) => { const p = path.join(dir, name); if (!fs.existsSync(p)) fs.writeFileSync(p, pcmToWav(pcm, 44100)); };
  put('whoosh.wav', whoosh());
  put('pop.wav', pop());
  put('hit.wav', hit());
}

/** Render the video and the thumbnail / cover into out/. */
export async function render(job: JobState): Promise<{ video: string; thumb: string }> {
  const timing = JSON.parse(fs.readFileSync(path.join(job.dir, 'timing.json'), 'utf8')) as Timing;
  const pub = path.join(job.dir, 'public');
  writeSfx(pub);
  const opts = { ...DEFAULT_RENDER, ...job.renderOpts };
  const q = QUALITY[opts.quality] ?? QUALITY.high;
  const chromiumOptions = { gl: opts.gl as any };
  const spec = buildSpec(job, timing, opts);
  if (opts.sfx) {
    const cues = placeSfx(spec, pub);
    if (cues) {
      spec.sfxCues = cues;
      const roles = cues.reduce<Record<string, number>>((m, q) => ((m[q.role] = (m[q.role] ?? 0) + 1), m), {});
      detail(`sound effects: ${cues.length} from the earshot kit · ${Object.entries(roles).map(([r, n]) => `${r} ${n}`).join(', ')}`);
    } else if (!hasKit()) detail('sound effects: built-in (render the earshot kit with "npm run sfx-kit" for better ones)');
  }
  if (spec.plates) detail(`scene pictures: ${spec.plates.filter(Boolean).length}/${spec.scenes.length} · ${spec.scenes.flatMap((s) => s.beats).filter((b) => b.focus).length} camera moves / labels on parts`);
  fs.writeFileSync(path.join(job.dir, 'spec.json'), JSON.stringify(spec, null, 1));

  const beats = spec.scenes.reduce((n, sc) => n + sc.beats.length, 0);
  detail(`${spec.scenes.length} scenes · ${beats} visual beats · ${spec.words.length} caption words · theme ${spec.theme}${spec.music ? ` · music ${spec.music}` : ' · no music (add tracks to assets/music)'}`);

  const prep = spinner('Checking the headless browser');
  await ensureBrowser({
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ percent, downloadedBytes, totalSizeInBytes }) =>
        prep.update(`Downloading headless browser ${bar(percent, 20)} ${Math.round(percent * 100)}% ${c.dim(`${bytes(downloadedBytes)}/${bytes(totalSizeInBytes)}`)}`),
    }),
  });
  prep.done('Headless browser ready');
  const pack = spinner('Bundling the video project');
  const serveUrl = await bundle({
    entryPoint: path.join(ROOT, 'video', 'index.ts'), publicDir: pub,
    onProgress: (p) => pack.update(`Bundling the video project ${bar(p / 100, 20)} ${Math.round(p)}%`),
  });
  pack.done('Video project bundled');

  const out = path.join(job.dir, 'out');
  fs.mkdirSync(out, { recursive: true });
  const name = `${job.id.replace(/^\d+-/, '')}-${job.brief.formatId}`;
  const video = path.join(out, `${name}.mp4`);

  const inputProps = { spec } as Record<string, unknown>;
  const comp = await selectComposition({ serveUrl, id: 'Explainer', inputProps, chromiumOptions });
  const total = comp.durationInFrames;
  const threads = Math.max(1, Math.floor(os.cpus().length / 2));
  const outW = Math.round(spec.width * opts.scale), outH = Math.round(spec.height * opts.scale);
  detail(`${outW}x${outH} · ${spec.fps} fps · ${num(total)} frames (${dur(timing.duration * 1000)}) · H.264 CRF ${q.crf} ${q.preset} + AAC 192k · drawing on ${opts.gl === 'swangle' ? 'CPU' : `GPU (${opts.gl})`} · ${threads} parallel tabs`);
  const spin = spinner('Rendering');
  // Speed is measured over the last few seconds, so it reacts to slow and fast passages.
  const window: { t: number; f: number }[] = [];
  await renderMedia({
    serveUrl, composition: comp, inputProps, codec: 'h264', crf: q.crf, x264Preset: q.preset, pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k',
    outputLocation: video, timeoutInMilliseconds: 120_000, concurrency: threads, scale: opts.scale, chromiumOptions,
    onProgress: ({ progress, renderedFrames, encodedFrames, stitchStage }) => {
      const now = Date.now();
      window.push({ t: now, f: renderedFrames });
      while (window.length > 2 && now - window[0].t > 5000) window.shift();
      const span = (now - window[0].t) / 1000;
      const fps = span > 0.5 ? (renderedFrames - window[0].f) / span : renderedFrames / Math.max(0.1, spin.elapsed() / 1000);
      const left = fps > 0 ? (total - renderedFrames) / fps : 0;
      const realtime = fps / spec.fps;
      const stage = renderedFrames >= total ? (stitchStage === 'muxing' ? 'Adding audio' : 'Encoding') : 'Rendering';
      spin.update(`${stage} ${bar(progress)} ${String(Math.round(progress * 100)).padStart(3)}% ${c.dim('│')} ${num(renderedFrames)}/${num(total)} frames ${c.dim('│')} encoded ${num(encodedFrames)} ${c.dim('│')} ${fps.toFixed(1)} fps ${c.dim(`(${realtime.toFixed(2)}x realtime)`)} ${c.dim('│')} ETA ${renderedFrames >= total ? '—' : dur(left * 1000)}`);
    },
  }).catch((e) => { spin.fail('Rendering failed'); throw e; });
  const took = spin.elapsed();
  spin.done('Video rendered', `${(total / (took / 1000)).toFixed(1)} fps average, ${(timing.duration / (took / 1000)).toFixed(2)}x realtime`);
  detail(`${path.basename(video)} · ${bytes(fs.statSync(video).size)} · ${dur(timing.duration * 1000)} · ${outW}x${outH} · ${spec.fps} fps`);

  const f = formatById(job.brief.formatId);
  const thumbSpec: ThumbSpec = {
    width: f.id === 'yt' ? 1280 : f.width, height: f.id === 'yt' ? 720 : f.height,
    theme: spec.theme, palette: spec.palette, text: job.script!.thumbnailText,
    image: ((t) => (fs.existsSync(path.join(pub, t)) ? t : undefined))(imageFile(`thumb:${job.script!.thumbnailPrompt}`)),
    icon: job.script!.scenes[0].beats[0]?.icon,
  };
  const thumb = path.join(out, f.id === 'yt' ? 'thumbnail.png' : 'cover.png');
  const tp = { spec: thumbSpec } as Record<string, unknown>;
  const tcomp = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps: tp, chromiumOptions });
  const ts = spinner(`Rendering the ${f.id === 'yt' ? 'thumbnail' : 'cover'}`);
  await renderStill({ serveUrl, composition: tcomp, inputProps: tp, output: thumb, frame: 0, chromiumOptions });
  ts.done(`${f.id === 'yt' ? 'Thumbnail' : 'Cover'} rendered`, `${thumbSpec.width}x${thumbSpec.height}, ${bytes(fs.statSync(thumb).size)}`);
  return { video, thumb };
}
