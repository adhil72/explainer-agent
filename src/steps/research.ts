import { config } from '../config.js';
import { askText } from '../llm.js';
import { RESEARCHER, formatLine } from '../prompts.js';
import type { JobState } from '../schema.js';
import { write } from '../job.js';
import { c, detail, out } from '../ui.js';

/** Print what the research found: the searches, the sources, and each section of the notes with its first points. */
export function showResearch(queries: string[], sources: { title: string; url: string }[], notes: string) {
  out(`  ${c.bold('Searched for')} ${c.dim(`(${queries.length})`)}`);
  queries.forEach((q) => out(`    ${c.cyan('⌕')} ${q}`));
  out(`  ${c.bold('Sources')} ${c.dim(`(${sources.length})`)}`);
  sources.forEach((s) => out(`    ${c.dim('•')} ${s.title}`));
  out(`  ${c.bold('Findings')}`);
  const sections = notes.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const [title, ...lines] = sec.split('\n');
    const points = lines.map((l) => l.trim()).filter((l) => /^([-*•]|\d+\.)\s+/.test(l)).map((l) => l.replace(/^([-*•]|\d+\.)\s+/, '').replace(/\*\*/g, ''));
    const paragraph = lines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\*\*/g, '');
    out(`    ${c.magenta('▸')} ${c.bold(title.trim())} ${c.dim(points.length ? `(${points.length} point${points.length === 1 ? "" : "s"})` : '')}`);
    const show = points.length ? points.slice(0, 3) : [paragraph];
    for (const p of show) out(`      ${c.dim('·')} ${p.length > 150 ? p.slice(0, 147) + '…' : p}`);
    if (points.length > 3) out(`      ${c.dim(`· …and ${points.length - 3} more`)}`);
  }
}

/** Search the web and write research notes the writer builds on. */
export async function research(job: JobState) {
  const b = job.brief;
  const { text, sources, queries } = await askText({
    label: 'Researching the topic on the web',
    peek: (p) => { const h = [...p.matchAll(/^##\s+(.+)$/gm)]; return h.length ? `section ${h.length}: ${h[h.length - 1][1].slice(0, 40)}` : ''; },
    model: job.brief.model || config.writerModel,
    system: RESEARCHER,
    search: true,
    thinking: 'HIGH',
    prompt: `Topic: ${b.topic}
Video: ${formatLine(b)}

Research this topic for an explainer video. Search several times from different angles. Write compact markdown notes with these sections:
## Core explanation (how it actually works, simply)
## Key facts and numbers (each with year, unit, and source name)
## Surprising / counter-intuitive facts (the "wait, what?" moments)
## Common misconceptions (and the truth)
## Stories, people, events (concrete moments that can be told as a story)
## Timeline (if relevant)
## Comparisons to everyday things (to make scale feel real)
## Latest developments (with dates)
## Open questions / debates
Be specific and accurate. No filler.`,
  });
  job.research = { notes: text, sources };
  showResearch(queries, sources, text);
  detail(`${text.split(/\s+/).length.toLocaleString()} words of notes`);
  write(job, 'research.md', `# Research: ${b.topic}\n\n${text}\n\n## Searches\n${queries.map((q) => `- ${q}`).join('\n')}\n\n## Sources\n${sources.map((s) => `- [${s.title}](${s.url})`).join('\n')}\n`);
}
