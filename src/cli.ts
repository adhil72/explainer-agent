import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { IMAGES_DIR, ROOT, config } from './config.js';
import { FORMATS, formatById } from './formats.js';
import { listJobs, load, newJob, save } from './job.js';
import type { Brief, JobState, RenderOpts } from './schema.js';
import { ask, c, choose, closeUi, detail, heading, info, ok, out, setLogFile, step, summary, warn } from './ui.js';
import { listImages, loadAssets } from './steps/assets.js';
import { research } from './steps/research.js';
import { makeOptions } from './steps/options.js';
import { reviseScript, showScript, writeScript } from './steps/script.js';
import { GEMINI_VOICES, voice } from './steps/voice.js';
import { images } from './steps/images.js';
import { DEFAULT_RENDER, QUALITY, musicTracks, render } from './steps/render.js';
import { publishPack } from './steps/publish.js';
import { ScriptSchema } from './schema.js';

const TONES = ['Curious & energetic', 'Dramatic storytelling', 'Calm documentary', 'Funny & casual', 'Straight-to-the-point expert'];
const THEMES = [
  { id: 'midnight', note: 'dark navy, cyan + amber accents (tech, science, space)' },
  { id: 'neon', note: 'black with neon glow (internet, gaming, AI)' },
  { id: 'sunset', note: 'purple-orange warmth (history, stories, culture)' },
  { id: 'paper', note: 'light cream + ink (finance, education, calm)' },
];

