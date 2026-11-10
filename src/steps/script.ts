import { config } from '../config.js';
import { formatById, isShort } from '../formats.js';
import { askJson, peekField } from '../llm.js';
import { EDITOR, WRITER, WORDS_PER_SEC, beatGuide, formatLine, retentionPlaybook } from '../prompts.js';
import { ScriptSchema, type JobState, type Script } from '../schema.js';
import { ALLOWED_ICONS, iconFor } from '../../video/icons.js';
import { c, out } from '../ui.js';
import { write } from '../job.js';
import { assetsForWriter } from './assets.js';

const context = (job: JobState) => {
  const b = job.brief;
  const f = formatById(b.formatId);
  const words = Math.round(b.seconds * WORDS_PER_SEC);
  return `Topic: ${b.topic}
Video: ${formatLine(b)}
${retentionPlaybook(f)}
${beatGuide(f, b.images || !!assetsForWriter(job), illustrated(job), b.theme)}${assetsForWriter(job).replace('use them with kind "image" and asset = file name', illustrated(job) ? 'use one as a scene plate with plate.asset = file name (then list parts you can see in it)' : 'use them with kind "image" and asset = file name')}${!b.images && assetsForWriter(job) && !illustrated(job) ? '\nDo not use imagePrompt: only the creator\'s own images may be used for image beats.\n' : ''}
ALLOWED ICONS: ${ALLOWED_ICONS.join(', ')}

LENGTH: total narration must be ${Math.round(words * 0.9)}-${Math.round(words * 1.08)} words. ${isShort(f)
    ? 'Use 3-6 scenes.'
    : `Use ${Math.max(4, Math.round(b.seconds / 40))}-${Math.max(6, Math.round(b.seconds / 25))} scenes (chapters).`}
Each scene: narration of 1-6 sentences, and one beat per ~${isShort(f) ? '2.5' : '3.5'} seconds of its narration.

CHOSEN ANGLE:
${JSON.stringify(job.chosen, null, 1)}

RESEARCH NOTES:
${job.research?.notes ?? '(none)'}`;
};

/** True when every scene is explained on its own illustration. */
export const illustrated = (job: JobState) => (job.brief.visual ?? (job.brief.images ? 'mixed' : 'graphics')) === 'illustrated';

const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Clean what the model wrote: unknown icons removed, image beats dropped when pictures are off, too many pictures trimmed. */
function tidy(job: JobState, s: Script): Script {
  let images = 0;
  const ill = illustrated(job);
  for (const scene of s.scenes) {
    // Plates: only in the illustrated style; a plate must have a picture source and named parts.
    if (!ill) scene.plate = undefined;
    if (scene.plate) {
      if (scene.plate.asset && !job.assets?.files.includes(scene.plate.asset)) scene.plate.asset = undefined;
      scene.plate.parts = scene.plate.parts.map((p) => p.trim()).filter(Boolean).slice(0, 6);
    }
    const parts = scene.plate?.parts ?? [];
    for (const beat of scene.beats) {
      if (beat.kind === 'point' || beat.kind === 'zoom' || beat.kind === 'wide') {
        if (!scene.plate) { beat.kind = 'title'; beat.focus = undefined; continue; }
        const hit = beat.focus ? parts.find((p) => same(p, beat.focus!)) : undefined;
        beat.focus = hit;
        if (beat.kind !== 'wide' && !hit) beat.kind = 'wide';
      }
    }
    scene.beats = scene.beats.filter((beat) => {
      if (beat.kind !== 'image') return true;
      if (beat.asset) {
        if (job.assets?.files.includes(beat.asset)) { beat.imagePrompt = undefined; return true; }
        beat.asset = undefined;
      }
      if (!job.brief.images || !beat.imagePrompt || images >= config.maxImages) return false;
      images++;
      return true;
    });
    if (!scene.beats.length) scene.beats.push({ cue: scene.narration.split(/\s+/).slice(0, 3).join(' '), kind: 'title', heading: scene.chapter });
    for (const beat of scene.beats) {
      if (beat.icon && !iconFor(beat.icon)) beat.icon = undefined;
      for (const it of beat.items ?? []) if (it.icon && !iconFor(it.icon)) it.icon = undefined;
      for (const side of [beat.left, beat.right]) if (side?.icon && !iconFor(side.icon)) side.icon = undefined;
    }
  }
  return s;
}

