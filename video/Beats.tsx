import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SpecBeat } from './spec';
import { Card, IconBadge, Words, clamp, fit, fmt, useLayout, usePop } from './kit';
import { body, display } from './theme';
import { iconFor } from './icons';

/** Delay in frames (from the beat's start) at which item k appears. */
const useItemDelays = (b: SpecBeat) => {
  const { fps } = useVideoConfig();
  const n = b.items?.length ?? 0;
  return Array.from({ length: n }, (_, k) => Math.max(4, Math.round(((b.itemTimes?.[k] ?? b.start + 0.3 + k * 0.5) - b.start) * fps)));
};

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 0 }) => (
  <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap }}>{children}</div>
);

const Sub: React.FC<{ text?: string; delay?: number; size?: number }> = ({ text, delay = 10, size }) => {
  const { theme, u } = useLayout();
  const p = usePop(delay);
  if (!text) return null;
  return <div style={{ fontFamily: body, fontWeight: 600, fontSize: size ?? 40 * u, color: theme.muted, textAlign: 'center', opacity: p,
    transform: `translateY(${(1 - p) * 20 * u}px)`, maxWidth: '90%' }}>{text}</div>;
};

export const Hook: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u } = useLayout();
  const text = b.heading ?? '';
  return (
    <Center gap={36 * u}>
      <IconBadge name={b.icon} size={190 * u} pulse />
      <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.94, 3, 150 * u)} slam stagger={4} delay={b.icon ? 6 : 0} />
      <Sub text={b.sub} delay={18} />
    </Center>
  );
};

export const Title: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const frame = useCurrentFrame();
  const text = b.heading ?? '';
  const bar = interpolate(frame, [4, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <Center gap={30 * u}>
      <IconBadge name={b.icon} size={150 * u} />
      <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.9, 3, 120 * u)} delay={4} />
      <div style={{ width: 160 * u * bar, height: 8 * u, borderRadius: 8 * u, background: `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})` }} />
      <Sub text={b.sub} delay={14} />
    </Center>
  );
};

export const Stat: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const v = b.value ?? 0;
  const t = interpolate(frame, [3, 3 + fps * 1.1], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
  const shown = `${b.prefix ?? ''}${fmt(v * t, b.decimals ?? (Number.isInteger(v) ? 0 : 1))}${b.suffix ?? ''}`;
  const finalText = `${b.prefix ?? ''}${fmt(v, b.decimals ?? (Number.isInteger(v) ? 0 : 1))}${b.suffix ?? ''}`;
  const size = fit(finalText, stage.w * 0.9, 1, 260 * u, 0.66);
  const land = interpolate(frame, [3 + fps * 1.0, 3 + fps * 1.25], [1.12, 1], clamp);
  return (
    <Center gap={18 * u}>
      <IconBadge name={b.icon} size={120 * u} />
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: size, lineHeight: 1, letterSpacing: -0.03 * size,
        background: `linear-gradient(180deg, ${theme.text} 20%, ${theme.accent})`, WebkitBackgroundClip: 'text', color: 'transparent',
        transform: `scale(${t < 1 ? 1 : land})`, fontVariantNumeric: 'tabular-nums', filter: `drop-shadow(0 0 ${30 * u}px ${theme.accent}55)` }}>
        {shown}
      </div>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.85, 2, 64 * u)} weight={800} delay={10} stagger={2} />}
      <Sub text={b.sub} delay={18} />
    </Center>
  );
};

export const List: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const frame = useCurrentFrame();
  const delays = useItemDelays(b);
  const items = b.items ?? [];
  const active = delays.reduce((a, d, i) => (frame >= d ? i : a), -1);
  const rowH = Math.min(150 * u, (stage.h * 0.78) / Math.max(1, items.length));
  return (
    <Center gap={24 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 2, 80 * u)} weight={800} />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: rowH * 0.14, width: Math.min(stage.w * 0.95, 1300 * u) }}>
        {items.map((it, i) => <ListRow key={i} it={it} i={i} delay={delays[i]} h={rowH} on={i === active} accent={theme.accent} />)}
      </div>
    </Center>
  );
};

