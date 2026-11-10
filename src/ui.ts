import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const wrap = (code: number) => (s: string | number) => `\x1b[${code}m${s}\x1b[0m`;
export const c = {
  bold: wrap(1), dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), blue: wrap(34), magenta: wrap(35), cyan: wrap(36),
};

// ---------- log file: every printed line is also written (without colors) to jobs/<id>/log.txt ----------

let logPath: string | null = null;
const started = Date.now();
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function setLogFile(path: string) {
  logPath = path;
  fs.appendFileSync(path, `\n===== ${stamp()} =====\n`);
}

/** Print a line and append it to the log file. */
export function out(line = '') {
  console.log(line);
  if (logPath) fs.appendFileSync(logPath, `${stamp()}  ${stripAnsi(line)}\n`);
}

// ---------- time and size formatting ----------

export const dur = (ms: number) => {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
};
export const bytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const num = (n: number) => n.toLocaleString('en-US');
/** Elapsed time since the program started, shown in front of step lines. */
const clock = () => c.dim(`[${dur(Date.now() - started).padStart(7)}]`);

// ---------- run statistics, printed as a summary at the end ----------

export const stats = {
  llmCalls: 0, tokensIn: 0, tokensOut: 0, tokensThinking: 0, searches: 0, images: 0, ttsClips: 0,
  /** USD spent so far on models that have a price. */
  cost: 0,
  byModel: {} as Record<string, { calls: number; input: number; output: number; cost: number | null }>,
  /** Models used that have no price in prices.json. */
  unpriced: new Set<string>(),
  steps: [] as { name: string; ms: number }[],
};

const usdFmt = (v: number) => (v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);

