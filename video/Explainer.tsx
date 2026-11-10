import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, Sequence, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SpecBeat, VideoSpec, Word } from './spec';
import { LayoutCtx, clamp, useLayout, type Layout } from './kit';
import { themeFor, body, display } from './theme';
import * as B from './Beats';
import { PlateBeat, PlateLayer, isPlateBeat } from './Plate';

/** Moving background: theme gradient, two drifting glows, a slow grid and floating specks. Always in motion, never distracting. */
const Background: React.FC = () => {
  const { theme, u } = useLayout();
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const g1 = { x: 30 + Math.sin(frame / 90) * 18, y: 25 + Math.cos(frame / 110) * 14 };
  const g2 = { x: 70 + Math.cos(frame / 100) * 16, y: 75 + Math.sin(frame / 80) * 12 };
  const grid = 90 * u;
  const specks = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    x: random(`x${i}`) * width, y: random(`y${i}`) * height, r: (1.5 + random(`r${i}`) * 3.5) * u, s: 0.2 + random(`s${i}`) * 0.6,
  })), [width, height, u]);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${theme.bg1}, ${theme.bg2})` }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${g1.x}% ${g1.y}%, ${theme.glow1}, transparent 45%), radial-gradient(circle at ${g2.x}% ${g2.y}%, ${theme.glow2}, transparent 50%)` }} />
      <AbsoluteFill style={{
        backgroundImage: `linear-gradient(${theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)'} 1px, transparent 1px), linear-gradient(90deg, ${theme.dark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)'} 1px, transparent 1px)`,
        backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${(frame * 0.4) % grid}px ${(frame * 0.25) % grid}px`,
        maskImage: 'radial-gradient(circle at 50% 45%, black 20%, transparent 75%)', WebkitMaskImage: 'radial-gradient(circle at 50% 45%, black 20%, transparent 75%)',
      }} />
      {specks.map((p, i) => (
        <div key={i} style={{ position: 'absolute', left: p.x, top: (p.y - frame * p.s * 1.2 * u + height * 2) % height, width: p.r * 2, height: p.r * 2,
          borderRadius: '50%', background: i % 3 ? theme.accent : theme.accent2, opacity: 0.18 + 0.15 * Math.sin(frame / 20 + i) }} />
      ))}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 55%, ${theme.dark ? 'rgba(0,0,0,0.55)' : 'rgba(60,40,10,0.15)'})` }} />
    </AbsoluteFill>
  );
};

const ENTRANCES = ['rise', 'zoom', 'slide', 'drop', 'zoomOut'] as const;

