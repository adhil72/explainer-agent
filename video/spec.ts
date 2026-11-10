/** The data the video is rendered from. Built by src/steps/render.ts, read by the Remotion composition. Times are in seconds. */

export interface Word { w: string; s: number; e: number; scene?: number }

export interface Timing {
  duration: number;
  words: Word[];
  scenes: { start: number; end: number }[];
}

export type BeatKind =
  | 'point' | 'zoom' | 'wide'
  | 'hook' | 'title' | 'stat' | 'list' | 'compare' | 'bars' | 'timeline' | 'steps' | 'icons' | 'quote' | 'image' | 'question' | 'callout';

export interface BeatItem { label: string; value?: number; detail?: string; icon?: string }
export interface Side { title: string; icon?: string; points: string[] }

export interface SpecBeat {
  kind: BeatKind;
  start: number;
  end: number;
  heading?: string;
  highlight?: string;
  sub?: string;
  value?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  items?: BeatItem[];
  left?: Side;
  right?: Side;
  icon?: string;
  /** File in the public folder (img/...), for image beats. */
  image?: string;
  /** point / zoom: the plate part the camera moves to and the arrow points at. */
  focus?: string;
  /** Item reveal times (seconds), for lists etc., so items land on the words that name them. */
  itemTimes?: number[];
}

export interface SpecScene { chapter: string; start: number; end: number; beats: SpecBeat[] }

export type ThemeName = 'midnight' | 'paper' | 'neon' | 'sunset' | 'custom';

/** Colors picked from the creator's images (theme 'custom'). */
export interface Palette { dark: boolean; bg1: string; bg2: string; accent: string; accent2: string }

export interface VideoSpec {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  vertical: boolean;
  /** Fractions of the frame to keep clear of text. */
  safe: { top: number; bottom: number; left: number; right: number };
  theme: ThemeName;
  palette?: Palette;
  title: string;
  showChapters: boolean;
  scenes: SpecScene[];
  words: Word[];
  voice: string;
  music?: string;
  musicVolume: number;
  sfx: boolean;
  /** Word-by-word captions (default on). */
  captions?: boolean;
  /** Placed sound effects (earshot kit). When absent, the built-in whoosh / pop / hit are used. */
  sfxCues?: SfxCue[];
  /** Scene pictures and where their parts are (illustrated style). Index = scene. */
  plates?: (SpecPlate | null)[];
}

export interface SfxCue { file: string; start: number; volume: number; role: string; dur: number }

/** A scene's picture: file in public/, its aspect (w/h), and named parts as [x, y, w, h] fractions of the picture. */
export interface SpecPlate { file: string; aspect: number; parts: Record<string, [number, number, number, number]> }

export interface ThumbSpec {
  width: number;
  height: number;
  theme: ThemeName;
  palette?: Palette;
  text: string;
  highlight?: string;
  image?: string;
  icon?: string;
}