async function askBrief(topicArg?: string): Promise<Brief> {
  heading('New video');
  const topic = topicArg || (await ask('What should the video explain?'));
  if (!topic) throw new Error('A topic is needed.');
  const fi = await choose('Where will you publish it?', FORMATS.map((f) => f.label), 0);
  const f = FORMATS[fi];
  const secs = Number(await ask(`Length in seconds? (${f.minSec}-${f.maxSec})`, String(f.defaultSec)));
  const seconds = Math.min(f.maxSec, Math.max(f.minSec, Number.isFinite(secs) ? secs : f.defaultSec));
  const language = await ask('Language?', 'English');
  const audience = await ask('Who is it for?', 'curious general audience, no background needed');
  const tone = TONES[await choose('Tone?', TONES, 0)];
  const models = config.writerModels.includes(config.writerModel) ? config.writerModels : [config.writerModel, ...config.writerModels];
  const model = models[await choose('Model for research and writing?', models.map((m, i) => `${m}${i === 0 ? c.dim('  (default)') : ''}`), 0)];

  const defDir = listImages(IMAGES_DIR).length ? IMAGES_DIR : '';
  let assetsDir = '';
  for (;;) {
    const a = await ask('Folder with your own images (shown in the video + style for AI pictures)? Enter a path, or "-" for none', defDir || '-');
    if (a === '-' || !a) break;
    const dir = path.resolve(a.replace(/^~(?=\/)/, process.env.HOME ?? '~').replace(/^["']|["']$/g, ''));
    const n = listImages(dir).length;
    if (n) { assetsDir = dir; ok(`${n} image(s) found in ${dir}`); break; }
    warn(`No .jpg/.png/.webp images in ${dir}`);
  }
  const looks = [...THEMES.map((t) => `${t.id.padEnd(9)} ${c.dim(t.note)}`)];
  if (assetsDir) looks.unshift(`${'custom'.padEnd(9)} ${c.dim('colors picked from your images')}`);
  const li = await choose('Look?', looks, 0);
  const theme = assetsDir ? (li === 0 ? 'custom' : THEMES[li - 1].id) : THEMES[li].id;
  const voices = [...GEMINI_VOICES.map((v) => `Gemini ${v.id.padEnd(10)} ${c.dim(v.note)}`)];
  if (config.tts.elevenKey) voices.push(`ElevenLabs ${c.dim('(your voice ' + config.tts.elevenVoice + ', exact caption timing, uses credits)')}`);
  const vi = await choose('Voice?', voices, 0);
  const voiceId = vi < GEMINI_VOICES.length ? GEMINI_VOICES[vi].id : `eleven:${config.tts.elevenVoice}`;
  const visual = (['illustrated', 'mixed', 'graphics'] as const)[await choose('Visual style?', [
    `Illustrated explainer ${c.dim('— one AI picture per scene, explained on it: camera zooms, arrows and labels on its parts')}`,
    `Motion graphics + a few AI pictures`,
    `Motion graphics only ${c.dim('(no AI pictures, cheapest)')}`,
  ], 0)];
  return { topic, formatId: f.id, seconds, language, audience, tone, theme, voice: voiceId, images: visual !== 'graphics', visual, model, assetsDir: assetsDir || undefined };
}

async function pickOption(job: JobState) {
  if (!job.options) job.options = await makeOptions(job);
  for (;;) {
    heading('Pick a direction');
    job.options.forEach((o, i) => {
      out(`\n  ${c.yellow(`${i + 1}.`)} ${c.bold(o.title)}`);
      out(`     ${c.dim('Angle:')} ${o.angle}`);
      out(`     ${c.dim('Hook:')}  ${c.cyan(`"${o.hook}"`)}`);
      out(`     ${c.dim('Flow:')}  ${o.outline.join(c.dim(' → '))}`);
      out(`     ${c.dim('Payoff:')} ${o.payoff}`);
      out(`     ${c.dim('Why it holds:')} ${o.whyItRetains}`);
    });
    save(job);
    out(`\n  Type a ${c.yellow('number')} to pick, or type what to change (e.g. "more dramatic", "focus on the history", "3 but with a darker hook").`);
    const a = await ask('Your choice');
    const n = Number(a) - 1;
    if (Number.isInteger(n) && job.options[n]) {
      job.chosen = job.options[n];
      return;
    }
    if (a) job.options = await makeOptions(job, a, job.options);
  }
}

/** Loop until the script is approved. Returns false to go back to the options. */
async function approveScript(job: JobState): Promise<boolean> {
  if (!job.script) job.script = await writeScript(job);
  for (;;) {
    save(job);
    heading('Script');
    showScript(job, job.script);
    info(c.dim(`Saved to ${path.join(job.dir, 'script.md')} (and script.json, which you can edit by hand)`));
    const m = await choose('What next?', [
      'Looks good, make the video',
      'Change something (tell me what)',
      'Rewrite it from scratch',
      'I edited script.json by hand, reload it',
      'Back to the options',
    ], 0);
    if (m === 0) return true;
    if (m === 1) {
      const fb = await ask('What should change?');
      if (fb) job.script = await reviseScript(job, fb);
    } else if (m === 2) job.script = await writeScript(job);
    else if (m === 3) {
      try {
        job.script = ScriptSchema.parse(JSON.parse(fs.readFileSync(path.join(job.dir, 'script.json'), 'utf8')));
        ok('Reloaded script.json');
      } catch (e) {
        warn(`script.json has a problem: ${(e as Error).message.slice(0, 300)}`);
      }
    } else {
      job.script = undefined;
      return false;
    }
  }
}

const narrationKey = (job: JobState) =>
  crypto.createHash('sha1').update(job.brief.voice + JSON.stringify(job.script!.scenes.map((s) => s.narration))).digest('hex');

/** The fastest drawing backend found by `npm run gpu-check`, if it has been run. */
function gpuCheck(): { best: string; fps: number; cpuFps: number | null } | null {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, '.gpu.json'), 'utf8')); } catch { return null; }
}

