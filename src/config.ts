import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const JOBS_DIR = path.join(ROOT, 'jobs');
export const MUSIC_DIR = path.join(ROOT, 'assets', 'music');
/** Default folder for your own images (used when it has any). */
export const IMAGES_DIR = path.join(ROOT, 'assets', 'images');

const str = (k: string, d: string) => process.env[k]?.trim() || d;
const num = (k: string, d: number) => (process.env[k] && !isNaN(Number(process.env[k])) ? Number(process.env[k]) : d);

export const config = {
  writerModel: str('WRITER_MODEL', 'gemini-4-argon'),
  /** Models offered in the CLI for research and writing. */
  writerModels: str('WRITER_MODELS', 'gemini-4-argon,gemini-3.8-flash,gemini-3.7-flash').split(',').map((m) => m.trim()).filter(Boolean),
  /** Fixes broken JSON answers from the writer. */
  repairModel: str('REPAIR_MODEL', 'gemini-3.8-flash'),
  /** Looks at your own images (descriptions, palette). */
  visionModel: str('VISION_MODEL', 'gemini-3.8-flash'),
  imageModel: str('IMAGE_MODEL', 'gemini-3.1-flash-image'),
  tts: {
    provider: str('TTS_PROVIDER', 'gemini') as 'gemini' | 'elevenlabs',
    geminiModel: str('GEMINI_TTS_MODEL', 'gemini-3.8-flash-tts'),
    elevenKey: str('ELEVENLABS_API_KEY', ''),
    elevenModel: str('ELEVENLABS_MODEL', 'eleven_v4'),
    elevenVoice: str('ELEVENLABS_VOICE', ''),
    concurrency: num('TTS_CONCURRENCY', 4),
  },
  /** Most AI pictures in one video (each costs an image call). */
  maxImages: num('MAX_IMAGES', 6),
  fps: num('FPS', 30),
  /** Music volume under the voice, 0..1 (only when a track is in assets/music). */
  musicVolume: num('MUSIC_VOLUME', 0.08),
};
