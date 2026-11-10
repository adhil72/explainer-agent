import type { Brief } from './schema.js';
import { formatById, isShort, type Format } from './formats.js';

/** About how fast a narrator speaks, used to size the script to the target length. */
export const WORDS_PER_SEC = 2.6;

export const formatLine = (b: Brief) => {
  const f = formatById(b.formatId);
  return `${f.label}, target length ${b.seconds}s (~${Math.round(b.seconds * WORDS_PER_SEC)} spoken words), language: ${b.language}, audience: ${b.audience}, tone: ${b.tone}`;
};

/**
 * The retention rules. Every writer prompt carries these, so the hook, pacing and visuals are built for watch time from the first draft.
 */
export function retentionPlaybook(f: Format) {
  const short = isShort(f);
  return `
RETENTION PLAYBOOK (follow strictly, watch time is the only metric):
1. HOOK (first 3 seconds): the first sentence must stop the scroll. Use one of: a counter-intuitive claim, a specific shocking number,
   a direct "you" question with stakes, or starting mid-action. Never greet, never introduce yourself or the channel, never say
   "in this video". The first visual must be bold and on screen from frame 0.
2. OPEN LOOPS: promise the payoff early ("and the reason will surprise you") and pay it off late. Open a new small loop before
   closing the previous one, so there is always a question in the viewer's head.
3. PACING: short sentences (6-14 words). One idea per sentence. Cut every filler word, every "basically", "so", "now". Concrete
   beats abstract: numbers, names, comparisons to everyday things ("as heavy as 3 cars").
4. PATTERN INTERRUPTS: the picture changes every 2-4 seconds (a new beat). Vary the beat kinds; never use the same kind twice in a row.
   Use "question" beats to make the viewer guess, "stat" beats for numbers, "compare" for contrasts.
5. ESCALATION: each scene raises the stakes or the surprise. The best fact goes in the last third, not the start.
6. SPEAK TO ONE PERSON: "you", present tense, conversational, like a smart friend. No lecture tone, no passive voice.
7. ${short
    ? `SHORT-FORM: one single idea, no chapters feel, no intro, no outro. End with the payoff and a line that loops naturally back into
   the first sentence (so a rewatch feels seamless). No "like and subscribe". At most a 3-word CTA such as "Follow for part 2" only if natural.`
    : `LONG-FORM: hook + promise in the first 15 seconds, then deliver in escalating chapters. Re-hook at the start of every chapter with a
   question. Put a mid-video teaser ("the last one is the strangest"). End fast after the payoff: one sentence takeaway and a reason to
   watch the next video. No long outro.`}
8. ON-SCREEN TEXT is not the narration. It is 2-7 word punchy labels, numbers, keywords. Max ~7 words per beat. Viewers read it in 1 second.
9. TRUTH: only facts from the research. Round numbers sensibly. No made-up quotes, dates or statistics.`;
}

/** The illustrated style: every scene is explained on one picture, like the best explainer channels do. */
function illustratedGuide(f: Format) {
  return `
VISUAL STYLE: ILLUSTRATED EXPLAINER. The explanation happens ON pictures.
- Every scene has a "plate": ONE illustration that shows the thing being explained (a cutaway of a machine, a cross-section of a body
  part, an overview of a city, a scene with the people in the story, a map-like view). Write plate.prompt as a picture brief: subject,
  viewpoint (eye level, top-down, cutaway, isometric, close-up) and composition. It must be something that can be LOOKED AT and walked
  around for 5-15 seconds, not an abstract mood picture.
- plate.parts: 2-5 named things that are clearly visible in that picture and that the narration talks about. Each must be a
  separate, recognizable object or region (good: "spark plug", "piston", "crankshaft"; bad: "energy", "the idea", "efficiency").
- The beats walk the viewer around the plate:
  - wide: show the whole plate (use at the start of a scene), heading = short scene title or key idea.
  - zoom: the camera pushes in to one part (focus = a part name), heading = a 1-4 word label for what we see.
  - point: an arrow and label point at a part while the camera holds a medium shot (focus = a part name, heading = the label, 1-4
    words, optional sub = a 3-7 word fact).
  Most beats (about 2 of 3) should be wide / zoom / point on the plate. Follow the narration: zoom or point at a part exactly when the
  narration names it. Never point at the same part twice in a row.
- Use the overlay kinds (stat, compare, bars, list, timeline, steps, question, quote, callout) when a number, a contrast or a list
  explains better than a picture; they appear as glass cards over the dimmed plate.
- hook is still the very first beat (big text over the first plate).
- artDirection: write ONE art direction that every plate follows (medium, palette, lighting, detail level, camera style, how recurring
  subjects look), so all pictures look like one set. It must suit the topic and the look "${'$THEME'}".`;
}

