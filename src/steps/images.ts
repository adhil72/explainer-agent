import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { config } from '../config.js';
import { formatById, type Format } from '../formats.js';
import { genai, record, withRetry } from '../llm.js';
import { usd } from '../pricing.js';
import type { JobState, Scene } from '../schema.js';
import { inlinePart } from './assets.js';
import { bytes, c, detail, dur, pool, spinner, stats, warn } from '../ui.js';

/** Pictures are named by their prompt, so an unchanged picture is reused after the script is revised. */
export const imageFile = (prompt: string) => `img/${crypto.createHash('sha1').update(prompt).digest('hex').slice(0, 12)}.png`;

/** Where each plate's parts are, as fractions of the picture: [x, y, w, h]. Saved to plates.json, read by the renderer. */
export type PartBoxes = Record<string, [number, number, number, number]>;
export interface PlateInfo { file: string; parts: PartBoxes }

const THEME_STYLE: Record<string, string> = {
  midnight: 'polished stylized 3D illustration, deep navy and indigo surroundings, subjects lit with cool cyan rim light and warm amber key light',
  paper: 'clean editorial illustration on warm cream tones, ink-like outlines, flat shapes with soft grain, muted terracotta and teal accents',
  neon: 'sleek stylized 3D illustration in a dark space, glowing neon magenta, cyan and lime accents on the subjects',
  sunset: 'painterly cinematic illustration, purple-to-orange evening light, warm golden highlights, soft atmospheric depth',
  custom: 'polished cinematic illustration matching the reference images',
};

/** Where the picture's important content must sit for this frame, so captions and platform buttons never cover it. */
function compositionRules(f: Format) {
  if (f.aspect === '9:16') {
    return `- Vertical 9:16 frame for phones. Keep every important element inside the middle band, between 12% and 62% of the height.
- The bottom third must be calm and simple (dark or plain): captions and app buttons cover it. Keep the right edge simple too.`;
  }
  if (f.aspect === '16:9') {
    return `- Wide 16:9 frame. Main subject in the central two thirds; the bottom fifth calm and simple (captions go there).`;
  }
  return `- ${f.aspect} frame. Main subject centered; the bottom quarter calm and simple (captions go there).`;
}

