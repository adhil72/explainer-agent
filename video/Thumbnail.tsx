import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import type { ThumbSpec } from './spec';
import { themeFor, display } from './theme';
import { fit } from './kit';
import { iconFor } from './icons';

/** Thumbnail / cover: the picture, a dark side for contrast, and 2-4 huge words with the last one in the accent color. */
export const Thumbnail: React.FC<{ spec: ThumbSpec }> = ({ spec }) => {
  const theme = themeFor(spec.theme, spec.palette);
  const wide = spec.width > spec.height;
  const u = Math.min(spec.width, spec.height) / 720;
  const words = spec.text.toUpperCase().split(/\s+/).filter(Boolean);
  const boxW = wide ? spec.width * 0.55 : spec.width * 0.88;
  const size = fit(spec.text, boxW, Math.min(3, words.length), wide ? 190 * u : 170 * u, 0.66);
  const Icon = iconFor(spec.icon);
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${theme.bg1}, ${theme.bg2})` }}>
      {spec.image && <Img src={staticFile(spec.image)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      <AbsoluteFill style={{ background: wide
        ? `linear-gradient(90deg, ${theme.bg1}F2 0%, ${theme.bg1}CC 38%, transparent 70%)`
        : `linear-gradient(180deg, ${theme.bg1}F2 0%, ${theme.bg1}BB 35%, transparent 60%)` }} />
      {!spec.image && Icon && (
        <div style={{ position: 'absolute', right: wide ? spec.width * 0.08 : undefined, bottom: spec.height * 0.12, left: wide ? undefined : spec.width * 0.3, opacity: 0.9 }}>
          <Icon size={(wide ? 320 : 420) * u} color={theme.accent} strokeWidth={1.6} />
        </div>
      )}
      <div style={{ position: 'absolute', left: spec.width * 0.06, top: wide ? 0 : spec.height * 0.1, height: wide ? '100%' : undefined, width: boxW,
        display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ fontFamily: display, fontWeight: 900, fontSize: size, lineHeight: 0.98, letterSpacing: -0.02 * size, color: '#fff',
          textShadow: `0 ${6 * u}px 0 ${theme.stroke}, 0 0 ${30 * u}px rgba(0,0,0,0.6)` }}>
          {words.map((w, i) => (
            <span key={i} style={{ color: i === words.length - 1 ? theme.accent2 : '#fff' }}>{w}{i < words.length - 1 ? ' ' : ''}</span>
          ))}
        </div>
        <div style={{ width: 140 * u, height: 14 * u, marginTop: 24 * u, background: theme.accent, borderRadius: 10 * u }} />
      </div>
    </AbsoluteFill>
  );
};
