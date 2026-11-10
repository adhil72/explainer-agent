import { z } from 'zod';

/** What the user asked for. */
export interface Brief {
  topic: string;
  formatId: string;
  seconds: number;
  language: string;
  audience: string;
  tone: string;
  theme: string;
  voice: string;
  images: boolean;
  /** illustrated: every scene explained on one AI picture; mixed: motion graphics + a few pictures; graphics: no AI pictures. */
  visual?: 'illustrated' | 'mixed' | 'graphics';
  /** Research + writing model. */
  model?: string;
  /** Folder with the creator's own images (used in the video, as style references, and optionally for the palette). */
  assetsDir?: string;
}

/** The creator's own images, looked at by the vision model. */
export const AssetsSchema = z.object({
  images: z.array(z.object({
    index: z.number().describe('Index of the image as given (0-based)'),
    description: z.string().describe('What the image shows, concrete, one sentence'),
    usable: z.boolean().describe('True if it can be shown full-screen in an explainer video (a photo, illustration, product, scene). False for logos, screenshots full of small text, or tiny/blurry images.'),
  })),
  style: z.string().describe('The shared visual style of the images (medium, lighting, color mood, texture), one or two sentences, usable as an art direction for new illustrations'),
  palette: z.object({
    dark: z.boolean().describe('True if a dark background suits these images'),
    bg1: z.string().describe('Background color, hex'),
    bg2: z.string().describe('Second background color for a gradient, hex'),
    accent: z.string().describe('Main accent color, vivid, hex'),
    accent2: z.string().describe('Second accent, contrasting, hex'),
  }),
});
export type Assets = z.infer<typeof AssetsSchema> & { files: string[] };

export const OptionsSchema = z.object({
  options: z.array(z.object({
    title: z.string().describe('Working title, curiosity-driven, under 60 characters'),
    angle: z.string().describe('The single idea / story this version is built around, one sentence'),
    hook: z.string().describe('The exact first spoken line (first 3 seconds). Must create a curiosity gap or bold claim.'),
    outline: z.array(z.string()).describe('Beats of the story in order, one short line each'),
    payoff: z.string().describe('The satisfying reveal / takeaway the viewer waits for'),
    whyItRetains: z.string().describe('Why viewers will keep watching, in one sentence'),
  })).min(3).max(4),
});
export type Options = z.infer<typeof OptionsSchema>;
export type VideoOption = Options['options'][number];

export const BEAT_KINDS = [
  'point', 'zoom', 'wide',
  'hook', 'title', 'stat', 'list', 'compare', 'bars', 'timeline', 'steps', 'icons', 'quote', 'image', 'question', 'callout',
] as const;

const Item = z.object({
  label: z.string().describe('Short, 1-5 words'),
  value: z.string().optional().describe('bars: the number as SHORT text, e.g. "380", "2.5", "86". At most 6 characters; put units like M, B, % in the beat suffix, never write long digit strings'),
  detail: z.string().optional().describe('Optional short detail, under 8 words'),
  icon: z.string().optional().describe('Icon name from the allowed list'),
});

const Side = z.object({
  title: z.string(),
  icon: z.string().optional(),
  points: z.array(z.string()).describe('1-3 very short points'),
});

export const BeatSchema = z.object({
  cue: z.string().describe('2-5 consecutive words copied EXACTLY from this scene narration; the visual appears when these words are spoken'),
  kind: z.enum(BEAT_KINDS),
  heading: z.string().optional().describe('Main on-screen text. 2-7 words. Never a full sentence of narration.'),
  highlight: z.string().optional().describe('One word from heading to color with the accent'),
  sub: z.string().optional().describe('Small supporting line, under 8 words'),
  value: z.string().optional().describe('stat: the number to count up to, as SHORT text, e.g. "380", "2.5", "13". At most 6 characters; 200 billion is "200" with suffix "B". Never write long digit strings'),
  prefix: z.string().optional().describe('stat: e.g. "$"'),
  suffix: z.string().optional().describe('stat: e.g. "%", "x", " km", "B"'),
  items: z.array(Item).optional().describe('list/bars/timeline/steps/icons: 2-5 items'),
  left: Side.optional().describe('compare: left side'),
  right: Side.optional().describe('compare: right side'),
  icon: z.string().optional().describe('Icon for hook/title/callout/question/stat'),
  focus: z.string().optional().describe("point/zoom: the name of one of this scene's plate parts (copied exactly); the camera moves to it and the label points at it"),
  imagePrompt: z.string().optional().describe('image: what to draw, concrete subject and composition, no text in the picture'),
  asset: z.string().optional().describe("image: file name of one of the creator's own images (from the YOUR IMAGES list) to show instead of drawing one"),
});
export type Beat = z.infer<typeof BeatSchema>;

