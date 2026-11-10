import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { askJson, peekField } from '../llm.js';
import { AssetsSchema, type JobState } from '../schema.js';
import { bytes, detail, warn } from '../ui.js';

const EXT = /\.(jpe?g|png|webp)$/i;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const MAX_FILES = 16;
const MAX_BYTES = 7_000_000;

/** Image files in a folder (not recursive), smallest name first. */
export function listImages(dir: string): string[] {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => EXT.test(f)).sort().map((f) => path.join(dir, f));
}

/** An image as an inline part for Gemini. */
export const inlinePart = (file: string) => ({ inlineData: { mimeType: MIME[path.extname(file).toLowerCase()] ?? 'image/png', data: fs.readFileSync(file).toString('base64') } });

/**
 * Copy the creator's images into the job (public/user/...) and have the vision model describe each one, sum up their style and pick a
 * palette from them. The writer then places them in the video, and the illustrator matches their style.
 */
export async function loadAssets(job: JobState) {
  const dir = job.brief.assetsDir;
  if (!dir) return;
  const all = listImages(dir);
  const files = all.filter((f) => fs.statSync(f).size <= MAX_BYTES).slice(0, MAX_FILES);
  if (all.length > files.length) warn(`Using ${files.length} of ${all.length} images (max ${MAX_FILES}, each under ${bytes(MAX_BYTES)})`);
  if (!files.length) { warn(`No usable images in ${dir}`); return; }
  const pub = path.join(job.dir, 'public', 'user');
  fs.mkdirSync(pub, { recursive: true });
  const names = files.map((f, i) => {
    const name = `user/${String(i + 1).padStart(2, '0')}-${path.basename(f).replace(/[^\w.-]+/g, '_')}`;
    fs.copyFileSync(f, path.join(job.dir, 'public', name));
    return name;
  });
  const res = await askJson({
    label: `Looking at your ${files.length} image(s)`,
    peek: peekField('description', 'image'),
    model: config.visionModel,
    system: 'You are an art director preparing assets for a motion-graphics explainer video.',
    thinking: 'LOW',
    schema: AssetsSchema,
    parts: files.flatMap((f, i) => [{ text: `Image ${i}:` }, inlinePart(f)]),
    prompt: `These are the creator's own images for a video about "${job.brief.topic}". Describe each one, say whether it can be shown full-screen,
sum up their common visual style, and choose a video palette that matches them (backgrounds must keep white or dark text readable).`,
  });
  job.assets = { ...res, files: names };
  for (const im of res.images) detail(`${names[im.index] ?? '?'} ${im.usable ? '' : '(not used on screen) '}— ${im.description}`);
  detail(`style: ${res.style}`);
  detail(`palette: ${res.palette.dark ? 'dark' : 'light'} ${res.palette.bg1} ${res.palette.bg2} accents ${res.palette.accent} ${res.palette.accent2}`);
}

/** The list the writer sees: file name and what it shows, usable images only. */
export function assetsForWriter(job: JobState): string {
  const a = job.assets;
  if (!a) return '';
  const usable = a.images.filter((im) => im.usable && a.files[im.index]);
  if (!usable.length) return '';
  return `\nYOUR IMAGES (the creator's own pictures; use them with kind "image" and asset = file name wherever one fits the narration,
prefer them over drawing new pictures, use each at most once):\n${usable.map((im) => `- ${a.files[im.index]}: ${im.description}`).join('\n')}\n`;
}