/** Ask how the file should be made. Enter keeps the previous answer (or the default). */
async function askRenderOpts(job: JobState): Promise<RenderOpts> {
  const prev = { ...DEFAULT_RENDER, ...job.renderOpts };
  const gpu = gpuCheck();
  if (!job.renderOpts && gpu && gpu.best !== 'swangle') prev.gl = gpu.best;
  const f = formatById(job.brief.formatId);
  heading('Video settings');
  info(c.dim('Press Enter to keep the marked choice.'));
  const pick = async <T,>(q: string, items: { label: string; value: T }[], current: T) => {
    const def = Math.max(0, items.findIndex((i) => i.value === current));
    return items[await choose(q, items.map((i, k) => `${i.label}${k === def ? c.dim('  ◂') : ''}`), def)].value;
  };
  const size = (s: number) => `${Math.round(f.width * s)}x${Math.round(f.height * s)}`;
  const scale = await pick('Resolution?', [
    { label: `720p   ${c.dim(size(2 / 3) + ' · fast preview')}`, value: 2 / 3 },
    { label: `1080p  ${c.dim(size(1) + ' · standard upload')}`, value: 1 },
    { label: `1440p  ${c.dim(size(4 / 3) + ' · sharper on YouTube')}`, value: 4 / 3 },
    { label: `4K     ${c.dim(size(2) + ' · ~4x slower to render')}`, value: 2 },
  ], prev.scale);
  const fps = await pick('Frame rate?', [
    { label: `24 fps ${c.dim('cinematic, fastest')}`, value: 24 },
    { label: `30 fps ${c.dim('standard for explainers')}`, value: 30 },
    { label: `60 fps ${c.dim('smoothest motion, 2x render time')}`, value: 60 },
  ], prev.fps);
  const quality = await pick('Quality?', (Object.keys(QUALITY) as (keyof typeof QUALITY)[]).map((k) => ({ label: QUALITY[k].label, value: k })), prev.quality);
  const gpuLabel = gpu ? `GPU ${c.dim(`(${gpu.best}, ${gpu.fps.toFixed(0)} fps${gpu.cpuFps ? ` vs CPU ${gpu.cpuFps.toFixed(0)}` : ''} in the check)`)}` : `GPU ${c.dim('(run "npm run gpu-check" to find the fastest mode)')}`;
  const gl = await pick('Draw frames on?', [
    { label: gpuLabel, value: gpu?.best && gpu.best !== 'swangle' ? gpu.best : 'angle' },
    { label: `CPU ${c.dim('(always works)')}`, value: 'swangle' },
  ], prev.gl);
  const captions = await pick('Captions?', [{ label: 'On (word by word)', value: true }, { label: 'Off', value: false }], prev.captions);
  const sfx = await pick('Sound effects?', [{ label: 'On', value: true }, { label: 'Off', value: false }], prev.sfx);
  const tracks = musicTracks();
  let music = 'none';
  let musicVolume = prev.musicVolume;
  if (tracks.length) {
    music = await pick('Background music?', [
      { label: `Random track ${c.dim(`(${tracks.length} in assets/music)`)}`, value: 'random' },
      ...tracks.map((t) => ({ label: t, value: t })),
      { label: 'None', value: 'none' },
    ], prev.music);
    if (music !== 'none') musicVolume = Number(await ask('Music volume under the voice (0.02-0.3)?', String(prev.musicVolume))) || prev.musicVolume;
  } else info(c.dim('No music: put .mp3/.wav tracks in assets/music to get a music choice.'));
  const opts: RenderOpts = { scale, fps, quality, gl, captions, sfx, music, musicVolume: Math.min(0.5, Math.max(0, musicVolume)) };
  job.renderOpts = opts;
  save(job);
  ok(`${size(scale)} · ${fps} fps · ${quality} · ${gl === 'swangle' ? 'CPU' : `GPU ${gl}`} · captions ${captions ? 'on' : 'off'} · sound effects ${sfx ? 'on' : 'off'} · music ${music}`);
  return opts;
}

