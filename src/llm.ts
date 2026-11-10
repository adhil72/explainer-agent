import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { JOBS_DIR, config } from './config.js';
import { z } from 'zod';
import { costOf, usd } from './pricing.js';
import { c, num, out, spinner, stats } from './ui.js';

let client: GoogleGenAI | null = null;
/** Reads GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_CLOUD_PROJECT / GOOGLE_APPLICATION_CREDENTIALS (or GEMINI_API_KEY) from the environment. */
export const genai = () => (client ??= new GoogleGenAI({}));

const RETRYABLE = /\b(429|500|503|504)\b|RESOURCE_EXHAUSTED|overloaded|unavailable|fetch failed|ECONNRESET|deadline|terminated/i;

/** Call Gemini, waiting and trying again when Vertex is busy or over quota. */
export async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (const wait of [0, 4_000, 10_000, 25_000, 45_000]) {
    if (wait) {
      out(`            ${c.yellow('↻')} ${label}: ${String((last as Error)?.message ?? last).slice(0, 80)} — retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait + Math.random() * 1000));
    }
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!RETRYABLE.test(String((e as Error)?.message ?? e))) throw e;
    }
  }
  throw last;
}

interface Usage { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }

/**
 * Add one finished call to the run totals (tokens and USD) and return its log line. Used for text, picture and voice calls alike.
 * Thinking tokens are billed as output.
 */
export function record(model: string, u: Usage | undefined, kind: 'text' | 'image' | 'tts' = 'text') {
  const i = u?.promptTokenCount ?? 0, o = u?.candidatesTokenCount ?? 0, t = u?.thoughtsTokenCount ?? 0;
  if (kind === 'text') stats.llmCalls++;
  stats.tokensIn += i;
  stats.tokensOut += o;
  stats.tokensThinking += t;
  const cost = costOf(model, i, o + t);
  const m = (stats.byModel[model] ??= { calls: 0, input: 0, output: 0, cost: null });
  m.calls++; m.input += i; m.output += o + t;
  if (cost !== null) { m.cost = (m.cost ?? 0) + cost; stats.cost += cost; } else if (i + o + t > 0) stats.unpriced.add(model);
  return { cost, line: `${model} · ${num(i)} in / ${num(o)} out${t ? ` + ${num(t)} thinking` : ''} · ${cost === null ? 'no price set' : usd(cost)} · run ${usd(stats.cost)}` };
}

export interface Source { title: string; url: string }

interface AskBase {
  label: string;
  model: string;
  system: string;
  prompt: string;
  /** LOW is quicker; HIGH for the script writer. */
  thinking?: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Extra parts sent before the prompt, e.g. images to look at. */
  parts?: any[];
  /** Short note on what is being written so far, from the partial answer (e.g. "scene 3: The Discovery"). */
  peek?: (partial: string) => string;
}

/**
 * Stream one answer, keeping the spinner line live: phase (thinking / writing), tokens so far, cost so far, the run total, and what
 * is being written. Before the API reports usage, tokens are estimated (about 4 characters a token) and shown with "~".
 */
/** Thrown when an answer is cut off because the model got stuck: repeating itself, silent too long, or running too long. */
export class RunawayError extends Error {
  constructor(msg: string, public partialChars: number, public usage?: Usage, public partial = '') { super(msg); }
}

/** No new data for this long means the call is stuck (thinking at HIGH can be silent for a minute or two). */
const IDLE_MS = 180_000;
/** A single answer never needs longer than this. */
const TOTAL_MS = 360_000;

/** True when the end of the text has already appeared several times: the model is looping. */
function looping(text: string) {
  if (text.length < 3000) return false;
  const tail = text.slice(-160);
  let n = 0, at = -1;
  while ((at = text.indexOf(tail, at + 1)) !== -1) if (++n >= 4) return true;
  return false;
}

async function streamOnce(o: AskBase, contents: any[], config: Record<string, unknown>, spin: ReturnType<typeof spinner>, tag = '') {
  const promptChars = JSON.stringify(contents).length + o.system.length;
  return withRetry(o.label, async () => {
    const abort = new AbortController();
    let why = '';
    const stream = await genai().models.generateContentStream({ model: o.model, contents, config: { systemInstruction: o.system, ...config, abortSignal: abort.signal } });
    let text = '';
    let usage: Usage | undefined;
    let grounding: any;
    let finish = '';
    const t0 = Date.now();
    let lastChunk = Date.now();
    let firstText = 0;
    const watchdog = () => {
      if (why) return;
      if (looping(text)) why = 'the model started repeating itself';
      else if (Date.now() - lastChunk > IDLE_MS) why = `no response for ${IDLE_MS / 60000} minutes`;
      else if (Date.now() - t0 > TOTAL_MS) why = `the answer took over ${TOTAL_MS / 60000} minutes`;
      if (why) abort.abort();
    };
    const paint = () => {
      watchdog();
      const inTok = usage?.promptTokenCount ?? Math.round(promptChars / 4);
      const outTok = usage?.candidatesTokenCount ?? Math.round(text.length / 4);
      const think = usage?.thoughtsTokenCount ?? 0;
      const exact = !!usage;
      const cost = costOf(o.model, inTok, outTok + think);
      const phase = !text ? c.yellow(think ? `thinking (${num(think)})` : 'thinking') : c.cyan('writing');
      const speed = firstText && text ? ` ${Math.round(outTok / Math.max(0.2, (Date.now() - firstText) / 1000))} tok/s` : '';
      const peek = text && o.peek ? o.peek(text) : '';
      spin.update(`${o.label}${tag} ${c.dim('·')} ${phase} ${c.dim(`· ${exact ? '' : '~'}${num(inTok)} in · ${exact ? '' : '~'}${num(outTok)} out${think ? ` + ${num(think)} think` : ''}${speed} · ${cost === null ? 'no price' : usd(cost)} · run ${usd(stats.cost + (cost ?? 0))}`)}${peek ? ` ${c.magenta('▸')} ${peek}` : ''}`);
    };
    const timer = setInterval(paint, 250);
    try {
      for await (const chunk of stream) {
        lastChunk = Date.now();
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
        const cand = chunk.candidates?.[0];
        if (cand?.groundingMetadata) grounding = cand.groundingMetadata;
        if (cand?.finishReason) finish = String(cand.finishReason);
        const piece = cand?.content?.parts?.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('') ?? '';
        if (piece) { if (!firstText) firstText = Date.now(); text += piece; }
        if (why) break;
      }
    } catch (e) {
      if (!why) throw e;
    } finally {
      clearInterval(timer);
    }
    const estimate = { promptTokenCount: usage?.promptTokenCount ?? Math.round(promptChars / 4), candidatesTokenCount: usage?.candidatesTokenCount ?? Math.round(text.length / 4), thoughtsTokenCount: usage?.thoughtsTokenCount };
    if (why) throw new RunawayError(why, text.length, estimate, text);
    if (finish === 'MAX_TOKENS') throw new RunawayError('the answer hit the length limit (usually the model looping)', text.length, estimate, text);
    return { text, usage, grounding };
  });
}

/** Log a cut-off answer, count what it cost, and say it is being asked again from scratch. */
function runaway(o: AskBase, e: RunawayError, attempt: number, max: number) {
  const { line } = record(o.model, e.usage);
  // Keep the cut-off answer for a look: jobs/_last-runaway.txt
  try { fs.writeFileSync(path.join(JOBS_DIR, '_last-runaway.txt'), `${o.model} · ${o.label} · ${e.message}\n\n${e.partial}`); } catch { /* not important */ }
  out(`            ${c.yellow('⚠')} ${o.label}: stopped, ${e.message} (${num(e.partialChars)} characters). ${attempt < max ? `Asking again from scratch (${attempt + 1}/${max}).` : 'Giving up.'} ${c.dim(line)}`);
}

/** Free text answer, optionally grounded in Google Search. */
export async function askText(o: AskBase & { search?: boolean }): Promise<{ text: string; sources: Source[]; queries: string[] }> {
  const spin = spinner(o.label);
  try {
    let res: Awaited<ReturnType<typeof streamOnce>> | null = null;
    for (let attempt = 1; !res; attempt++) {
      try {
        res = await streamOnce(o, [{ role: 'user', parts: [...(o.parts ?? []), { text: o.prompt }] }], {
          maxOutputTokens: 16384,
          ...(o.search && { tools: [{ googleSearch: {} }] }),
          ...(o.thinking && { thinkingConfig: { thinkingLevel: o.thinking as any } }),
        }, spin, attempt > 1 ? c.yellow(` (try ${attempt})`) : '');
      } catch (e) {
        if (!(e instanceof RunawayError)) throw e;
        runaway(o, e, attempt, 3);
        if (attempt >= 3) throw e;
      }
    }
    const gm = res.grounding;
    const seen = new Set<string>();
    const sources: Source[] = [];
    for (const ch of gm?.groundingChunks ?? []) {
      const title = ch.web?.title ?? ch.web?.domain ?? '';
      if (!ch.web?.uri || seen.has(title)) continue;
      seen.add(title);
      sources.push({ title, url: ch.web.uri });
    }
    const queries: string[] = gm?.webSearchQueries ?? [];
    stats.searches += queries.length;
    const { line } = record(o.model, res.usage);
    spin.done(o.label, `${line}${o.search ? ` · ${queries.length} searches, ${sources.length} sources` : ''}`);
    return { text: res.text, sources, queries };
  } catch (e) {
    spin.fail(o.label);
    throw e;
  }
}

const KEEP = new Set(['type', 'properties', 'items', 'required', 'enum', 'description', 'anyOf', 'minItems', 'maxItems']);
/** Keep only the JSON Schema keywords Gemini accepts. */
function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const res: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'properties' && v && typeof v === 'object') {
      res.properties = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, sanitize(s)]));
    } else if (KEEP.has(k)) res[k] = sanitize(v);
  }
  return res;
}

const extractJson = (s: string) => {
  const t = s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = Math.min(...['{', '['].map((ch) => t.indexOf(ch)).filter((i) => i >= 0));
  return JSON.parse(Number.isFinite(a) ? t.slice(a) : t);
};

const REPAIRER = `You repair broken JSON. You get a JSON answer that is malformed or does not match the required schema, and the
errors found in it. Return the same content as valid JSON matching the schema: fix syntax (quotes, commas, brackets, escapes), fill a
missing required field with a sensible value taken from the surrounding content, drop text that repeats itself, and close anything cut
off. Keep every other value exactly as it is. Return only the JSON.`;

/** Parse and check an answer against the schema; on failure, the problems as text for a fixer. */
function validate<T extends z.ZodType>(schema: T, raw: string): { ok: true; data: z.infer<T> } | { ok: false; problem: string; problems: number } {
  try {
    const parsed = schema.safeParse(extractJson(raw));
    if (parsed.success) return { ok: true, data: parsed.data };
    const issues = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.')}: ${i.message}`);
    return { ok: false, problem: issues.join('\n'), problems: parsed.error.issues.length };
  } catch (e) {
    return { ok: false, problem: `Not valid JSON: ${(e as Error).message}`, problems: 1 };
  }
}