const ListRow: React.FC<{ it: NonNullable<SpecBeat['items']>[number]; i: number; delay: number; h: number; on: boolean; accent: string }> = ({ it, i, delay, h, on, accent }) => {
  const { u, theme } = useLayout();
  const p = usePop(delay, 200, 15);
  const Icon = iconFor(it.icon);
  return (
    <Card style={{ display: 'flex', alignItems: 'center', gap: h * 0.22, padding: `${h * 0.12}px ${h * 0.22}px`, minHeight: h * 0.86,
      opacity: interpolate(p, [0, 0.5], [0, on ? 1 : 0.92], clamp), transform: `translateX(${(1 - p) * -120 * u}px) scale(${on ? 1.03 : 1})`,
      borderColor: on ? accent : theme.cardBorder }}>
      <div style={{ width: h * 0.56, height: h * 0.56, borderRadius: h * 0.16, background: `${accent}22`, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontFamily: display, fontWeight: 900, fontSize: h * 0.3, color: accent, flexShrink: 0 }}>
        {Icon ? <Icon size={h * 0.32} color={accent} strokeWidth={2.4} /> : i + 1}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: Math.min(h * 0.32, 56 * u), color: theme.text, lineHeight: 1.1 }}>{it.label}</div>
        {it.detail && <div style={{ fontFamily: body, fontWeight: 500, fontSize: Math.min(h * 0.2, 34 * u), color: theme.muted, marginTop: 4 * u }}>{it.detail}</div>}
      </div>
    </Card>
  );
};

export const Compare: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sides = [b.left, b.right].filter(Boolean) as NonNullable<SpecBeat['left']>[];
  const vs = usePop(Math.round(fps * 0.5), 220, 10);
  const cardW = vertical ? stage.w * 0.92 : stage.w * 0.42;
  const cardH = vertical ? stage.h * 0.4 : stage.h * 0.72;
  return (
    <Center gap={16 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 1, 72 * u)} weight={800} />}
      <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: vertical ? 10 * u : 40 * u, position: 'relative' }}>
        {sides.map((s, i) => <CompareCard key={i} s={s} i={i} w={cardW} h={cardH} color={i === 0 ? theme.accent : theme.accent2} />)}
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 120 * u, height: 120 * u, marginLeft: -60 * u, marginTop: -60 * u,
          borderRadius: '50%', background: theme.text, color: theme.bg1, fontFamily: display, fontWeight: 900, fontSize: 46 * u, display: 'flex',
          alignItems: 'center', justifyContent: 'center', transform: `scale(${vs}) rotate(${interpolate(vs, [0, 1], [-180, 0]) + Math.sin(frame / 12) * 4}deg)`,
          boxShadow: `0 0 ${50 * u}px ${theme.accent}88` }}>VS</div>
      </div>
    </Center>
  );
};

const CompareCard: React.FC<{ s: NonNullable<SpecBeat['left']>; i: number; w: number; h: number; color: string }> = ({ s, i, w, h, color }) => {
  const { u, theme, vertical } = useLayout();
  const { fps } = useVideoConfig();
  const p = usePop(i * Math.round(fps * 0.35), 170, 15);
  const from = vertical ? `translateY(${(i ? 1 : -1) * (1 - p) * 200 * u}px)` : `translateX(${(i ? 1 : -1) * (1 - p) * 300 * u}px)`;
  return (
    <Card style={{ width: w, height: h, padding: 36 * u, display: 'flex', flexDirection: vertical ? 'row' : 'column', alignItems: 'center',
      justifyContent: 'center', gap: 24 * u, transform: from, opacity: p, borderColor: `${color}88`, background: `linear-gradient(160deg, ${color}22, ${theme.card})` }}>
      <IconBadge name={s.icon} size={(vertical ? 130 : 150) * u} color={color} delay={i * 8 + 6} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: vertical ? 'flex-start' : 'center', gap: 10 * u }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: fit(s.title, w * 0.6, 1, 72 * u), color }}>{s.title}</div>
        {s.points.slice(0, 3).map((pt, k) => (
          <div key={k} style={{ fontFamily: body, fontWeight: 600, fontSize: 34 * u, color: theme.text, opacity: 0.9, textAlign: vertical ? 'left' : 'center' }}>{pt}</div>
        ))}
      </div>
    </Card>
  );
};