async function produce(job: JobState) {
  await askRenderOpts(job);
  heading('Making the video');
  const key = narrationKey(job);
  const st = job as JobState & { voiceKey?: string };
  let end = step(1, 4, 'Voice');
  if (st.voiceKey !== key || !fs.existsSync(path.join(job.dir, 'timing.json'))) {
    await voice(job);
    st.voiceKey = key;
    save(job);
  } else ok('Narration unchanged, reusing the recorded voice');
  end();
  end = step(2, 4, 'Pictures');
  await images(job);
  end();
  end = step(3, 4, 'Render');
  const { video, thumb } = await render(job);
  end();
  end = step(4, 4, 'Publishing copy');
  const pack = await publishPack(job);
  end();
  job.output = video;
  job.stage = 'done';
  save(job);
  summary();
  heading('Ready to publish');
  ok(`Video:     ${c.bold(video)}`);
  ok(`${formatById(job.brief.formatId).id === 'yt' ? 'Thumbnail' : 'Cover'}: ${thumb}`);
  ok(`Copy:      ${pack}  ${c.dim('(titles, description, tags, hashtags, pinned comment)')}`);
  ok(`Log:       ${path.join(job.dir, 'log.txt')}`);
  // On WSL, open the folder in Windows Explorer.
  if (fs.existsSync('/usr/bin/wslpath')) {
    const win = spawnSync('wslpath', ['-w', path.dirname(video)]).stdout?.toString().trim();
    if (win) spawnSync('explorer.exe', [win]);
  }
}

async function run(job: JobState) {
  if (job.brief.assetsDir && !job.assets) {
    heading('Your images');
    await loadAssets(job);
    save(job);
  }
  if (!job.research) {
    heading('Research');
    detail(`model ${job.brief.model || config.writerModel} with Google Search`);
    await research(job);
    ok(`${job.research!.sources.length} sources. Notes: ${path.join(job.dir, 'research.md')}`);
    job.stage = 'options';
    save(job);
  }
  for (;;) {
    if (!job.chosen) await pickOption(job);
    job.stage = 'script';
    save(job);
    if (await approveScript(job)) break;
    job.chosen = undefined;
  }
  job.stage = 'render';
  save(job);
  for (;;) {
    await produce(job);
    const m = await choose('Anything else?', ['Done', 'Change the script and make it again', 'Same video in another format'], 0);
    if (m === 0) return;
    if (m === 1) {
      await approveScript(job);
      continue;
    }
    const fi = await choose('Which format?', FORMATS.map((f) => f.label), 0);
    const f = FORMATS[fi];
    const copy = newJob({ ...job.brief, formatId: f.id, seconds: Math.min(f.maxSec, Math.max(f.minSec, job.brief.seconds)) });
    Object.assign(copy, { research: job.research, options: job.options, chosen: job.chosen, stage: 'script' });
    if (job.brief.assetsDir) await loadAssets(copy);
    info(c.dim('The script is rewritten for the new frame and length.'));
    await approveScript(copy);
    job = copy;
  }
}

async function main() {
  const args = process.argv.slice(2);
  out(c.bold(c.magenta('\n  ▶ Explainer Agent')) + c.dim('  research → options → script → motion video'));
  let job: JobState;
  if (args[0] === '--resume' || args[0] === '--render') {
    let id = args[1];
    if (!id) {
      const jobs = listJobs();
      if (!jobs.length) throw new Error('No saved videos yet.');
      id = jobs[await choose('Which video?', jobs.map((j) => `${j.topic} ${c.dim(`[${j.stage}] ${j.id}`)}`), 0)].id;
    }
    job = load(id);
    if (args[0] === '--render') {
      if (!job.script) throw new Error('That video has no script yet; use --resume.');
      setLogFile(path.join(job.dir, 'log.txt'));
      return produce(job);
    }
  } else {
    job = newJob(await askBrief(args.join(' ').trim() || undefined));
  }
  setLogFile(path.join(job.dir, 'log.txt'));
  info(c.dim(`Working folder: ${job.dir}`));
  const b = job.brief;
  detail(`${formatById(b.formatId).label} · ${b.seconds}s · ${b.language} · ${b.tone} · look ${b.theme} · voice ${b.voice} (${config.tts.geminiModel}) · writer ${b.model || config.writerModel}${b.assetsDir ? ` · images ${b.assetsDir}` : ''}`);
  await run(job);
}

main()
  .catch((e) => {
    out(`\n${c.red('✖')} ${(e as Error)?.stack ?? e}`);
    process.exitCode = 1;
  })
  .finally(closeUi);