/** The full instructions for one scene picture. */
function platePrompt(job: JobState, sc: Scene, f: Format, anchored: boolean) {
  const art = job.script!.artDirection || THEME_STYLE[job.brief.theme] || THEME_STYLE.midnight;
  return `Create ONE illustration for a frame of a premium animated explainer video about "${job.brief.topic}".

ART DIRECTION (every picture in this video shares it; follow it exactly):
${art}${job.assets?.style ? `\nThe creator's own images set the look: ${job.assets.style}` : ''}

WHAT IT SHOWS:
${sc.plate!.prompt}

MUST BE CLEARLY VISIBLE, each as a distinct, separate, recognizable element (they will be labeled with arrows later):
${sc.plate!.parts.map((p) => `- ${p}`).join('\n')}

COMPOSITION:
${compositionRules(f)}
- Clear silhouettes and strong separation between the subject and the background. No clutter, no tiny details that turn into noise on a phone.
- Leave breathing room around each listed element so a label can sit next to it.
- Depth: a soft separation of foreground and background, light that leads the eye to the subject.
- One single continuous scene: no split panels, no collage, no inset pictures.
${anchored ? '\nSTYLE REFERENCE: the attached image is another frame of the SAME video. Match its medium, palette, lighting, line quality and rendering exactly. Do not copy its content.\n' : ''}
DO NOT INCLUDE: any text, letters, numbers, labels, captions, arrows, callout lines, user interface, logos, watermarks, signatures, borders or frames.`;
}

const InspectSchema = z.object({
  hasText: z.boolean().describe('True if any readable or pseudo text, letters, numbers or labels are visible'),
  parts: z.array(z.object({
    name: z.string(),
    found: z.boolean(),
    box_2d: z.array(z.number()).describe('[ymin, xmin, ymax, xmax], each 0-1000'),
  })),
  problems: z.string().describe('Anything that would look wrong in a professional explainer (empty string if fine)'),
});

/** Look at a picture: is there text in it, and where is each named part (as fractions of the picture)? */
async function inspect(file: string, parts: string[]) {
  const res = await withRetry('inspect', () => genai().models.generateContent({
    model: config.visionModel,
    contents: [{ role: 'user', parts: [inlinePart(file), { text: `Find each of these in the picture and give its bounding box as box_2d [ymin, xmin, ymax, xmax] normalized to 0-1000:
${parts.map((p) => `- ${p}`).join('\n')}
Set found=false if it is not clearly visible. Also report whether any text, letters or numbers appear anywhere in the picture.` }] }],
    config: { responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(InspectSchema) as any, thinkingConfig: { thinkingLevel: 'LOW' as any } },
  }));
  record(config.visionModel, res.usageMetadata);
  const r = InspectSchema.parse(JSON.parse(res.text ?? '{}'));
  const boxes: PartBoxes = {};
  for (const p of r.parts) {
    if (!p.found || p.box_2d.length !== 4) continue;
    const [y0, x0, y1, x1] = p.box_2d.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
    if (x1 > x0 && y1 > y0) boxes[parts.find((n) => n.toLowerCase() === p.name.toLowerCase()) ?? p.name] = [x0, y0, x1 - x0, y1 - y0];
  }
  return { hasText: r.hasText, boxes, problems: r.problems, missing: parts.filter((p) => !boxes[p]) };
}

async function draw(prompt: string, aspect: string, refs: any[] = []): Promise<Buffer> {
  const res = await withRetry('image', () => genai().models.generateContent({
    model: config.imageModel,
    contents: [{ role: 'user', parts: [...refs, { text: prompt }] }],
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
  }));
  record(config.imageModel, res.usageMetadata, 'image');
  const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error(`no picture (${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'empty'})`);
  stats.images++;
  return Buffer.from(part.inlineData.data, 'base64');
}

const legacyStyle = (theme: string, own?: string) => own
  ? `Style: match the reference images exactly in medium, lighting, texture and color mood (${own}). It must look like it belongs to the same set.
Absolutely no text, letters, numbers, captions, logos or watermarks in the picture.`
  : `Style: ${THEME_STYLE[theme] ?? THEME_STYLE.midnight}, bold simple shapes, depth, clean composition with the subject centered and some empty space around it.
Absolutely no text, letters, numbers, captions, logos or watermarks in the picture.`;

/**
 * Draw every picture the video needs:
 * - illustrated style: one plate per scene. The first plate is drawn alone and then sent with every other one as a style
 *   reference, so the whole video looks like one set. Each plate is checked by the vision model (no text in it, the named parts
 *   visible) and drawn again once if it fails; the parts' positions go to plates.json for the arrows and camera moves.
 * - other styles: the image beats.
 * - always: the thumbnail / cover background.
 */
export async function images(job: JobState) {
  const f = formatById(job.brief.formatId);
  const script = job.script!;
  fs.mkdirSync(path.join(job.dir, 'public', 'img'), { recursive: true });
  const pub = (file: string) => path.join(job.dir, 'public', file);
  const platesPath = path.join(job.dir, 'plates.json');
  const plates: Record<string, PlateInfo> = fs.existsSync(platesPath) ? JSON.parse(fs.readFileSync(platesPath, 'utf8')) : {};

  // The creator's images go along as style references (up to 3).
  const refFiles = (job.assets?.images ?? []).filter((im) => im.usable).slice(0, 3).map((im) => pub(job.assets!.files[im.index]));
  const ownRefs = refFiles.flatMap((file, i) => [{ text: `Style reference ${i + 1} (the creator's own image):` }, inlinePart(file)]);
  if (ownRefs.length) detail(`matching the style of ${refFiles.length} of your images`);

  // ---- scene plates ----
  const scenes = script.scenes.map((sc, si) => ({ sc, si })).filter(({ sc }) => sc.plate);
  if (scenes.length) {
    const key = (si: number) => `scene${si}`;
    const fileFor = (sc: Scene) => sc.plate!.asset ?? imageFile(`plate:${script.artDirection}:${sc.plate!.prompt}:${sc.plate!.parts.join('|')}:${f.aspect}`);
    const todo = scenes.filter(({ sc, si }) => !(fs.existsSync(pub(fileFor(sc))) && plates[key(si)]?.file === fileFor(sc)));
    if (scenes.length > todo.length) detail(`${scenes.length - todo.length} scene picture(s) reused from before`);
    if (script.artDirection) detail(`art direction: ${script.artDirection.slice(0, 160)}${script.artDirection.length > 160 ? '…' : ''}`);
    const spin = spinner(`Drawing ${todo.length} scene picture(s) with ${config.imageModel}`);
    let done = 0, redrawn = 0;
    const lines: string[] = [];
    // The style anchor: an existing plate, or the first one drawn now (alone, before the rest).
    let anchor = scenes.map(({ sc }) => fileFor(sc)).find((file) => fs.existsSync(pub(file)) && !script.scenes.some((s) => s.plate?.asset === file));
    const make = async ({ sc, si }: { sc: Scene; si: number }) => {
      const file = fileFor(sc);
      const t0 = Date.now();
      try {
        if (!sc.plate!.asset) {
          const anchorRefs = anchor && anchor !== file ? [{ text: 'Style reference (another frame of this video):' }, inlinePart(pub(anchor))] : [];
          const prompt = platePrompt(job, sc, f, anchorRefs.length > 0);
          fs.writeFileSync(pub(file), await draw(prompt, f.aspect, [...ownRefs, ...anchorRefs]));
          spin.update(`Checking scene ${si + 1} picture · run ${usd(stats.cost)}`);
          let check = await inspect(pub(file), sc.plate!.parts);
          // One redraw when the picture has text in it or misses most of what it must show.
          if (check.hasText || check.missing.length > sc.plate!.parts.length / 2) {
            redrawn++;
            const why = [check.hasText && 'it contained text or letters', check.missing.length && `these were not clearly visible: ${check.missing.join(', ')}`, check.problems].filter(Boolean).join('; ');
            spin.update(`Redrawing scene ${si + 1} picture (${why.slice(0, 60)}) · run ${usd(stats.cost)}`);
            fs.writeFileSync(pub(file), await draw(`${prompt}\n\nA FIRST ATTEMPT FAILED because ${why}. Fix that: no text at all, and make every listed element large and unmistakable.`, f.aspect, [...ownRefs, ...anchorRefs]));
            check = await inspect(pub(file), sc.plate!.parts);
          }
          plates[key(si)] = { file, parts: check.boxes };
          lines.push(`scene ${si + 1}: ${file} ${bytes(fs.statSync(pub(file)).size)} in ${dur(Date.now() - t0)} · parts found ${Object.keys(check.boxes).length}/${sc.plate!.parts.length}${check.missing.length ? ` (missing: ${check.missing.join(', ')})` : ''}${check.hasText ? c.yellow(' · still has text') : ''}`);
        } else {
          const check = await inspect(pub(file), sc.plate!.parts);
          plates[key(si)] = { file, parts: check.boxes };
          lines.push(`scene ${si + 1}: your image ${file} · parts found ${Object.keys(check.boxes).length}/${sc.plate!.parts.length}`);
        }
      } catch (e) {
        warn(`Scene ${si + 1} picture failed: ${(e as Error).message.slice(0, 120)}`);
      }
      spin.update(`Drawing scene pictures ${++done}/${todo.length}${redrawn ? ` (${redrawn} redrawn)` : ''} · run ${usd(stats.cost)}`);
    };
    // With no style anchor yet, the first picture is drawn alone and becomes the anchor for the rest.
    const first = anchor ? undefined : todo.find(({ sc }) => !sc.plate!.asset);
    if (first) {
      await make(first);
      if (plates[key(first.si)]) anchor = fileFor(first.sc);
    }
    await pool(todo.filter((t) => t !== first), 3, make);
    fs.writeFileSync(platesPath, JSON.stringify(plates, null, 1));
    spin.done('Scene pictures ready', `${Object.keys(plates).length}/${scenes.length} scenes${redrawn ? `, ${redrawn} redrawn after the check` : ''}`);
    lines.forEach((l) => detail(l));
  }

  // ---- image beats (non-illustrated styles) and the thumbnail ----
  const extra: { file: string; prompt: string; aspect: string }[] = [];
  script.scenes.forEach((sc) => sc.beats.forEach((b) => {
    if (b.kind !== 'image' || !b.imagePrompt || b.asset) return;
    extra.push({ file: imageFile(b.imagePrompt), prompt: `${b.imagePrompt}\n\n${legacyStyle(job.brief.theme, job.assets?.style)}`, aspect: f.aspect });
  }));
  const art = script.artDirection ? `\nART DIRECTION: ${script.artDirection}` : '';
  extra.push({ file: imageFile(`thumb:${script.thumbnailPrompt}:${script.artDirection ?? ''}`), aspect: f.id === 'yt' ? '16:9' : f.aspect,
    prompt: `Thumbnail background for "${script.title}": ${script.thumbnailPrompt}
One striking subject, very high contrast and saturation, readable at a tiny size. Put the subject on the ${f.id === 'yt' ? 'right half; keep the left half darker and simple for big text' : 'lower half; keep the top area simple for big text'}.${art}
DO NOT INCLUDE any text, letters, numbers, logos or watermarks.` });
  const todo = extra.filter((j) => !fs.existsSync(pub(j.file)));
  if (!todo.length) return;
  const anchorRef = Object.values(plates)[0] ? [{ text: 'Style reference (a frame of this video):' }, inlinePart(pub(Object.values(plates)[0].file))] : [];
  const spin = spinner(`Drawing ${todo.length} more picture(s)`);
  let n = 0;
  const lines: string[] = [];
  await pool(todo, 3, async (j) => {
    const t0 = Date.now();
    try {
      const img = await draw(j.prompt, j.aspect, [...ownRefs, ...anchorRef]);
      fs.writeFileSync(pub(j.file), img);
      lines.push(`${j.file} ${j.aspect} ${bytes(img.length)} in ${dur(Date.now() - t0)} — ${j.prompt.split('\n')[0].slice(0, 70)}`);
    } catch (e) {
      warn(`Picture ${j.file} failed: ${(e as Error).message.slice(0, 120)}`);
    }
    spin.update(`Drawing pictures ${++n}/${todo.length} · run ${usd(stats.cost)}`);
  });
  spin.done('Pictures ready', `${lines.length}/${todo.length} ok, ${config.imageModel}`);
  lines.forEach((l) => detail(l));
}

/** Read plates.json for the renderer. */
export const readPlates = (job: JobState): Record<string, PlateInfo> => {
  const p = path.join(job.dir, 'plates.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
