# Explainer Agent

A command-line AI agent that turns a topic into a ready-to-publish motion explainer video for YouTube, Shorts, Instagram or TikTok.

```
topic ─► web research ─► 3 story angles ─► you pick / ask for changes ─► script + visual plan ─► you approve / ask for changes
      ─► voice ─► illustrations ─► motion video + thumbnail + titles/description/tags
```

Runs on Gemini through Vertex AI (the same Google Cloud project and service account as edbard). Videos render locally with Remotion.

## Run

```bash
npm start                       # asks for everything
npm start -- "why do cats purr" # topic up front
npm run resume                  # continue a saved video (pick from a list)
npm run render                  # re-render a saved video (after editing jobs/<id>/script.json)
npm run demo -- shorts neon     # preview the design with a sample script, no AI calls (frames land in jobs/_demo-*)
```

It asks:

| Question | Choices |
|---|---|
| Where will you publish it? | YouTube 16:9 1920x1080 · Shorts 9:16 · Reels 9:16 · IG feed 4:5 · IG square 1:1 · TikTok 9:16 |
| Length | defaults per platform (Shorts 50s, Reels 45s, YouTube 4 min) |
| Language, audience, tone | free text / menu |
| Model for research and writing | `gemini-4-argon` (default) · `gemini-3.8-flash` · `gemini-3.7-flash` — list set by `WRITER_MODELS` |
| Folder with your own images | a path, or `-` for none (defaults to `assets/images/` when it has pictures) |
| Look | midnight · neon · sunset · paper · **custom** (colors picked from your images) |
| Voice | 7 Gemini voices, or ElevenLabs if your key has credits |
| AI illustrations | on / off |

### Your own images

Point it at a folder of `.jpg` / `.png` / `.webp` images (up to 16, each under 7 MB): product shots, characters, places, brand art.
The vision model (`VISION_MODEL`) looks at each one, and then:

- the writer places them as full-screen picture beats wherever they fit the narration (with a slow Ken Burns move),
- up to 3 of them are sent to the image model as **style references**, so new AI illustrations match their look,
- the **custom** look builds the video's colors from them.

Logos and screenshots full of small text are recognized and kept off screen.

Then it researches with Google Search, shows **3 angles** (title, the exact opening line, flow, payoff). Type a number to pick, or type
what to change ("darker hook", "focus on the history"). Next it shows the **full script with every visual beat**: approve it, ask for
changes in plain words, rewrite it, or edit `script.json` yourself and reload. Changing only visuals reuses the recorded voice, and
pictures are reused when their prompt is unchanged.

After rendering you can also make the **same video in another format** (for example, the YouTube version, then a Reel).

## Logs and cost

Every AI call streams, and its line updates in place while it runs:

```
[  7m 25s] ⠙  1m 19s Writing the script and planning the visuals · writing · 14,210 in · ~3,480 out + 6,912 think 61 tok/s · $0.132 · run $0.31 ▸ scene 4: The Frequency
```

It shows whether the model is thinking or writing, tokens in/out/thinking (`~` while estimated, exact once Gemini reports them),
speed, the cost of this call, the total for the run, and what is being written right now. Each finished call leaves one line with
its exact tokens and cost, and the run ends with **cost by model**.

Prices (USD per 1M tokens) come from edbard's AI Models page: gemini-4-argon $2 / $10, gemini-3.8-flash $0.75 / $3.75,
gemini-3.7-flash $0.80 / $4. Edit `prices.json` to change them or to add the image and voice models (they show "no price" until
you do). Thinking tokens are billed as output.

**When an answer goes wrong:**
- **Broken JSON** (bad syntax or a missing field): `REPAIR_MODEL` (default gemini-3.8-flash) gets the broken answer and the errors and
  returns it fixed. That costs a fraction of writing it again. Only if the repair also fails does the writer try again.
- **A stuck model** (repeating itself, silent for 3 minutes, or over 6 minutes for one answer) is cut off and asked again from
  scratch, up to 4 times. The cut-off text is saved to `jobs/_last-runaway.txt` so you can see what happened.

Every step also prints what it is doing: the model and token counts for each AI call, web searches and sources, voice clips recorded and
seconds of audio, each picture drawn, and while rendering a live bar with percent, frames rendered and encoded, render speed
(fps and × realtime) and time left. A summary at the end shows the time per step and total AI usage. Everything is also written,
without colors, to `jobs/<id>/log.txt`.

## Output (`jobs/<id>/`)

- `out/<name>.mp4`: H.264 + AAC, ready to upload
- `out/thumbnail.png` (YouTube, 1280x720) or `out/cover.png` (vertical)
- `out/publish.md`: title options, description with chapters (YouTube), sources, tags, hashtags, pinned comment
- `log.txt`: the full run log
- `research.md`, `script.md`, `script.json`, `timing.json`: the working files

## How it keeps people watching

The writer prompts carry a retention playbook (`src/prompts.ts`), and a second "retention editor" pass rewrites the draft against it:

- **Hook in the first 3 seconds**: a bold claim, a specific number or a "you" question. No greeting or intro. The first frame is already
  a big animated title, with a bass hit.
- **Open loops**: the payoff is promised early and paid late, and the best fact sits in the last third.
- **The picture changes every 2-4 seconds**: each beat is a different visual type (stat counter, comparison, bars, timeline, steps,
  icon grid, question, callout, illustration) with a different entrance. Visuals land on the exact word that names them.
- **Big word-by-word captions** with the spoken word lit up, for people who watch muted.
- **Progress bar**, chapter tags and a sweep at each chapter change (long-form), whooshes and pops on visual changes.
- **Short-form**: one idea and an ending that loops back into the opening line.
- **Safe zones** per platform keep text out from under the Shorts/Reels/TikTok buttons and captions.

## Settings (`.env`)

| Key | What |
|---|---|
| `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `GOOGLE_APPLICATION_CREDENTIALS` | Vertex AI access (or set `GEMINI_API_KEY` instead) |
| `WRITER_MODEL`, `WRITER_MODELS` | default research/writing model and the list offered in the menu |
| `VISION_MODEL` | looks at your own images (default `gemini-3.8-flash`) |
| `IMAGE_MODEL` | illustrations and thumbnail background |
| `GEMINI_TTS_MODEL` | voice (`gemini-3.8-flash-tts`) |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE`, `ELEVENLABS_MODEL` | optional voice with exact word timing |
| `MAX_IMAGES` | most illustrations per video (default 6) |
| `MUSIC_VOLUME` | background music level (default 0.08) |

**Music:** put royalty-free tracks (`.mp3`/`.wav`) in `assets/music/`. One is picked at random and mixed quietly under the voice. With
none there, the video has voice and sound effects only.

## Layout

```
src/cli.ts            the interactive flow and resume
src/prompts.ts        retention playbook and the agent roles
src/steps/            research, options, script, voice, images, render, publish
video/                Remotion composition: Explainer.tsx (layout, captions, sound), Beats.tsx (each visual type), Thumbnail.tsx
scripts/demo.mts      design preview without AI
```

Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion license.