export const SceneSchema = z.object({
  chapter: z.string().describe('Short chapter name, 1-4 words'),
  plate: z.object({
    prompt: z.string().describe('The ONE illustration this scene is explained on: what it shows, the viewpoint and the composition. Concrete and visual (a cutaway, a diagram-like scene, a cross-section, a map-like overview, a scene with people). No text in it.'),
    parts: z.array(z.string()).describe('2-5 distinct, clearly visible things in the illustration that the narration points at, short names (e.g. "vocal folds", "purring pad", "brain"). Each must be a separate, recognizable object or region.'),
    asset: z.string().optional().describe("Use one of the creator's own images (file name from YOUR IMAGES) instead of drawing one"),
  }).optional(),
  narration: z.string().describe('What the voice says in this scene. Spoken English (or the target language), short sentences.'),
  beats: z.array(BeatSchema).min(1).describe('Visuals in order; a new beat every 2-4 seconds of narration'),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  title: z.string(),
  thumbnailText: z.string().describe('2-4 punchy words for the thumbnail / cover'),
  thumbnailPrompt: z.string().describe('Picture for the thumbnail background: one striking subject, high contrast, no text'),
  artDirection: z.string().optional().describe('One art direction for EVERY illustration in the video, so they look like one set: medium (e.g. clean 3D render, flat vector, painterly editorial), palette, lighting, level of detail, camera style, and how recurring subjects look'),
  scenes: z.array(SceneSchema).min(2),
});
export type Script = z.infer<typeof ScriptSchema>;

export const PublishSchema = z.object({
  titles: z.array(z.string()).min(3).max(5).describe('Title options, best first'),
  description: z.string().describe('Platform description / caption body WITHOUT hashtags and WITHOUT chapter list'),
  tags: z.array(z.string()).describe('YouTube tags (plain words), 10-20'),
  hashtags: z.array(z.string()).describe('Hashtags including the # sign, 3-5 for YouTube, 8-15 for Instagram/TikTok'),
  pinnedComment: z.string().describe('A comment to pin that sparks replies'),
  coverText: z.string().describe('Text for the cover / thumbnail, 2-4 words'),
});
export type Publish = z.infer<typeof PublishSchema>;

/** How the video file is made, asked before production. */
export interface RenderOpts {
  /** Output size relative to the format's base frame (1 = 1080p class). */
  scale: number;
  fps: number;
  quality: 'best' | 'high' | 'balanced' | 'small';
  captions: boolean;
  sfx: boolean;
  /** 'none', 'random', or a file name in assets/music. */
  music: string;
  musicVolume: number;
  /** Chrome's drawing backend: 'swangle' draws on the CPU; 'angle', 'egl', 'vulkan' use the GPU. */
  gl: string;
}

/** Everything saved for a job, so it can be resumed at any stage. */
export interface JobState {
  id: string;
  dir: string;
  stage: 'brief' | 'research' | 'options' | 'script' | 'voice' | 'images' | 'render' | 'done';
  brief: Brief;
  research?: { notes: string; sources: { title: string; url: string }[] };
  assets?: Assets;
  options?: VideoOption[];
  chosen?: VideoOption;
  script?: Script;
  renderOpts?: RenderOpts;
  /** Path of the final video, once rendered. */
  output?: string;
}
