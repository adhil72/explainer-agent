import { config } from '../config.js';
import { formatById } from '../formats.js';
import { askJson, peekField } from '../llm.js';
import { STRATEGIST, formatLine, retentionPlaybook } from '../prompts.js';
import { OptionsSchema, type JobState, type VideoOption } from '../schema.js';

/** Turn the research into 3-4 different story angles to pick from. */
export async function makeOptions(job: JobState, feedback?: string, previous?: VideoOption[]): Promise<VideoOption[]> {
  const b = job.brief;
  const f = formatById(b.formatId);
  const res = await askJson({
    label: feedback ? 'Reworking the options' : 'Finding the best angles',
    peek: peekField('title', 'option'),
    model: job.brief.model || config.writerModel,
    system: STRATEGIST,
    thinking: 'MEDIUM',
    schema: OptionsSchema,
    prompt: `Topic: ${b.topic}
Video: ${formatLine(b)}
${retentionPlaybook(f)}

RESEARCH NOTES:
${job.research?.notes ?? '(none)'}

Propose 3 genuinely different angles for this video (different story, not just different wording): for example a mystery to solve,
a myth to bust, a "what if", a countdown, a story of one person/event, a "how it works under the hood". Each must fit the length.
${previous ? `\nPREVIOUS OPTIONS:\n${JSON.stringify(previous, null, 1)}\n` : ''}${feedback ? `\nTHE CREATOR'S FEEDBACK (follow it):\n${feedback}\n` : ''}`,
  });
  return res.options;
}
