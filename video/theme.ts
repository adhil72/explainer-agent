import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import type { Palette, ThemeName } from './spec';

export const display = loadMontserrat('normal', { weights: ['700', '800', '900'], subsets: ['latin', 'latin-ext'] }).fontFamily;
export const body = loadInter('normal', { weights: ['500', '600', '700'], subsets: ['latin', 'latin-ext'] }).fontFamily;

export interface Theme {
  dark: boolean;
  bg1: string;
  bg2: string;
  glow1: string;
  glow2: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  card: string;
  cardBorder: string;
  /** Outline / shadow color around captions, opposite of the text color. */
  stroke: string;
}

export const THEMES: Record<Exclude<ThemeName, 'custom'>, Theme> = {
  midnight: {
    dark: true, bg1: '#060A18', bg2: '#0F1B3D', glow1: 'rgba(34,211,238,0.22)', glow2: 'rgba(129,80,255,0.20)',
    text: '#F4F7FF', muted: '#97A6D0', accent: '#22D3EE', accent2: '#FBBF24',
    card: 'rgba(255,255,255,0.06)', cardBorder: 'rgba(255,255,255,0.13)', stroke: '#020412',
  },
  neon: {
    dark: true, bg1: '#040406', bg2: '#140620', glow1: 'rgba(255,43,214,0.22)', glow2: 'rgba(0,229,255,0.16)',
    text: '#FFFFFF', muted: '#B9A9C9', accent: '#FF2BD6', accent2: '#A3FF12',
    card: 'rgba(255,255,255,0.05)', cardBorder: 'rgba(255,43,214,0.35)', stroke: '#000000',
  },
  sunset: {
    dark: true, bg1: '#170A2A', bg2: '#3A0E3C', glow1: 'rgba(255,138,61,0.25)', glow2: 'rgba(236,72,153,0.20)',
    text: '#FFF7EE', muted: '#E2BFD0', accent: '#FF8A3D', accent2: '#FFD166',
    card: 'rgba(255,255,255,0.07)', cardBorder: 'rgba(255,209,102,0.25)', stroke: '#12051C',
  },
  paper: {
    dark: false, bg1: '#F7F1E5', bg2: '#EADFC6', glow1: 'rgba(217,72,15,0.12)', glow2: 'rgba(15,118,110,0.12)',
    text: '#1C1A15', muted: '#6B6253', accent: '#D9480F', accent2: '#0F766E',
    card: 'rgba(255,255,255,0.65)', cardBorder: 'rgba(28,26,21,0.12)', stroke: '#FFFFFF',
  },
};

const hexA = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16);
  return Number.isNaN(n) ? `rgba(128,128,128,${a})` : `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** The theme to draw with: a preset, or one built from the palette picked from the creator's images. */
export function themeFor(name: ThemeName, palette?: Palette): Theme {
  if (name !== 'custom' || !palette) return THEMES[name as Exclude<ThemeName, 'custom'>] ?? THEMES.midnight;
  const base = palette.dark ? THEMES.midnight : THEMES.paper;
  return {
    ...base, dark: palette.dark, bg1: palette.bg1, bg2: palette.bg2, accent: palette.accent, accent2: palette.accent2,
    glow1: hexA(palette.accent, palette.dark ? 0.22 : 0.12), glow2: hexA(palette.accent2, palette.dark ? 0.18 : 0.1),
    cardBorder: hexA(palette.accent, 0.3),
  };
}
