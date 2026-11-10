import React, { createContext, useContext } from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { display, type Theme } from './theme';
import { iconFor } from './icons';

/** Layout shared by every beat: theme, a size unit (1 = 1px on a 1080-wide frame) and the stage box where visuals go. */
export interface Layout {
  theme: Theme;
  u: number;
  vertical: boolean;
  stage: { x: number; y: number; w: number; h: number };
}
export const LayoutCtx = createContext<Layout>(null as unknown as Layout);
export const useLayout = () => useContext(LayoutCtx);

/** Spring from 0 to 1 starting at `delay` frames into the current sequence. */
export function usePop(delay = 0, stiffness = 180, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { stiffness, damping, mass: 0.8 } });
}

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Font size so `text` fits in `width` within `lines` lines, never above `max`. */
export function fit(text: string, width: number, lines: number, max: number, charW = 0.6) {
  const chars = Math.max(4, text.length);
  const longest = Math.max(...text.split(/\s+/).map((w) => w.length), 1);
  return Math.min(max, (width * lines) / (chars * charW * 1.08), width / (longest * charW * 1.05));
}

/** Heading where the `highlight` word is drawn in the accent color, words springing in one after another. */
export const Words: React.FC<{
  text: string; highlight?: string; size: number; color?: string; stagger?: number; delay?: number; weight?: number; align?: 'center' | 'left'; slam?: boolean;
}> = ({ text, highlight, size, color, stagger = 3, delay = 0, weight = 900, align = 'center', slam }) => {
  const { theme } = useLayout();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hl = (highlight ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <div style={{ fontFamily: display, fontWeight: weight, fontSize: size, lineHeight: 1.08, color: color ?? theme.text, textAlign: align,
      letterSpacing: -0.02 * size, display: 'flex', flexWrap: 'wrap', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: `0 ${size * 0.26}px` }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: { stiffness: slam ? 260 : 170, damping: slam ? 13 : 16 } });
        const on = hl && w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === hl;
        const scale = slam ? interpolate(p, [0, 1], [1.6, 1]) : interpolate(p, [0, 1], [0.7, 1]);
        return (
          <span key={i} style={{ display: 'inline-block', opacity: interpolate(p, [0, 0.4], [0, 1], clamp),
            transform: `translateY(${interpolate(p, [0, 1], [size * 0.45, 0])}px) scale(${scale})`,
            color: on ? theme.accent : undefined, position: 'relative' }}>
            {w}
            {on && <span style={{ position: 'absolute', left: 0, right: 0, bottom: size * 0.02, height: size * 0.12, borderRadius: size,
              background: theme.accent, opacity: 0.35, transformOrigin: 'left', transform: `scaleX(${interpolate(frame - delay - i * stagger, [6, 18], [0, 1], clamp)})` }} />}
          </span>
        );
      })}
    </div>
  );
};

/** Icon in a glowing round badge. */
export const IconBadge: React.FC<{ name?: string; size: number; color?: string; delay?: number; pulse?: boolean }> = ({ name, size, color, delay = 0, pulse }) => {
  const { theme } = useLayout();
  const frame = useCurrentFrame();
  const Icon = iconFor(name);
  const p = usePop(delay, 200, 12);
  if (!Icon) return null;
  const c = color ?? theme.accent;
  const breathe = pulse ? 1 + Math.sin((frame - delay) / 9) * 0.04 : 1;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `radial-gradient(circle at 35% 30%, ${c}55, ${c}18 60%, transparent 75%)`, border: `${size * 0.025}px solid ${c}66`,
      boxShadow: `0 0 ${size * 0.5}px ${c}44`, transform: `scale(${p * breathe}) rotate(${interpolate(p, [0, 1], [-25, 0])}deg)`, flexShrink: 0 }}>
      <Icon size={size * 0.5} color={c} strokeWidth={2.2} />
    </div>
  );
};

export const Card: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => {
  const { theme, u } = useLayout();
  return (
    <div style={{ background: theme.card, border: `${2 * u}px solid ${theme.cardBorder}`, borderRadius: 28 * u,
      boxShadow: theme.dark ? `0 ${20 * u}px ${60 * u}px rgba(0,0,0,0.35)` : `0 ${14 * u}px ${40 * u}px rgba(60,40,10,0.12)`, ...style }}>
      {children}
    </div>
  );
};

/** Format a number for counting animations (1234567 -> 1,234,567). */
export const fmt = (n: number, decimals = 0) => n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