/** Wraps one beat: an entrance that varies beat to beat (pattern interrupt), a slow push-in while it holds, and a quick exit. */
const BeatShell: React.FC<{ b: SpecBeat; index: number; frames: number; frameW: number; frameH: number }> = ({ b, index, frames, frameW, frameH }) => {
  const layout = useLayout();
  const { stage, u } = layout;
  const frame = useCurrentFrame();
  const kind = ENTRANCES[index % ENTRANCES.length];
  const enter = interpolate(frame, [0, 11], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  const exit = interpolate(frame, [frames - 6, frames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const push = 1 + interpolate(frame, [0, frames], [0, 0.035], clamp);
  let transform = '';
  if (kind === 'rise') transform = `translateY(${(1 - enter) * 120 * u}px)`;
  if (kind === 'zoom') transform = `scale(${0.75 + 0.25 * enter})`;
  if (kind === 'slide') transform = `translateX(${(1 - enter) * 220 * u}px)`;
  if (kind === 'drop') transform = `translateY(${(enter - 1) * 120 * u}px)`;
  if (kind === 'zoomOut') transform = `scale(${1.3 - 0.3 * enter})`;
  const out = `scale(${1 - exit * 0.08}) translateY(${-exit * 30 * u}px)`;
  const opacity = Math.min(interpolate(enter, [0, 0.6], [0, 1], clamp), 1 - exit);
  const Comp = {
    hook: B.Hook, title: B.Title, stat: B.Stat, list: B.List, compare: B.Compare, bars: B.Bars, timeline: B.Timeline,
    steps: B.Steps, icons: B.Icons, quote: B.Quote, question: B.Question, callout: B.Callout, image: B.Title,
    // Plate beats in a scene without a picture fall back to a title card.
    point: B.Title, zoom: B.Title, wide: B.Title,
  }[b.kind] ?? B.Title;
  return (
    <div style={{ position: 'absolute', left: stage.x, top: stage.y, width: stage.w, height: stage.h, opacity,
      transform: `${transform} ${out} scale(${push})`, transformOrigin: '50% 50%' }}>
      {b.kind === 'image' && b.image ? <B.ImageBeat b={b} frameW={frameW} frameH={frameH} index={index} /> : <Comp b={b} />}
    </div>
  );
};

/** Quick fade-out at the end of a plate overlay so labels do not pop off. */
const PlateBeatFade: React.FC<{ frames: number; children: React.ReactNode }> = ({ frames, children }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ opacity: interpolate(frame, [frames - 6, frames], [1, 0], clamp) }}>{children}</AbsoluteFill>;
};

/** Group words into short caption phrases: break on punctuation, pauses, and a word / character limit. */
function phrases(words: Word[], maxWords: number, maxChars: number) {
  const out: { words: Word[]; start: number; end: number }[] = [];
  let cur: Word[] = [];
  const flush = () => { if (cur.length) out.push({ words: cur, start: cur[0].s, end: cur[cur.length - 1].e }); cur = []; };
  words.forEach((w, i) => {
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    const prev = words[i - 1];
    if (cur.length && (cur.length >= maxWords || chars > maxChars || (prev && w.s - prev.e > 0.35) || (prev && prev.scene !== w.scene))) flush();
    cur.push(w);
    if (/[.!?;:,—]$/.test(w.w)) flush();
  });
  flush();
  return out;
}

/** Big word-by-word captions, the active word lit and popped. Most people watch muted; this carries the video without sound. */
const Captions: React.FC<{ words: Word[]; y: number }> = ({ words, y }) => {
  const { theme, u, vertical, stage } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const list = useMemo(() => phrases(words, vertical ? 3 : 6, vertical ? 18 : 38), [words, vertical]);
  const i = list.findIndex((p, k) => t >= p.start - 0.05 && t < (list[k + 1]?.start ?? Infinity) - 0.05);
  const ph = list[i];
  if (!ph || t > ph.end + 0.7) return null;
  const since = (t - ph.start) * fps;
  const pop = interpolate(since, [0, 4, 8], [0.82, 1.06, 1], clamp);
  const size = (vertical ? 76 : 60) * u;
  const stroke = theme.stroke;
  return (
    <div style={{ position: 'absolute', left: stage.x, width: stage.w, top: y - size, display: 'flex', justifyContent: 'center', flexWrap: 'wrap',
      transform: `scale(${pop})`, fontFamily: display, fontWeight: 900, fontSize: size, lineHeight: 1.15,
      textTransform: vertical ? 'uppercase' : 'none', textAlign: 'center' }}>
      {ph.words.map((w, k) => {
        const active = t >= w.s - 0.03 && (t < (ph.words[k + 1]?.s ?? ph.end + 0.7) - 0.03);
        const said = t >= w.s - 0.03;
        return (
          <span key={k} style={{ color: active ? theme.accent2 : theme.dark ? '#FFFFFF' : theme.text, opacity: said ? 1 : 0.6,
            transform: `scale(${active ? 1.06 : 1})`, display: 'inline-block', margin: `0 ${size * 0.2}px`,
            textShadow: `0 0 ${6 * u}px ${stroke}, ${4 * u}px ${4 * u}px 0 ${stroke}, -${3 * u}px -${3 * u}px 0 ${stroke}, ${3 * u}px -${3 * u}px 0 ${stroke}, -${3 * u}px ${3 * u}px 0 ${stroke}, 0 ${8 * u}px ${24 * u}px rgba(0,0,0,0.5)` }}>
            {w.w.replace(/[,;:]$/, '')}
          </span>
        );
      })}
    </div>
  );
};

const Progress: React.FC = () => {
  const { theme, u } = useLayout();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, height: 8 * u, width: `${(frame / durationInFrames) * 100}%`,
      background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`, boxShadow: `0 0 ${16 * u}px ${theme.accent}` }} />
  );
};

const ChapterTag: React.FC<{ n: number; name: string; x: number; y: number }> = ({ n, name, x, y }) => {
  const { theme, u } = useLayout();
  const frame = useCurrentFrame();
  const p = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ position: 'absolute', left: x, top: y, display: 'flex', alignItems: 'center', gap: 14 * u, opacity: p, transform: `translateX(${(p - 1) * 40 * u}px)`,
      fontFamily: body, fontWeight: 700, fontSize: 28 * u, color: theme.muted, letterSpacing: 2 * u, textTransform: 'uppercase' }}>
      <span style={{ fontFamily: display, fontWeight: 900, color: theme.accent }}>{String(n).padStart(2, '0')}</span>
      <span style={{ width: 30 * u, height: 3 * u, background: theme.accent, display: 'inline-block' }} />
      {name}
    </div>
  );
};

/** Quick accent sweep across the frame at chapter changes. */
const Sweep: React.FC = () => {
  const { theme } = useLayout();
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 10], [-120, 120], clamp);
  return <AbsoluteFill style={{ background: `linear-gradient(100deg, transparent ${40 + x}%, ${theme.accent}55 ${50 + x}%, transparent ${60 + x}%)`, pointerEvents: 'none' }} />;
};

export const Explainer: React.FC<{ spec: VideoSpec }> = ({ spec }) => {
  const { fps, width: W, height: H } = useVideoConfig();
  const theme = themeFor(spec.theme, spec.palette);
  const u = Math.min(W, H) / 1080;
  const s = spec.safe;
  const captionY = H * (1 - s.bottom) - (spec.vertical ? 220 : 110) * u;
  const top = H * s.top + (spec.showChapters ? 60 : 10) * u;
  const stage = { x: W * s.left, y: top, w: W * (1 - s.left - s.right), h: captionY - (spec.vertical ? 170 : 130) * u - top };
  const layout: Layout = { theme, u, vertical: spec.vertical, stage };
  const f = (sec: number) => Math.round(sec * fps);
  let beatIndex = 0;

  return (
    <LayoutCtx.Provider value={layout}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Background />
        {spec.scenes.map((sc, si) => (
          <React.Fragment key={si}>
            {spec.plates?.[si] && (
              <Sequence from={f(sc.start)} durationInFrames={Math.max(1, f(sc.end) - f(sc.start))} layout="none">
                <PlateLayer scene={sc} plate={spec.plates[si]!} />
              </Sequence>
            )}
            {sc.beats.map((b, bi) => {
              const from = f(b.start);
              const frames = Math.max(1, f(b.end) - from);
              const idx = beatIndex++;
              const plate = spec.plates?.[si];
              return (
                <Sequence key={`${si}-${bi}`} from={from} durationInFrames={frames} layout="none">
                  {plate && isPlateBeat(b)
                    ? <PlateBeatFade frames={frames}><PlateBeat b={b} scene={sc} plate={plate} /></PlateBeatFade>
                    : <BeatShell b={b} index={idx} frames={frames} frameW={W} frameH={H} />}
                </Sequence>
              );
            })}
            {spec.showChapters && (
              <Sequence from={f(sc.start)} durationInFrames={Math.max(1, f(sc.end) - f(sc.start))} layout="none">
                <ChapterTag n={si + 1} name={sc.chapter} x={W * s.left} y={H * s.top} />
              </Sequence>
            )}
            {si > 0 && <Sequence from={f(sc.start)} durationInFrames={12} layout="none"><Sweep /></Sequence>}
          </React.Fragment>
        ))}
        {spec.captions !== false && <Captions words={spec.words} y={captionY} />}
        <Progress />

        {spec.voice && <Audio src={staticFile(spec.voice)} />}
        {spec.music && <Audio src={staticFile(spec.music)} volume={spec.musicVolume} loop />}
        {spec.sfx && spec.sfxCues && spec.sfxCues.map((q, i) => (
          <Sequence key={`sfx${i}`} from={f(q.start)} durationInFrames={Math.max(1, f(q.dur + 0.1))} layout="none">
            <Audio src={staticFile(q.file)} volume={q.volume} />
          </Sequence>
        ))}
        {spec.sfx && !spec.sfxCues && spec.scenes.flatMap((sc, si) => sc.beats.flatMap((b, bi) => {
          const first = si === 0 && bi === 0;
          const out = [
            <Sequence key={`w${si}-${bi}`} from={f(b.start)} durationInFrames={f(0.7)} layout="none">
              <Audio src={staticFile(first || b.kind === 'stat' || b.kind === 'callout' ? 'sfx/hit.wav' : 'sfx/whoosh.wav')}
                volume={first ? 0.45 : b.kind === 'stat' || b.kind === 'callout' ? 0.3 : 0.16} />
            </Sequence>,
          ];
          (b.itemTimes ?? []).forEach((t, k) => out.push(
            <Sequence key={`p${si}-${bi}-${k}`} from={f(t)} durationInFrames={f(0.3)} layout="none">
              <Audio src={staticFile('sfx/pop.wav')} volume={0.12} />
            </Sequence>,
          ));
          return out;
        }))}
      </AbsoluteFill>
    </LayoutCtx.Provider>
  );
};