/** Cut a colored line to `width` visible characters (keeps color codes, adds an ellipsis), so a live line never wraps. */
function fitLine(s: string, width: number) {
  let visible = 0, i = 0, res = '';
  while (i < s.length) {
    const m = /^\x1b\[[0-9;]*[A-Za-z]/.exec(s.slice(i));
    if (m) { res += m[0]; i += m[0].length; continue; }
    if (visible >= width - 1) return res + '…\x1b[0m';
    res += s[i++]; visible++;
  }
  return res;
}

// ---------- prompts ----------

let rl: readline.Interface | null = null;
const io = () => (rl ??= readline.createInterface({ input: stdin, output: stdout }));
export const closeUi = () => { rl?.close(); rl = null; };

export async function ask(q: string, fallback = ''): Promise<string> {
  const hint = fallback ? c.dim(` (${fallback})`) : '';
  const a = (await io().question(`${c.cyan('?')} ${c.bold(q)}${hint} `)).trim();
  if (logPath) fs.appendFileSync(logPath, `${stamp()}  ? ${q} -> ${a || fallback}\n`);
  return a || fallback;
}

/** Numbered menu; returns the chosen index. */
export async function choose(q: string, options: string[], def = 0): Promise<number> {
  out(`${c.cyan('?')} ${c.bold(q)}`);
  options.forEach((o, i) => out(`  ${c.yellow(String(i + 1).padStart(2))}. ${o}`));
  for (;;) {
    const a = await ask('Pick a number', String(def + 1));
    const n = Number(a) - 1;
    if (Number.isInteger(n) && n >= 0 && n < options.length) return n;
    out(c.red('  Not one of the numbers above.'));
  }
}

// ---------- lines ----------

export const heading = (s: string) => out(`\n${c.magenta('━━')} ${c.bold(s)} ${c.magenta('━'.repeat(Math.max(4, 60 - s.length)))}`);
export const info = (s: string) => out(`  ${s}`);
export const ok = (s: string) => out(`${clock()} ${c.green('✔')} ${s}`);
export const warn = (s: string) => out(`${clock()} ${c.yellow('!')} ${s}`);
export const detail = (s: string) => out(`            ${c.dim('│')} ${c.dim(s)}`);

/** Header for one step of the production run, e.g. "[2/5] Voice". Returns a function that records the step's time. */
export function step(n: number, total: number, name: string) {
  const t0 = Date.now();
  out(`\n${clock()} ${c.magenta(`[${n}/${total}]`)} ${c.bold(name)}`);
  return () => stats.steps.push({ name, ms: Date.now() - t0 });
}

/** A text progress bar: ████████░░░░ */
export const bar = (frac: number, width = 24) => {
  const f = Math.max(0, Math.min(1, frac));
  const full = Math.floor(f * width);
  const part = ' ▏▎▍▌▋▊▉'[Math.floor((f * width - full) * 8)] ?? '';
  return c.cyan('█'.repeat(full) + (full < width ? part : '')) + c.dim('░'.repeat(Math.max(0, width - full - (full < width ? 1 : 0))));
};

/** A one-line live status with elapsed time. Falls back to occasional plain lines when output is not a terminal. */
export function spinner(label: string) {
  const t0 = Date.now();
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const tty = stdout.isTTY;
  let text = label;
  let lastPlain = 0;
  const secs = () => dur(Date.now() - t0);
  const timer = tty
    ? setInterval(() => {
      const line = `${clock()} ${c.cyan(frames[i++ % frames.length])} ${c.dim(secs().padStart(6))} ${text}`;
      stdout.write(`\r${fitLine(line, (stdout.columns || 120) - 1)}\x1b[K`);
    }, 100)
    : null;
  if (!tty) console.log(`${clock()} … ${label}`);
  const stop = (mark: string, extra?: string) => {
    if (timer) clearInterval(timer);
    if (tty) stdout.write(`\r\x1b[K`);
    out(`${clock()} ${mark} ${text} ${c.dim(secs())}${extra ? `  ${c.dim('·')} ${c.dim(extra)}` : ''}`);
  };
  return {
    /** Change the live text. Without a terminal, progress is printed at most every 10s. */
    update: (s: string) => {
      text = s;
      if (!tty && Date.now() - lastPlain > 10_000) { lastPlain = Date.now(); console.log(`${clock()} … ${stripAnsi(s)}`); }
    },
    done: (s?: string, extra?: string) => { if (s) text = s; stop(c.green('✔'), extra); },
    fail: (s?: string, extra?: string) => { if (s) text = s; stop(c.red('✖'), extra); },
    elapsed: () => Date.now() - t0,
  };
}

/** Run tasks with a concurrency limit, keeping order. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      res[i] = await fn(items[i], i);
    }
  }));
  return res;
}

/** The end-of-run summary: time per step and AI usage. */
export function summary() {
  if (!stats.steps.length && !stats.llmCalls) return;
  heading('Run summary');
  for (const s of stats.steps) out(`  ${s.name.padEnd(28, '.')} ${dur(s.ms).padStart(8)}`);
  out(`  ${'Total'.padEnd(28, '.')} ${c.bold(dur(Date.now() - started).padStart(8))}`);
  out(`  ${c.dim(`AI: ${stats.llmCalls} text calls, ${num(stats.tokensIn)} in / ${num(stats.tokensOut)} out tokens (+${num(stats.tokensThinking)} thinking), ${stats.searches} web searches, ${stats.ttsClips} voice clips, ${stats.images} pictures`)}`);
  out(`\n  ${c.bold('Cost by model')}`);
  for (const [m, v] of Object.entries(stats.byModel)) {
    const cost = v.cost === null ? c.dim('no price'.padStart(9)) : usdFmt(v.cost).padStart(9);
    out(`    ${m.padEnd(26)} ${String(v.calls).padStart(3)} calls ${num(v.input).padStart(10)} in ${num(v.output).padStart(10)} out  ${cost}`);
  }
  out(`    ${'Total'.padEnd(26)} ${c.bold(usdFmt(stats.cost))}${stats.unpriced.size ? c.dim(`   not counted: ${[...stats.unpriced].join(', ')} (add their prices to prices.json)`) : ''}`);
}
