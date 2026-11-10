import React from 'react';
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SpecBeat, SpecPlate, SpecScene } from './spec';
import { clamp, fit, useLayout } from './kit';
import { body, display } from './theme';

/**
 * The illustrated style: each scene sits on one picture (a plate). A camera moves over it: a wide shot, a push-in to the part the
 * narration names (zoom), a medium shot while an arrow points at a part (point). Overlay beats (stats, lists...) dim the picture.
 * Every position is a pure function of the frame, so renders are deterministic.
 */

const PLATE_KINDS = new Set(['wide', 'zoom', 'point']);
export const isPlateBeat = (b: SpecBeat) => PLATE_KINDS.has(b.kind);

interface Cam { fx: number; fy: number; z: number; dim: number }

/** The picture's rectangle in frame pixels before the camera moves (it covers the frame). */
function coverRect(aspect: number, W: number, H: number) {
  const iw = aspect > W / H ? H * aspect : W;
  const ih = aspect > W / H ? H : W / aspect;
  return { x: (W - iw) / 2, y: (H - ih) / 2, w: iw, h: ih };
}

/** Where a beat wants the camera: centered on the frame (wide), on a part (zoom, tighter), between part and center (point). */
function shotFor(b: SpecBeat, plate: SpecPlate, W: number, H: number, prev: Cam): Cam {
  const r = coverRect(plate.aspect, W, H);
  const box = b.focus ? plate.parts[b.focus] : undefined;
  const dimFor = (k: string) => (k === 'hook' ? 0.5 : k === 'question' || k === 'title' || k === 'callout' ? 0.55 : 0.68);
  if (!isPlateBeat(b)) return { ...prev, dim: dimFor(b.kind) };
  if (!box || b.kind === 'wide') return { fx: W / 2, fy: H / 2, z: 1.04, dim: b.kind === 'wide' ? 0.12 : 0 };
  const cx = r.x + (box[0] + box[2] / 2) * r.w;
  const cy = r.y + (box[1] + box[3] / 2) * r.h;
  const size = Math.max((box[2] * r.w) / W, (box[3] * r.h) / H);
  if (b.kind === 'zoom') return { fx: cx, fy: cy, z: Math.min(2.6, Math.max(1.35, 0.55 / Math.max(0.05, size))), dim: 0 };
  return { fx: W / 2 + (cx - W / 2) * 0.55, fy: H / 2 + (cy - H / 2) * 0.55, z: Math.min(1.5, Math.max(1.12, 0.8 / Math.max(0.1, size))), dim: 0.18 };
}

/** Keep the zoomed picture covering the whole frame. */
function clampCam(c: Cam, plate: SpecPlate, W: number, H: number, tx: number, ty: number): Cam {
  const r = coverRect(plate.aspect, W, H);
  const minFx = r.x + tx / c.z, maxFx = r.x + r.w - (W - tx) / c.z;
  const minFy = r.y + ty / c.z, maxFy = r.y + r.h - (H - ty) / c.z;
  return { ...c, fx: Math.min(Math.max(c.fx, minFx), Math.max(minFx, maxFx)), fy: Math.min(Math.max(c.fy, minFy), Math.max(minFy, maxFy)) };
}

const MOVE_S = 0.75;

