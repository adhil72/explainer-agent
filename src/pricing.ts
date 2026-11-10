import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

/** USD per 1M tokens. Defaults are the prices set in edbard's AI Models page; prices.json in the project root overrides or adds. */
export interface Price { input: number; output: number }

const DEFAULTS: Record<string, Price> = {
  'gemini-4-argon': { input: 2, output: 10 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.8, output: 4 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 0.25 },
};

let table: Record<string, Price> | null = null;
function prices() {
  if (table) return table;
  table = { ...DEFAULTS };
  const file = path.join(ROOT, 'prices.json');
  if (fs.existsSync(file)) {
    try {
      for (const [m, p] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Partial<Price> | null>)) {
        if (p && typeof p.input === 'number' && typeof p.output === 'number') table[m.toLowerCase()] = { input: p.input, output: p.output };
      }
    } catch (e) {
      console.warn(`prices.json is not valid JSON: ${(e as Error).message}`);
    }
  }
  return table;
}

export const priceOf = (model: string): Price | null => prices()[model.toLowerCase()] ?? null;

/** Cost in USD. Thinking tokens are billed as output. Null when the model has no price. */
export function costOf(model: string, input: number, output: number): number | null {
  const p = priceOf(model);
  return p ? (input * p.input + output * p.output) / 1_000_000 : null;
}

export const usd = (v: number) => (v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
