import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import type { SfxCue, VideoSpec } from '../video/spec.js';

/**
 * Sound effects from earshot's bank (https://github.com/Leonxlnx/earshot): a kit rendered once with the `launch` preset into
 * assets/sfx/kit. Its lock file gives every take's measured onset and peak, and every role's rule for where it sits against a cut
 * (a whoosh peaks 37 ms after it, a pop lands 30 ms after, a tap leads by 60 ms) and how close a run may go. Each moment in the video
 * picks a role, a take (rotating so nothing repeats back to back) and a level under the voice.
 */

export const KIT_DIR = path.join(ROOT, 'assets', 'sfx', 'kit');
const LOCK = path.join(KIT_DIR, 'kit.lock.json');

interface Take { file: string; onset_s: number; peak_s: number; end_s: number; l50_lufs?: number; lufs_m_max?: number }
interface Role { align?: 'onset' | 'peak'; offset_ms?: number; min_gap_ms?: number; takes: Take[] }
interface Lock { roles: Record<string, Role> }

export const hasKit = () => fs.existsSync(LOCK);
const lock = (): Lock | null => (hasKit() ? JSON.parse(fs.readFileSync(LOCK, 'utf8')) : null);

/** Loudness each role should have in the mix (LUFS of the take's loud part), set against a voice mastered near -16 LUFS. */
const TARGET_LUFS: Record<string, number> = {
  hit: -21, land: -24, 'land.light': -27, 'whoosh.short': -27, 'whoosh.long': -26, swell: -27, riser: -28,
  pop: -27, tick: -30, 'tick.crisp': -30, tock: -29, click: -29, 'click.confirm': -28, snap: -27, bell: -29, drop: -27, text: -30,
};

/** What each moment of the video sounds like. */
type Moment = { t: number; role: string };

function moments(spec: VideoSpec): Moment[] {
  const m: Moment[] = [];
  spec.scenes.forEach((sc, si) => {
    if (si > 0) m.push({ t: sc.start, role: 'whoosh.long' });
    sc.beats.forEach((b, bi) => {
      const first = si === 0 && bi === 0;
      const next = sc.beats[bi + 1]?.start ?? sc.end;
      if (first) m.push({ t: b.start, role: 'hit' });
      else if (bi > 0) {
        switch (b.kind) {
          case 'zoom': m.push({ t: b.start, role: 'whoosh.short' }); break;
          case 'point': m.push({ t: b.start + 0.25, role: 'pop' }); break;
          case 'wide': m.push({ t: b.start, role: 'swell' }); break;
          case 'stat': m.push({ t: b.start, role: 'whoosh.short' }, { t: b.start + 1.1, role: 'land' }); break;
          case 'callout': case 'hook': m.push({ t: b.start, role: 'hit' }); break;
          case 'quote': m.push({ t: b.start, role: 'swell' }); break;
          default: m.push({ t: b.start, role: 'whoosh.short' });
        }
      }
      // A question builds into the answer: a riser that peaks on the next beat.
      if (b.kind === 'question' && next - b.start > 1) m.push({ t: next, role: 'riser' });
      const itemRole = b.kind === 'timeline' ? 'tick' : b.kind === 'steps' ? 'click' : b.kind === 'bars' ? 'tock' : 'pop';
      for (const t of b.itemTimes ?? []) m.push({ t, role: itemRole });
    });
  });
  return m.sort((a, b) => a.t - b.t);
}

/**
 * Turn the video's moments into placed sound files. Copies the takes used into public/sfx/ and returns the cues (file, start,
 * volume). Null when the kit has not been rendered (the built-in sounds are used instead).
 */
export function placeSfx(spec: VideoSpec, publicDir: string): SfxCue[] | null {
  const kit = lock();
  if (!kit) return null;
  const used = new Map<string, number>();
  const lastAt = new Map<string, number>();
  const cues: SfxCue[] = [];
  for (const mo of moments(spec)) {
    const role = kit.roles[mo.role];
    if (!role?.takes?.length) continue;
    const gap = (role.min_gap_ms ?? 80) / 1000;
    if (mo.t - (lastAt.get(mo.role) ?? -9) < gap) continue;
    lastAt.set(mo.role, mo.t);
    const n = used.get(mo.role) ?? 0;
    used.set(mo.role, n + 1);
    const take = role.takes[n % role.takes.length];
    // File start so the take's onset (or peak) lands on the cut plus the role's offset.
    const anchor = role.align === 'peak' ? take.peak_s : take.onset_s;
    const start = mo.t + (role.offset_ms ?? 0) / 1000 - anchor;
    if (start < 0 && mo.t > 0.05) continue;
    const loud = take.l50_lufs ?? take.lufs_m_max ?? -20;
    const gainDb = Math.max(-30, Math.min(6, (TARGET_LUFS[mo.role] ?? -28) - loud));
    const dest = path.join(publicDir, 'sfx', 'kit', take.file);
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(KIT_DIR, take.file), dest);
    }
    cues.push({ file: `sfx/kit/${take.file}`, start: Math.max(0, start), volume: +Math.pow(10, gainDb / 20).toFixed(3), role: mo.role, dur: take.end_s });
  }
  return cues;
}
