/** Where the video will be published. Each preset sets the frame, a sensible length and the safe zone the platform's buttons cover. */
export interface Format {
  id: string;
  label: string;
  platform: 'youtube' | 'instagram' | 'tiktok';
  width: number;
  height: number;
  /** Image aspect the picture model is asked for. */
  aspect: '16:9' | '9:16' | '1:1' | '3:4';
  /** Suggested length range in seconds. */
  minSec: number;
  maxSec: number;
  defaultSec: number;
  /** Margins (fraction of the frame) kept clear of text: the platform draws its own UI there. */
  safe: { top: number; bottom: number; left: number; right: number };
  vertical: boolean;
}

export const FORMATS: Format[] = [
  { id: 'yt', label: 'YouTube video  (16:9, 1920x1080)', platform: 'youtube', width: 1920, height: 1080, aspect: '16:9',
    minSec: 60, maxSec: 900, defaultSec: 240, safe: { top: 0.06, bottom: 0.08, left: 0.05, right: 0.05 }, vertical: false },
  { id: 'shorts', label: 'YouTube Shorts  (9:16, 1080x1920)', platform: 'youtube', width: 1080, height: 1920, aspect: '9:16',
    minSec: 15, maxSec: 180, defaultSec: 50, safe: { top: 0.12, bottom: 0.22, left: 0.06, right: 0.14 }, vertical: true },
  { id: 'reels', label: 'Instagram Reels (9:16, 1080x1920)', platform: 'instagram', width: 1080, height: 1920, aspect: '9:16',
    minSec: 15, maxSec: 180, defaultSec: 45, safe: { top: 0.12, bottom: 0.24, left: 0.06, right: 0.14 }, vertical: true },
  { id: 'ig-portrait', label: 'Instagram feed portrait (4:5, 1080x1350)', platform: 'instagram', width: 1080, height: 1350, aspect: '3:4',
    minSec: 15, maxSec: 90, defaultSec: 45, safe: { top: 0.06, bottom: 0.1, left: 0.06, right: 0.06 }, vertical: true },
  { id: 'ig-square', label: 'Instagram feed square (1:1, 1080x1080)', platform: 'instagram', width: 1080, height: 1080, aspect: '1:1',
    minSec: 15, maxSec: 90, defaultSec: 45, safe: { top: 0.06, bottom: 0.1, left: 0.06, right: 0.06 }, vertical: false },
  { id: 'tiktok', label: 'TikTok (9:16, 1080x1920)', platform: 'tiktok', width: 1080, height: 1920, aspect: '9:16',
    minSec: 15, maxSec: 180, defaultSec: 45, safe: { top: 0.12, bottom: 0.24, left: 0.06, right: 0.16 }, vertical: true },
];

export const formatById = (id: string) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];
/** Short-form: one idea, no chapters, loopable ending. */
export const isShort = (f: Format) => f.id !== 'yt';