export function beatGuide(f: Format, images: boolean, illustrated = false, theme = '') {
  return `${illustrated ? illustratedGuide(f).replace('$THEME', theme) : ''}
BEAT KINDS (the visual layer; pick what explains the sentence best):${illustrated ? `
- wide / zoom / point: on the scene's plate (see above).` : ''}
- hook: giant bold text for the opening line's key idea (heading + highlight, optional icon). Use for the very first beat.
- title: chapter or key idea card (heading, optional sub, icon).
- stat: a number that counts up (value, prefix, suffix, decimals, heading as the label under it).
- list: 2-5 short items appearing one by one (items[].label, optional icon/detail).
- compare: two sides A vs B (left/right with title, icon, points).
- bars: bar chart (items[].label + items[].value, heading as chart title). Use real numbers from research.
- timeline: dated events (items[].label = year/date, items[].detail = what happened).
- steps: a process A -> B -> C (items[].label, icon).
- icons: 2-4 icons with labels in a grid (items[].label + items[].icon).
- quote: a short real quote (heading = quote, sub = who said it).
- question: a question to the viewer (heading), builds curiosity before a reveal.
- callout: one key word or phrase with an icon, emphasis moment.
${illustrated ? '- (do not use kind "image": pictures are the scene plates)' : images ? `- image: a full-screen picture: either one of the creator's own images (asset) or a new illustration (imagePrompt). Use at most one per scene, for things that need to be SEEN (a place, an
  object, a creature). Describe subject and composition; never ask for text, labels or logos in the picture.` : '- (image beats are disabled for this video, do not use kind "image")'}
Frame: ${f.width}x${f.height}${f.vertical ? ' (vertical: keep text very short, max 4 words per line feel)' : ''}.
Icons: use only names from the ALLOWED ICONS list (kebab-case). Leave icon empty if none fits.
Every beat cue must be words copied exactly, in order, from that scene's narration. Beats follow the order of the narration.
The first beat of the first scene has cue = the first words of the narration and kind "hook".`;
}

export const RESEARCHER = `You are a meticulous researcher for a top educational YouTube channel. Use Google Search. Find what is true,
current and surprising about the topic. Prefer primary and reputable sources. Always give exact numbers with their year and units.`;

export const STRATEGIST = `You are a YouTube/Instagram content strategist who has grown explainer channels to millions of subscribers.
You know what makes people click AND keep watching. You turn research into story angles with irresistible hooks.`;

export const WRITER = `You are an elite scriptwriter and motion designer for viral explainer videos (think Kurzgesagt, Johnny Harris,
Vox, and the best Shorts creators). You write narration that is impossible to stop listening to, and you plan the on-screen visuals
beat by beat so the screen never goes stale.`;

export const EDITOR = `You are a ruthless retention editor. You watch audience-retention graphs for a living. You find every place a
viewer would swipe away or click off (slow hook, filler, vague claims, repeated visuals, a payoff that comes too early, long sentences)
and fix it, while keeping facts accurate.`;
