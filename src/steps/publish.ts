import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { formatById } from '../formats.js';
import { askJson } from '../llm.js';
import { STRATEGIST } from '../prompts.js';
import { PublishSchema, type JobState } from '../schema.js';
import type { Timing } from '../../video/spec.js';
import { write } from '../job.js';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** YouTube chapters: first at 0:00, each at least 10s, at least 3 of them; otherwise none. */
function chapters(job: JobState, timing: Timing): string {
  const list: { t: number; name: string }[] = [];
  job.script!.scenes.forEach((sc, i) => {
    const t = i === 0 ? 0 : timing.scenes[i].start;
    if (list.length && t - list[list.length - 1].t < 10) return;
    list.push({ t, name: sc.chapter });
  });
  if (list.length < 3 || timing.duration - list[list.length - 1].t < 10) return '';
  return list.map((c) => `${clock(c.t)} ${c.name}`).join('\n');
}

/** Titles, description, tags, hashtags and a pinned comment, written to out/publish.md. */
export async function publishPack(job: JobState): Promise<string> {
  const f = formatById(job.brief.formatId);
  const timing = JSON.parse(fs.readFileSync(path.join(job.dir, 'timing.json'), 'utf8')) as Timing;
  const narration = job.script!.scenes.map((s) => s.narration).join('\n');
  const p = await askJson({
    label: 'Writing title, description, tags and hashtags',
    model: job.brief.model || config.writerModel,
    system: STRATEGIST,
    thinking: 'LOW',
    schema: PublishSchema,
    prompt: `Write the publishing copy for this ${f.label} (${Math.round(timing.duration)}s) in ${job.brief.language}.
Platform rules: ${f.platform === 'youtube' && f.id === 'yt'
      ? 'YouTube: titles under 60 chars, curiosity + keyword early; description first 2 lines are the hook (shown above the fold), then a short summary, then 1-2 lines inviting comments.'
      : f.platform === 'youtube'
        ? 'YouTube Shorts: titles under 50 chars; description 1-3 lines.'
        : 'Instagram/TikTok: caption starts with a scroll-stopping first line, short paragraphs, ends with a question that invites comments; titles are cover-text ideas.'}
Do not use clickbait that the video does not deliver.

VIDEO TITLE: ${job.script!.title}
NARRATION:
${narration}`,
  });
  const ch = f.id === 'yt' ? chapters(job, timing) : '';
  const sources = job.research?.sources.slice(0, 8).map((s) => `- ${s.title}`).join('\n') ?? '';
  const desc = [p.description, ch && `\nChapters:\n${ch}`, sources && `\nSources:\n${sources}`, `\n${p.hashtags.join(' ')}`].filter(Boolean).join('\n');
  const md = `# Publish pack

## Title options
${p.titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}

## ${f.platform === 'instagram' || f.platform === 'tiktok' ? 'Caption' : 'Description'} (copy-paste)
\`\`\`
${desc}
\`\`\`
${f.platform === 'youtube' ? `\n## Tags\n\`\`\`\n${p.tags.join(', ')}\n\`\`\`\n` : ''}
## Pinned comment
${p.pinnedComment}

## Cover text
${p.coverText}
`;
  return write(job, 'out/publish.md', md);
}
