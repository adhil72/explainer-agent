import React from 'react';
import { Composition, Still } from 'remotion';
import { Explainer } from './Explainer';
import { Thumbnail } from './Thumbnail';
import type { ThumbSpec, VideoSpec } from './spec';

const emptySpec: VideoSpec = {
  width: 1080, height: 1920, fps: 30, durationInFrames: 90, vertical: true, safe: { top: 0.1, bottom: 0.2, left: 0.06, right: 0.12 },
  theme: 'midnight', title: 'Preview', showChapters: false, scenes: [], words: [], voice: '', musicVolume: 0, sfx: false,
};
const emptyThumb: ThumbSpec = { width: 1280, height: 720, theme: 'midnight', text: 'Preview' };

export const Root: React.FC = () => (
  <>
    <Composition
      id="Explainer"
      component={Explainer as any}
      defaultProps={{ spec: emptySpec }}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={90}
      calculateMetadata={({ props }: { props: { spec: VideoSpec } }) => ({
        width: props.spec.width, height: props.spec.height, fps: props.spec.fps, durationInFrames: Math.max(1, props.spec.durationInFrames),
      })}
    />
    <Still
      id="Thumbnail"
      component={Thumbnail as any}
      defaultProps={{ spec: emptyThumb }}
      width={1280}
      height={720}
      calculateMetadata={({ props }: { props: { spec: ThumbSpec } }) => ({ width: props.spec.width, height: props.spec.height })}
    />
  </>
);
