/** Small helpers for 16-bit mono PCM: WAV read/write, silence trimming and generated sound effects. */

export const RATE = 24000;

export function wavToPcm(buf: Buffer): { pcm: Buffer; rate: number } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return { pcm: buf, rate: RATE };
  let at = 12;
  let rate = RATE, channels = 1, bits = 16;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') { channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); bits = buf.readUInt16LE(at + 22); }
    if (id === 'data') {
      if (channels !== 1 || bits !== 16) throw new Error(`expected mono 16-bit audio, got ${channels}ch ${bits}-bit`);
      return { pcm: buf.subarray(at + 8, Math.min(buf.length, at + 8 + size)), rate };
    }
    at += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data chunk');
}

export function pcmToWav(pcm: Buffer, rate = RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export const seconds = (pcm: Buffer, rate = RATE) => pcm.length / 2 / rate;
export const silence = (sec: number, rate = RATE) => Buffer.alloc(Math.round(sec * rate) * 2);

/** Cut the silence before and after speech, keeping a short margin so words are not clipped. */
export function trimSilence(pcm: Buffer, rate = RATE, margin = 0.04): Buffer {
  const win = Math.round(rate * 0.01);
  const n = pcm.length / 2;
  const loud = (i: number) => {
    let peak = 0;
    for (let j = i; j < Math.min(n, i + win); j++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(j * 2)));
    return peak > 700;
  };
  let start = 0, end = n;
  while (start < n && !loud(start)) start += win;
  while (end > start && !loud(Math.max(0, end - win))) end -= win;
  if (end <= start) return pcm;
  const m = Math.round(rate * margin);
  return pcm.subarray(Math.max(0, start - m) * 2, Math.min(n, end + m) * 2);
}

/** Make the voice evenly loud: scale so the peak sits at about -1 dBFS. */
export function normalize(pcm: Buffer): Buffer {
  let peak = 1;
  for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
  const gain = Math.min(4, 29000 / peak);
  const out = Buffer.alloc(pcm.length);
  for (let i = 0; i < pcm.length; i += 2) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * gain))), i);
  return out;
}

const s16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** A soft "whoosh": noise through a sweeping low-pass with a swell, for scene and beat changes. */
export function whoosh(rate = 44100, dur = 0.45): Buffer {
  const n = Math.round(rate * dur);
  const out = Buffer.alloc(n * 2);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * Math.pow(t, 0.7)) ** 2;
    const cutoff = 0.02 + 0.25 * Math.sin(Math.PI * t);
    lp += cutoff * ((Math.random() * 2 - 1) - lp);
    out.writeInt16LE(s16(lp * env * 22000), i * 2);
  }
  return out;
}

/** A short "pop" (pitched blip), for items appearing. */
export function pop(rate = 44100, dur = 0.09): Buffer {
  const n = Math.round(rate * dur);
  const out = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 900 - 500 * t;
    phase += (2 * Math.PI * f) / rate;
    out.writeInt16LE(s16(Math.sin(phase) * Math.exp(-t * 6) * 14000), i * 2);
  }
  return out;
}

/** A low "hit" with a bit of sub, for the hook and big reveals. */
export function hit(rate = 44100, dur = 0.6): Buffer {
  const n = Math.round(rate * dur);
  const out = Buffer.alloc(n * 2);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = 110 * Math.exp(-t * 3) + 40;
    phase += (2 * Math.PI * f) / rate;
    const noise = (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.5;
    out.writeInt16LE(s16((Math.sin(phase) + noise) * Math.exp(-t * 5) * 24000), i * 2);
  }
  return out;
}
