import { usd } from '../pricing.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { genai, record, withRetry } from '../llm.js';
import { RATE, normalize, pcmToWav, seconds, silence, trimSilence, wavToPcm } from '../audio.js';
import type { JobState } from '../schema.js';
import { detail, dur, pool, spinner, stats, warn } from '../ui.js';
import type { Timing, Word } from '../../video/spec.js';

/** Gemini voices that suit explainers. */
export const GEMINI_VOICES = [
  { id: 'Puck', note: 'upbeat, lively (male)' },
  { id: 'Fenrir', note: 'excited, energetic (male)' },
  { id: 'Zephyr', note: 'bright, clear (female)' },
  { id: 'Aoede', note: 'easy, warm (female)' },
  { id: 'Kore', note: 'firm, confident (female)' },
  { id: 'Charon', note: 'informative, documentary (male)' },
  { id: 'Enceladus', note: 'calm, breathy (male)' },
];

/**
 * Gemini TTS takes no system prompt and reads any instruction text aloud, so the only direction is one short bracket tag. A clip much
 * longer than its text can take means the tag was spoken; then the plain text is spoken instead.
 */
const STYLE_TAG = '[engaging storyteller, lively pace]';
const leaked = (pcm: Buffer, text: string) => seconds(pcm) > text.length / 6 + 2.5;

async function geminiSay(text: string, voice: string): Promise<Buffer> {
  const speak = async (prompt: string) => {
    const res = await withRetry('voice', () => genai().models.generateContent({
      model: config.tts.geminiModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }));
    record(config.tts.geminiModel, res.usageMetadata, 'tts');
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error('Gemini returned no audio');
    const { pcm, rate } = wavToPcm(Buffer.from(part.inlineData.data, 'base64'));
    if (rate !== RATE) throw new Error(`Gemini returned ${rate} Hz audio, expected ${RATE}`);
    return pcm;
  };
  const pcm = await speak(`${STYLE_TAG} ${text}`);
  return leaked(pcm, text) ? speak(text) : pcm;
}

/** Spread words over a clip in proportion to their length, with extra weight for the pause after punctuation. */
function estimate(text: string, start: number, dur: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length + 2.5 + (/[.!?]$/.test(t) ? 4 : /[,;:—-]$/.test(t) ? 2.5 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = start;
  return tokens.map((w, i) => {
    const len = (weights[i] / total) * dur;
    const word = { w, s: +at.toFixed(3), e: +(at + len * 0.9).toFixed(3) };
    at += len;
    return word;
  });
}

async function elevenSay(text: string, voice: string): Promise<{ pcm: Buffer; words: Word[] }> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?output_format=pcm_${RATE}`, {
    method: 'POST',
    headers: { 'xi-api-key': config.tts.elevenKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: config.tts.elevenModel, apply_text_normalization: 'auto' }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { audio_base64: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
  const words: Word[] = [];
  const a = data.alignment;
  if (a) {
    let cur: Word | null = null;
    a.characters.forEach((ch, i) => {
      if (/\s/.test(ch)) { if (cur) words.push(cur); cur = null; return; }
      if (!cur) cur = { w: '', s: a.character_start_times_seconds[i], e: 0 };
      cur.w += ch;
      cur.e = a.character_end_times_seconds[i];
    });
    if (cur) words.push(cur);
  }
  return { pcm: Buffer.from(data.audio_base64, 'base64'), words };
}

const sentences = (text: string) => text.split(/(?<=[.!?…])\s+(?=\S)/).map((s) => s.trim()).filter(Boolean);

const GAP_SENTENCE = 0.16;
const GAP_SCENE = 0.32;
const LEAD_IN = 0.12;

/** Speak the whole script into public/voice.wav and write the word timings to timing.json. */
export async function voice(job: JobState): Promise<Timing> {
  const script = job.script!;
  const useEleven = job.brief.voice.startsWith('eleven:');
  const voiceId = useEleven ? job.brief.voice.slice(7) : job.brief.voice;
  if (useEleven && !config.tts.elevenKey) throw new Error('ELEVENLABS_API_KEY is not set');

  // ElevenLabs speaks a whole scene (it reports exact word times); Gemini speaks one sentence at a time so estimated times stay tight.
  const clips = script.scenes.flatMap((sc, si) => (useEleven ? [sc.narration] : sentences(sc.narration)).map((text) => ({ si, text })));
  const engine = useEleven ? `ElevenLabs ${config.tts.elevenModel}` : `${config.tts.geminiModel} · ${voiceId}`;
  const spin = spinner(`Recording the voice (${clips.length} clips, ${engine})`);
  let doneCount = 0;
  let audioSec = 0;
  const spoken = await pool(clips, config.tts.concurrency, async (clip) => {
    let out: { pcm: Buffer; words?: Word[] };
    if (useEleven) {
      const r = await elevenSay(clip.text, voiceId);
      out = { pcm: r.pcm, words: r.words };
    } else {
      out = { pcm: trimSilence(await geminiSay(clip.text, voiceId)) };
    }
    audioSec += seconds(out.pcm);
    stats.ttsClips++;
    const n = ++doneCount;
    spin.update(`Recording the voice ${n}/${clips.length} clips · ${audioSec.toFixed(1)}s of audio · ${(audioSec / (spin.elapsed() / 1000)).toFixed(1)}x realtime · run ${usd(stats.cost)}`);
    return out;
  }).catch((e) => { spin.fail(); throw e; });
  spin.done(`Voice recorded`, `${clips.length} clips, ${engine}`);

  const parts: Buffer[] = [silence(LEAD_IN)];
  let t = LEAD_IN;
  const words: Word[] = [];
  const scenes: Timing['scenes'] = script.scenes.map(() => ({ start: 0, end: 0 }));
  clips.forEach((clip, i) => {
    const { pcm } = spoken[i];
    const dur = seconds(pcm);
    const firstOfScene = i === 0 || clips[i - 1].si !== clip.si;
    if (firstOfScene) scenes[clip.si].start = i === 0 ? 0 : +(t - GAP_SCENE / 2).toFixed(3);
    const ws = spoken[i].words?.length ? spoken[i].words!.map((w) => ({ ...w, s: w.s + t, e: w.e + t })) : estimate(clip.text, t, dur);
    words.push(...ws.map((w) => ({ ...w, scene: clip.si })));
    parts.push(pcm);
    t += dur;
    const last = i === clips.length - 1;
    const gap = last ? 0.6 : clips[i + 1].si !== clip.si ? GAP_SCENE : GAP_SENTENCE;
    parts.push(silence(gap));
    t += gap;
  });
  scenes.forEach((s, i) => { s.end = i < scenes.length - 1 ? scenes[i + 1].start : +t.toFixed(3); });

  const pcm = normalize(Buffer.concat(parts));
  const pub = path.join(job.dir, 'public');
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(path.join(pub, 'voice.wav'), pcmToWav(pcm));
  const timing: Timing = { duration: +t.toFixed(3), words, scenes };
  fs.writeFileSync(path.join(job.dir, 'timing.json'), JSON.stringify(timing, null, 1));
  detail(`voice.wav ${dur(t * 1000)} · ${words.length} words · ${(words.length / t * 60).toFixed(0)} words/min · ${scenes.length} scenes`);
  if (t > job.brief.seconds * 1.35) warn(`Voice runs ${Math.round(t)}s, longer than the ${job.brief.seconds}s target.`);
  return timing;
}