/** First draft, then a retention edit of that draft. */
export async function writeScript(job: JobState): Promise<Script> {
  const draft = await askJson({
    label: 'Writing the script and planning the visuals',
    peek: peekField('chapter', 'scene'),
    model: job.brief.model || config.writerModel,
    system: WRITER,
    thinking: 'HIGH',
    schema: ScriptSchema,
    prompt: `${context(job)}\n\nWrite the full video: narration per scene and the beats (visuals) for each scene.`,
  });
  const edited = await askJson({
    label: 'Retention edit (tightening hook, pacing, visuals)',
    peek: peekField('chapter', 'scene'),
    model: job.brief.model || config.writerModel,
    system: EDITOR,
    thinking: 'HIGH',
    schema: ScriptSchema,
    prompt: `${context(job)}

DRAFT SCRIPT:
${JSON.stringify(draft)}

Go through the draft second by second as a viewer about to swipe away. Fix: a hook that is not instantly gripping, any sentence longer
than 16 words, filler, vague claims (make them concrete), a payoff given away too early, beats that repeat the same kind back to back,
on-screen text longer than 7 words, cues not copied exactly from the narration, the length target. Return the complete improved script.`,
  });
  return tidy(job, edited);
}

export async function reviseScript(job: JobState, feedback: string): Promise<Script> {
  const s = await askJson({
    label: 'Revising the script',
    peek: peekField('chapter', 'scene'),
    model: job.brief.model || config.writerModel,
    system: WRITER,
    thinking: 'HIGH',
    schema: ScriptSchema,
    prompt: `${context(job)}

CURRENT SCRIPT:
${JSON.stringify(job.script)}

THE CREATOR'S CHANGES (apply them exactly, keep everything else that works, keep the retention rules):
${feedback}

Return the complete revised script.`,
  });
  return tidy(job, s);
}

const beatLine = (b: Script['scenes'][number]['beats'][number]) => {
  const bits = [b.heading, b.value !== undefined ? `${b.prefix ?? ''}${b.value}${b.suffix ?? ''}` : '', b.items?.map((i) => i.label + (i.value !== undefined ? `=${i.value}` : '')).join(' · '),
    b.left && b.right ? `${b.left.title} vs ${b.right.title}` : '', b.asset ? `📁 ${b.asset}` : b.imagePrompt ? `🖼 ${b.imagePrompt}` : '', b.icon ? `[${b.icon}]` : ''].filter(Boolean);
  return `${b.kind.padEnd(8)} @"${b.cue}"  ${b.focus ? `→ ${b.focus}  ` : ''}${bits.join('  ')}`;
};

const plateLine = (sc: Script['scenes'][number]) =>
  sc.plate ? `${sc.plate.asset ? `📁 ${sc.plate.asset}` : `🖼 ${sc.plate.prompt}`}  ·  parts: ${sc.plate.parts.join(', ')}` : '';

/** Print the script for review and save it as markdown. */
export function showScript(job: JobState, s: Script) {
  const words = s.scenes.reduce((n, sc) => n + sc.narration.split(/\s+/).length, 0);
  out(`\n  ${c.bold(s.title)}  ${c.dim(`~${Math.round(words / WORDS_PER_SEC)}s, ${words} words, ${s.scenes.length} scenes`)}`);
  out(`  ${c.dim('Thumbnail:')} ${s.thumbnailText}`);
  if (s.artDirection && illustrated(job)) out(`  ${c.dim('Art direction:')} ${s.artDirection}`);
  s.scenes.forEach((sc, i) => {
    out(`\n  ${c.magenta(`${i + 1}. ${sc.chapter}`)}`);
    if (sc.plate) out(`  ${c.cyan(plateLine(sc))}`);
    out(`  ${sc.narration.replace(/(.{1,100})(\s|$)/g, '$1\n  ').trimEnd()}`);
    for (const b of sc.beats) out(`    ${c.dim('▸ ' + beatLine(b))}`);
  });
  const md = [`# ${s.title}`, '', `Thumbnail: **${s.thumbnailText}**`, '',
    ...(s.artDirection ? [`Art direction: ${s.artDirection}`, ''] : []),
    ...s.scenes.flatMap((sc, i) => [`## ${i + 1}. ${sc.chapter}`, '', ...(sc.plate ? [`> ${plateLine(sc)}`, ''] : []), sc.narration, '', ...sc.beats.map((b) => `- ${beatLine(b)}`), ''])].join('\n');
  write(job, 'script.md', md);
  write(job, 'script.json', JSON.stringify(s, null, 2));
}