export const Bars: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delays = useItemDelays(b);
  const items = (b.items ?? []).slice(0, 6);
  const max = Math.max(...items.map((i) => Math.abs(i.value ?? 0)), 1);
  const colors = [theme.accent, theme.accent2, theme.text];
  const horizontalBars = vertical; // on a tall frame, bars run sideways so labels stay readable
  return (
    <Center gap={30 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 2, 72 * u)} weight={800} />}
      <div style={{ display: 'flex', flexDirection: horizontalBars ? 'column' : 'row', alignItems: horizontalBars ? 'stretch' : 'flex-end',
        gap: (horizontalBars ? 26 : 40) * u, width: stage.w * 0.92, height: horizontalBars ? undefined : stage.h * 0.62 }}>
        {items.map((it, i) => {
          const t = interpolate(frame, [delays[i], delays[i] + fps * 0.8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const frac = Math.abs(it.value ?? 0) / max;
          const col = colors[i % colors.length];
          const val = `${b.prefix ?? ''}${fmt((it.value ?? 0) * t, b.decimals ?? 0)}${b.suffix ?? ''}`;
          return horizontalBars ? (
            <div key={i} style={{ opacity: interpolate(t, [0, 0.2], [0.35, 1], clamp) }}>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40 * u, color: theme.text, marginBottom: 8 * u }}>{it.label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18 * u }}>
                <div style={{ height: 64 * u, width: `${Math.max(1.5, frac * t * 78)}%`, borderRadius: 16 * u, background: `linear-gradient(90deg, ${col}aa, ${col})`, boxShadow: `0 0 ${30 * u}px ${col}55` }} />
                <div style={{ fontFamily: display, fontWeight: 900, fontSize: 44 * u, color: col, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              </div>
            </div>
          ) : (
            <div key={i} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 12 * u, opacity: interpolate(t, [0, 0.2], [0.35, 1], clamp) }}>
              <div style={{ fontFamily: display, fontWeight: 900, fontSize: 46 * u, color: col, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
              <div style={{ width: '70%', height: `${Math.max(1, frac * t * 72)}%`, borderRadius: `${16 * u}px ${16 * u}px 0 0`, background: `linear-gradient(0deg, ${col}88, ${col})`, boxShadow: `0 0 ${40 * u}px ${col}44` }} />
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 34 * u, color: theme.text, textAlign: 'center' }}>{it.label}</div>
            </div>
          );
        })}
      </div>
    </Center>
  );
};

export const Timeline: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const delays = useItemDelays(b);
  const items = (b.items ?? []).slice(0, 6);
  const last = delays[delays.length - 1] ?? 10;
  const draw = interpolate(frame, [0, last + 10], [0, 1], clamp);
  return (
    <Center gap={30 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 2, 72 * u)} weight={800} />}
      <div style={{ position: 'relative', display: 'flex', flexDirection: vertical ? 'column' : 'row', gap: vertical ? 34 * u : 0,
        width: vertical ? stage.w * 0.9 : stage.w * 0.95, justifyContent: 'space-between' }}>
        <div style={{ position: 'absolute', background: `linear-gradient(${vertical ? 180 : 90}deg, ${theme.accent}, ${theme.accent2})`, borderRadius: 6 * u,
          ...(vertical ? { left: 30 * u, top: 0, width: 6 * u, height: `${draw * 100}%` } : { top: 30 * u, left: 0, height: 6 * u, width: `${draw * 100}%` }) }} />
        {items.map((it, i) => <TimelineNode key={i} it={it} delay={delays[i]} n={items.length} />)}
      </div>
    </Center>
  );
};

