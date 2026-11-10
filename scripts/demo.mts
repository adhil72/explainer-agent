import fs from 'node:fs';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition, ensureBrowser } from '@remotion/renderer';
import { buildSpec } from '../src/steps/render.ts';
import { pcmToWav, silence, whoosh, pop, hit } from '../src/audio.ts';
import type { JobState, Script } from '../src/schema.ts';

const formatId = process.argv[2] ?? 'shorts';
const theme = process.argv[3] ?? 'midnight';
const dir = path.resolve(import.meta.dirname, `../jobs/_demo-${formatId}-${theme}`);
fs.mkdirSync(path.join(dir, 'public/sfx'), { recursive: true });
const script: Script = {
  title: 'Why octopuses are aliens', thumbnailText: 'Octopus Brains', thumbnailPrompt: 'x',
  scenes: [
    { chapter: 'The hook', narration: 'An octopus has nine brains, and it can taste with its arms. That is not even the strangest part.', beats: [
      { cue: 'An octopus has', kind: 'hook', heading: 'Nine brains. One octopus.', highlight: 'Nine', icon: 'brain' },
      { cue: 'not even the strangest', kind: 'question', heading: 'So what is stranger?' },
    ]},
    { chapter: 'The numbers', narration: 'Two thirds of its neurons live in its arms. That is 350 million neurons. Each arm can act on its own.', beats: [
      { cue: 'Two thirds of', kind: 'stat', value: 350, suffix: 'M', heading: 'neurons in the arms', icon: 'activity' },
      { cue: 'Each arm can', kind: 'compare', heading: 'Brain vs arms', left: { title: 'Central brain', icon: 'brain', points: ['Plans', 'Learns'] }, right: { title: 'Arms', icon: 'hand', points: ['Taste', 'Decide'] } },
    ]},
    { chapter: 'How it works', narration: 'First the arm touches. Then it tastes. Then it decides, all without asking the brain. Here are the record holders: octopus, human, crow.', beats: [
      { cue: 'First the arm', kind: 'steps', items: [{ label: 'Touch', icon: 'hand' }, { label: 'Taste', icon: 'droplet' }, { label: 'Decide', icon: 'zap' }] },
      { cue: 'Here are the', kind: 'bars', heading: 'Neurons (millions)', items: [{ label: 'Octopus', value: 500 }, { label: 'Crow', value: 1500 }, { label: 'Human', value: 86000 }] },
    ]},
    { chapter: 'History', narration: 'In 1960 we thought they were simple. By 2015 we decoded their genome. Today we know: smart, strange, alien. Remember this.', beats: [
      { cue: 'In 1960 we', kind: 'timeline', items: [{ label: '1960', detail: 'Thought simple' }, { label: '2015', detail: 'Genome decoded' }, { label: 'Today', detail: 'Alien-level smart' }] },
      { cue: 'Today we know', kind: 'list', heading: 'What we know', items: [{ label: 'Smart', icon: 'lightbulb' }, { label: 'Strange', icon: 'sparkles' }, { label: 'Alien', icon: 'orbit' }] },
      { cue: 'Remember this', kind: 'callout', heading: 'Think with your arms', icon: 'zap' },
    ]},
  ],
};
const job = { id: 'test', dir, stage: 'render', brief: { topic: 't', formatId, seconds: 40, language: 'English', audience: '', tone: '', theme, voice: 'Puck', images: false }, script } as JobState;
// Fake timing: 2.7 words per second.
let t = 0.12; const words: any[] = []; const scenes: any[] = [];
script.scenes.forEach((sc, si) => { scenes.push({ start: si ? t - 0.15 : 0, end: 0 }); for (const w of sc.narration.split(/\s+/)) { words.push({ w, s: t, e: t + 0.3, scene: si }); t += 0.37; } t += 0.3; });
scenes.forEach((s, i) => (s.end = scenes[i + 1]?.start ?? t));
fs.writeFileSync(path.join(dir, 'timing.json'), JSON.stringify({ duration: t, words, scenes }));
fs.writeFileSync(path.join(dir, 'public/voice.wav'), pcmToWav(silence(t)));
for (const [n, p] of [['whoosh', whoosh()], ['pop', pop()], ['hit', hit()]] as const) fs.writeFileSync(path.join(dir, `public/sfx/${n}.wav`), pcmToWav(p, 44100));
const spec = buildSpec(job, { duration: t, words, scenes });
await ensureBrowser();
const serveUrl = await bundle({ entryPoint: path.resolve(import.meta.dirname, '../video/index.ts'), publicDir: path.join(dir, 'public') });
const inputProps = { spec };
const comp = await selectComposition({ serveUrl, id: 'Explainer', inputProps });
const shots = spec.scenes.flatMap((s) => s.beats.map((b) => b.start + Math.min(1.6, (b.end - b.start) * 0.8)));
for (const [i, sec] of shots.entries()) {
  await renderStill({ serveUrl, composition: comp, inputProps, output: path.join(dir, `f${String(i).padStart(2, '0')}.png`), frame: Math.round(sec * 30), scale: 0.5 });
}
const tp = { spec: { width: formatId === 'yt' ? 1280 : spec.width, height: formatId === 'yt' ? 720 : spec.height, theme, text: 'Octopus Brains', icon: 'brain' } };
const tc = await selectComposition({ serveUrl, id: 'Thumbnail', inputProps: tp });
await renderStill({ serveUrl, composition: tc, inputProps: tp, output: path.join(dir, 'thumb.png'), scale: 0.5 });
console.log('done', dir, shots.length);