/** The camera at time t (seconds) in a scene: eased from the previous beat's shot to the current one, with a slow drift. */
export function cameraAt(scene: SpecScene, plate: SpecPlate, t: number, W: number, H: number, target: { x: number; y: number }): Cam {
  let prev: Cam = { fx: W / 2, fy: H / 2, z: 1.04, dim: 0 };
  let cam = prev;
  for (const b of scene.beats) {
    const shot = clampCam(shotFor(b, plate, W, H, prev), plate, W, H, target.x, target.y);
    if (t < b.start) break;
    const k = interpolate(t, [b.start, b.start + MOVE_S], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    const drift = 1 + 0.025 * Math.min(1, Math.max(0, (t - b.start) / Math.max(1, b.end - b.start)));
    cam = { fx: prev.fx + (shot.fx - prev.fx) * k, fy: prev.fy + (shot.fy - prev.fy) * k, z: (prev.z + (shot.z - prev.z) * k) * drift, dim: prev.dim + (shot.dim - prev.dim) * k };
    prev = shot;
  }
  return cam;
}

/** A point of the picture (fractions) in screen pixels for a camera. */
export function toScreen(plate: SpecPlate, u: number, v: number, cam: Cam, W: number, H: number, target: { x: number; y: number }) {
  const r = coverRect(plate.aspect, W, H);
  return { x: (r.x + u * r.w - cam.fx) * cam.z + target.x, y: (r.y + v * r.h - cam.fy) * cam.z + target.y };
}

/** Where the camera centers what it looks at: the middle of the stage (above the captions). */
export const camTarget = (stage: { x: number; y: number; w: number; h: number }) => ({ x: stage.x + stage.w / 2, y: stage.y + stage.h * 0.5 });

/** The picture under a scene, moved by the camera. Rendered inside a Sequence that starts at the scene start. */
export const PlateLayer: React.FC<{ scene: SpecScene; plate: SpecPlate }> = ({ scene, plate }) => {
  const { stage, theme } = useLayout();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = scene.start + frame / fps;
  const target = camTarget(stage);
  const cam = cameraAt(scene, plate, t, W, H, target);
  const r = coverRect(plate.aspect, W, H);
  const fadeIn = interpolate(frame, [0, 10], [0, 1], clamp);
  const fadeOut = interpolate(t, [scene.end - 0.25, scene.end], [1, 0], clamp);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', opacity: Math.min(fadeIn, fadeOut) }}>
      <Img src={staticFile(plate.file)} style={{ position: 'absolute', left: (r.x - cam.fx) * cam.z + target.x, top: (r.y - cam.fy) * cam.z + target.y,
        width: r.w * cam.z, height: r.h * cam.z, maxWidth: 'none' }} />
      {/* Readability: darker toward the captions, and the dim level the beat asks for. */}
      <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(180deg, rgba(0,0,0,0.25) 0%, transparent 18%, transparent 55%, ${theme.bg1}e6 100%)` }} />
      <div style={{ position: 'absolute', inset: 0, background: theme.bg1, opacity: cam.dim }} />
    </div>
  );
};

/** Ring around a part, pulsing gently. */
const Ring: React.FC<{ x: number; y: number; w: number; h: number; color: string; delay: number }> = ({ x, y, w, h, color, delay }) => {
  const { u } = useLayout();
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
  const pulse = 1 + Math.sin((frame - delay) / 8) * 0.03;
  const rw = Math.max(70 * u, w * 1.15), rh = Math.max(70 * u, h * 1.15);
  return (
    <div style={{ position: 'absolute', left: x - rw / 2, top: y - rh / 2, width: rw, height: rh, borderRadius: '50%',
      border: `${5 * u}px solid ${color}`, boxShadow: `0 0 ${24 * u}px ${color}, inset 0 0 ${18 * u}px ${color}66`,
      transform: `scale(${p * pulse})`, opacity: p }} />
  );
};

/** The label card used by point and zoom. */
const Label: React.FC<{ b: SpecBeat; x: number; y: number; align: 'left' | 'right' | 'center'; delay: number; big?: boolean }> = ({ b, x, y, align, delay, big }) => {
  const { u, theme, stage } = useLayout();
  const frame = useCurrentFrame();
  const p = interpolate(frame - delay, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const text = b.heading ?? b.focus ?? '';
  const maxW = Math.min(stage.w * 0.62, 640 * u);
  const size = fit(text, maxW - 40 * u, 2, (big ? 66 : 54) * u);
  const tx = align === 'right' ? 0 : align === 'left' ? -100 : -50;
  return (
    <div style={{ position: 'absolute', left: x, top: y, transform: `translate(${tx}%, -50%) translateY(${(1 - p) * 24 * u}px)`, opacity: p, maxWidth: maxW,
      background: `${theme.bg1}d9`, border: `${2 * u}px solid ${theme.accent}`, borderRadius: 18 * u, padding: `${14 * u}px ${22 * u}px`,
      boxShadow: `0 ${12 * u}px ${40 * u}px rgba(0,0,0,0.45)`, textAlign: align === 'center' ? 'center' : 'left' }}>
      <div style={{ fontFamily: display, fontWeight: 900, fontSize: size, lineHeight: 1.05, color: theme.text }}>{text}</div>
      {b.sub && <div style={{ fontFamily: body, fontWeight: 600, fontSize: Math.min(36 * u, size * 0.62), color: theme.accent2, marginTop: 6 * u }}>{b.sub}</div>}
    </div>
  );
};

/** The overlay for a plate beat: an arrow and label (point), a label and ring (zoom), a title (wide). */
export const PlateBeat: React.FC<{ b: SpecBeat; scene: SpecScene; plate: SpecPlate }> = ({ b, scene, plate }) => {
  const { stage, u, theme, vertical } = useLayout();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = b.start + frame / fps;
  const target = camTarget(stage);
  const cam = cameraAt(scene, plate, t, W, H, target);
  const box = b.focus ? plate.parts[b.focus] : undefined;
  const settle = Math.round(MOVE_S * fps * 0.6);

  if (b.kind === 'wide' || !box) {
    const text = b.heading ?? '';
    if (!text) return null;
    const p = interpolate(frame, [4, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    return (
      <div style={{ position: 'absolute', left: stage.x, width: stage.w, top: stage.y + 10 * u, textAlign: 'center', opacity: p, transform: `translateY(${(1 - p) * -30 * u}px)` }}>
        <span style={{ display: 'inline-block', fontFamily: display, fontWeight: 900, fontSize: fit(text, stage.w * 0.9, 2, (vertical ? 84 : 76) * u), lineHeight: 1.05,
          color: theme.text, textShadow: `0 ${4 * u}px ${20 * u}px rgba(0,0,0,0.8), 0 0 ${4 * u}px rgba(0,0,0,0.9)` }}>{text}</span>
      </div>
    );
  }

  const c = toScreen(plate, box[0] + box[2] / 2, box[1] + box[3] / 2, cam, W, H, target);
  const bw = box[2] * coverW(plate, W, H) * cam.z, bh = box[3] * coverH(plate, W, H) * cam.z;

  if (b.kind === 'zoom') {
    return (
      <>
        <Ring x={c.x} y={c.y} w={bw} h={bh} color={theme.accent} delay={settle} />
        <Label b={b} x={stage.x + stage.w / 2} y={stage.y + stage.h - 40 * u} align="center" delay={settle + 4} big />
      </>
    );
  }

  // point: a dot on the part, a line that draws out to a label placed on the emptier side.
  const right = c.x < W / 2;
  const lx = Math.min(stage.x + stage.w - 20 * u, Math.max(stage.x + 20 * u, c.x + (right ? 1 : -1) * Math.min(stage.w * 0.28, 300 * u)));
  const ly = Math.min(stage.y + stage.h - 60 * u, Math.max(stage.y + 60 * u, c.y - (c.y > stage.y + stage.h * 0.5 ? 1 : -1) * stage.h * 0.18));
  const draw = interpolate(frame - settle, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const len = Math.hypot(lx - c.x, ly - c.y);
  const dot = interpolate(frame - settle + 4, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
  return (
    <>
      <Ring x={c.x} y={c.y} w={bw} h={bh} color={theme.accent} delay={settle} />
      <svg style={{ position: 'absolute', inset: 0, overflow: 'visible' }} width={W} height={H}>
        <line x1={c.x} y1={c.y} x2={lx} y2={ly} stroke={theme.accent} strokeWidth={5 * u} strokeLinecap="round"
          strokeDasharray={len} strokeDashoffset={len * (1 - draw)} style={{ filter: `drop-shadow(0 0 ${6 * u}px ${theme.accent})` }} />
        <circle cx={c.x} cy={c.y} r={12 * u * dot} fill={theme.accent} stroke={theme.text} strokeWidth={4 * u} />
      </svg>
      <Label b={b} x={lx} y={ly} align={right ? 'right' : 'left'} delay={settle + 8} />
    </>
  );
};

const coverW = (plate: SpecPlate, W: number, H: number) => coverRect(plate.aspect, W, H).w;
const coverH = (plate: SpecPlate, W: number, H: number) => coverRect(plate.aspect, W, H).h;