const TimelineNode: React.FC<{ it: NonNullable<SpecBeat['items']>[number]; delay: number; n: number }> = ({ it, delay, n }) => {
  const { u, theme, vertical, stage } = useLayout();
  const p = usePop(delay, 220, 13);
  return (
    <div style={{ display: 'flex', flexDirection: vertical ? 'row' : 'column', alignItems: vertical ? 'center' : 'center', gap: 20 * u,
      width: vertical ? undefined : stage.w * 0.95 / n, opacity: interpolate(p, [0, 0.4], [0, 1], clamp), zIndex: 1 }}>
      <div style={{ width: 66 * u, height: 66 * u, borderRadius: '50%', background: theme.bg1, border: `${8 * u}px solid ${theme.accent}`,
        transform: `scale(${p})`, boxShadow: `0 0 ${30 * u}px ${theme.accent}`, flexShrink: 0 }} />
      <div style={{ textAlign: vertical ? 'left' : 'center', transform: `translateY(${(1 - p) * 30 * u}px)` }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: 50 * u, color: theme.accent2 }}>{it.label}</div>
        {it.detail && <div style={{ fontFamily: body, fontWeight: 600, fontSize: 32 * u, color: theme.text, maxWidth: vertical ? stage.w * 0.7 : undefined }}>{it.detail}</div>}
      </div>
    </div>
  );
};

export const Steps: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const delays = useItemDelays(b);
  const items = (b.items ?? []).slice(0, 5);
  const box = vertical ? Math.min(stage.h / (items.length * 1.6), 200 * u) : Math.min(stage.w / (items.length * 1.7), 280 * u);
  return (
    <Center gap={30 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 2, 72 * u)} weight={800} />}
      <div style={{ display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center' }}>
        {items.map((it, i) => {
          const arrow = i > 0 ? interpolate(frame, [delays[i] - 8, delays[i]], [0, 1], clamp) : 0;
          const Arrow = iconFor(vertical ? 'arrow-down' : 'arrow-right')!;
          return (
            <React.Fragment key={i}>
              {i > 0 && <div style={{ opacity: arrow, transform: vertical ? `translateY(${(arrow - 1) * 20}px)` : `translateX(${(arrow - 1) * 20}px)`, padding: 8 * u }}>
                <Arrow size={56 * u} color={theme.muted} strokeWidth={2.6} /></div>}
              <StepBox it={it} i={i} delay={delays[i]} size={box} />
            </React.Fragment>
          );
        })}
      </div>
    </Center>
  );
};

const StepBox: React.FC<{ it: NonNullable<SpecBeat['items']>[number]; i: number; delay: number; size: number }> = ({ it, i, delay, size }) => {
  const { u, theme, vertical } = useLayout();
  const p = usePop(delay, 200, 14);
  const col = i % 2 ? theme.accent2 : theme.accent;
  return (
    <Card style={{ display: 'flex', flexDirection: vertical ? 'row' : 'column', alignItems: 'center', gap: 16 * u, padding: 24 * u,
      minWidth: vertical ? size * 3.6 : size, transform: `scale(${p})`, opacity: p, borderColor: `${col}88` }}>
      <IconBadge name={it.icon} size={size * 0.5} color={col} delay={delay + 4} />
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: Math.min(44 * u, size * 0.2), color: theme.text, textAlign: 'center' }}>{it.label}</div>
    </Card>
  );
};