/** JSON answer that must match a zod schema; a wrong answer is shown its errors and asked to fix them (up to 3 tries). */
export async function askJson<T extends z.ZodType>(o: AskBase & { schema: T }): Promise<z.infer<T>> {
  const jsonSchema = sanitize(z.toJSONSchema(o.schema, { io: 'output', unrepresentable: 'any' }));
  const spin = spinner(o.label);
  const first = () => [{ role: 'user', parts: [...(o.parts ?? []), { text: o.prompt }] }];
  let contents: any[] = first();
  let spent = 0;
  const MAX = 4;
  try {
    for (let attempt = 0; attempt < MAX; attempt++) {
      let res;
      try {
        res = await streamOnce(o, contents, {
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          maxOutputTokens: 16384,
          ...(o.thinking && { thinkingConfig: { thinkingLevel: o.thinking as any } }),
        }, spin, attempt ? c.yellow(` (try ${attempt + 1})`) : '');
      } catch (e) {
        if (!(e instanceof RunawayError)) throw e;
        runaway(o, e, attempt + 1, MAX);
        // A looping answer is not worth fixing: start over, asking for a compact answer.
        contents = first();
        contents[0].parts.push({ text: '\nKeep the JSON compact: no repeated text, no extra whitespace, every string short.' });
        continue;
      }
      const { line, cost } = record(o.model, res.usage);
      spent += cost ?? 0;
      let check = validate(o.schema, res.text);
      if (check.ok) {
        spin.done(o.label, attempt ? `${line} · after ${attempt + 1} tries, ${usd(spent)} in total` : line);
        return check.data;
      }
      let lastProblem = check.problem;
      out(`            ${c.yellow('↻')} ${o.label}: answer had ${check.problems} problem(s) ${c.dim(`(${check.problem.split('\n')[0].slice(0, 90)})`)}`);

      // Repair: a second model fixes the broken answer (much cheaper and faster than writing it again).
      const fixer = { ...o, model: config.repairModel, system: REPAIRER, peek: undefined };
      try {
        const fixed = await streamOnce(fixer, [{ role: 'user', parts: [{ text: `ERRORS:\n${check.problem}\n\nBROKEN JSON:\n${res.text}` }] }], {
          responseMimeType: 'application/json', responseJsonSchema: jsonSchema, maxOutputTokens: 16384,
        }, spin, c.yellow(` (fixing JSON with ${config.repairModel})`));
        const r = record(config.repairModel, fixed.usage);
        spent += r.cost ?? 0;
        check = validate(o.schema, fixed.text);
        if (check.ok) {
          spin.done(o.label, `${line} · JSON fixed by ${config.repairModel} (${r.cost === null ? 'no price' : usd(r.cost)}), ${usd(spent)} in total`);
          return check.data;
        }
        lastProblem = check.problem;
        out(`            ${c.yellow('↻')} ${o.label}: the repair still had ${check.problems} problem(s) ${c.dim(`(${check.problem.split('\n')[0].slice(0, 90)})`)}`);
      } catch (e) {
        if (!(e instanceof RunawayError)) throw e;
        runaway(fixer, e, 1, 1);
      }
      // Last resort: show the writer its own answer and the errors, and ask for the whole answer again.
      contents = [...first(), { role: 'model', parts: [{ text: res.text }] }, { role: 'user', parts: [{ text: `Your JSON has problems, fix them and answer again with the full JSON:\n${lastProblem}` }] }];
    }
    throw new Error(`${o.label}: the model did not return a valid answer after ${MAX} tries. Try again, or pick another model.`);
  } catch (e) {
    spin.fail(o.label);
    throw e;
  }
}

/** Peek helpers: name the last item of a list being written in a partial JSON answer. */
export const peekField = (field: string, noun: string) => (partial: string) => {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g');
  const all = [...partial.matchAll(re)];
  if (!all.length) return '';
  const last = all[all.length - 1][1].replace(/\\"/g, '"');
  return `${noun} ${all.length}: ${last.length > 40 ? last.slice(0, 39) + '…' : last}`;
};