export const Icons: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u } = useLayout();
  const delays = useItemDelays(b);
  const items = (b.items ?? []).slice(0, 6);
  const cols = items.length <= 3 ? items.length : 2;
  const cell = Math.min(stage.w / (cols * 1.25), stage.h / (Math.ceil(items.length / cols) * 1.6), 330 * u);
  return (
    <Center gap={30 * u}>
      {b.heading && <Words text={b.heading} highlight={b.highlight} size={fit(b.heading, stage.w * 0.9, 2, 72 * u)} weight={800} />}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, ${cell}px)`, gap: 30 * u }}>
        {items.map((it, i) => <IconCell key={i} it={it} i={i} delay={delays[i]} size={cell} />)}
      </div>
    </Center>
  );
};

const IconCell: React.FC<{ it: NonNullable<SpecBeat['items']>[number]; i: number; delay: number; size: number }> = ({ it, i, delay, size }) => {
  const { u, theme } = useLayout();
  const p = usePop(delay, 220, 12);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 * u, transform: `translateY(${(1 - p) * 60 * u}px)`, opacity: p }}>
      <IconBadge name={it.icon ?? 'sparkles'} size={size * 0.62} color={i % 2 ? theme.accent2 : theme.accent} delay={delay} />
      <div style={{ fontFamily: display, fontWeight: 800, fontSize: Math.min(42 * u, size * 0.16), color: theme.text, textAlign: 'center' }}>{it.label}</div>
    </div>
  );
};

export const Quote: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const text = b.heading ?? '';
  const p = usePop(0, 160, 14);
  return (
    <Center gap={20 * u}>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: 260 * u, lineHeight: 0.6, color: theme.accent, opacity: 0.85 * p, transform: `scale(${p})`, height: 120 * u }}>“</div>
      <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.86, 4, 84 * u)} weight={700} stagger={2} delay={6} />
      {b.sub && <Sub text={`— ${b.sub}`} delay={16} />}
    </Center>
  );
};

export const Question: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const frame = useCurrentFrame();
  const text = b.heading ?? '';
  const p = usePop(0, 200, 10);
  return (
    <Center gap={10 * u}>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: 300 * u, lineHeight: 1, color: theme.accent2,
        transform: `scale(${p * (1 + Math.sin(frame / 7) * 0.05)}) rotate(${Math.sin(frame / 10) * 6}deg)`, textShadow: `0 0 ${60 * u}px ${theme.accent2}88` }}>?</div>
      <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.9, 3, 100 * u)} delay={6} />
    </Center>
  );
};

export const Callout: React.FC<{ b: SpecBeat }> = ({ b }) => {
  const { stage, u, theme } = useLayout();
  const frame = useCurrentFrame();
  const text = b.heading ?? '';
  return (
    <Center gap={34 * u}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {[0, 1, 2].map((r) => {
          const t = ((frame + r * 15) % 45) / 45;
          return <div key={r} style={{ position: 'absolute', width: 260 * u, height: 260 * u, borderRadius: '50%', border: `${4 * u}px solid ${theme.accent}`,
            opacity: 1 - t, transform: `scale(${0.8 + t * 1.2})` }} />;
        })}
        <IconBadge name={b.icon ?? 'zap'} size={260 * u} />
      </div>
      <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.9, 2, 120 * u)} slam delay={4} />
      <Sub text={b.sub} delay={14} />
    </Center>
  );
};

/** Full-frame illustration with a slow Ken Burns move; the heading sits on a dark gradient. */
export const ImageBeat: React.FC<{ b: SpecBeat; frameW: number; frameH: number; index: number }> = ({ b, frameW, frameH, index }) => {
  const { u, stage, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = Math.max(1, (b.end - b.start) * fps);
  const t = frame / dur;
  const dir = index % 2 ? 1 : -1;
  const p = usePop(0, 120, 18);
  const text = b.heading ?? '';
  return (
    <div style={{ position: 'absolute', left: -stage.x, top: -stage.y, width: frameW, height: frameH, overflow: 'hidden' }}>
      {b.image && <Img src={staticFile(b.image)} style={{ width: '100%', height: '100%', objectFit: 'cover',
        transform: `scale(${1.08 + t * 0.1}) translate(${dir * t * 2}%, ${-t * 1.5}%)`, opacity: p }} />}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, ${theme.bg1}55 0%, transparent 30%, transparent 45%, ${theme.bg1}dd 85%)` }} />
      {text && (
        <div style={{ position: 'absolute', left: stage.x, width: stage.w, top: vertical ? stage.y + stage.h * 0.62 : stage.y + stage.h * 0.68 }}>
          <Words text={text} highlight={b.highlight} size={fit(text, stage.w * 0.9, 2, 96 * u)} delay={8} />
        </div>
      )}
    </div>
  );
};
