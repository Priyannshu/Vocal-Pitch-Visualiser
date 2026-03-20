# VOCAL Pitch Visualiser — UI Specifications

---

## Overall App Shell

- Background color of the entire app shell: `#0d0d10` (near-black dark theme)
- Border radius on the main container: `12px`
- Padding inside the shell: `1.5rem`
- All text defaults to white (`#fff`) on the dark background
- No gradients, no glow effects, no drop shadows anywhere in the UI — flat design only

---

## Top Bar

- Sits at the very top of the app shell
- Left side: app name label — `"VOCAL — pitch visualiser"` in `13px`, `font-weight: 500`, uppercase, letter-spacing `0.12em`, color `#555`
- Right side: a pill-shaped **Match Score** badge
  - Background: `#1a1a22`, border: `0.5px solid #2a2a35`, border-radius: `20px`, padding: `4px 14px`
  - Label text: `"Match score"` in `13px`, color `#888`
  - Score value (e.g. `62%`) in `15px`, `font-weight: 500`, color `#f97316` (orange)
  - Score is computed and displayed only after the recording session ends

---

## Pitch Canvas (Core Visualiser)

The pitch canvas is the heart of the UI. It is a `<canvas>` element used in both the **live recording mode** and the **post-recording review mode**.

### Canvas Container
- Background: `#0a0a0d`
- Border: `0.5px solid #1e1e28`
- Border radius: `8px`
- Height: `280px`, width: `100%`
- Overflow: hidden

### Note Grid (Y-Axis)
- 8 horizontal pitch reference lines spanning the full width of the canvas
- Notes displayed (top to bottom): `C5, B4, A4, G4, F4, E4, D4, C4`
- Each grid line: `0.5px` stroke, color `rgba(255,255,255,0.045)`, dashed pattern `[3, 6]`
- Note labels rendered to the left of the canvas (inside a `44px` left margin)
  - Font size: `10px`, color: `rgba(255,255,255,0.22)`, text-align: right
- Left offset for plot area: `44px` (reserved for note labels); right offset: `12px`; top/bottom: `12px`

### Singer's Reference Phrases (White Blocks)
- Each phrase is a **rounded rectangle zone** representing the pitch range the original singer holds
- Zone fill: `rgba(239,68,68,0.06)` (very faint red tint)
- Zone border: `0.75px solid rgba(239,68,68,0.25)`, border-radius: `3px`
- Zone half-height: `5.5%` of the plot height above and below the center pitch line
- Inside each zone, a **solid white horizontal line** runs from start to end of the phrase
  - Stroke: `rgba(255,255,255,0.70)`, line width: `1.5px`
  - This line represents the exact target pitch center

### Connections Between Singer's Phrases
- When two consecutive phrases are **continuous** (no breath gap between them), they are connected by a **solid bezier curve**
- The curve starts at the exit point (right end) of the first phrase's center line and ends at the entry point (left end) of the next phrase's center line
- Control points: both set to the horizontal midpoint between the two phrases, one at `y1` and one at `y2`, creating a smooth S-curve
- Curve style: `rgba(255,255,255,0.20)` stroke, `1px` line width, **no dashes** (fully solid)
- When there is a clear breath gap between two phrases, **no connection is drawn**

### User's Sung Pitch Line (Orange)
- Rendered as a **single smooth continuous line** using quadratic bezier interpolation between detected pitch points
- Color: `#f97316` (orange), line width: `2px`, `lineJoin: round`, `lineCap: round`
- The smoothing algorithm uses midpoint averaging between consecutive points so that rapid ornamentations (murki, harkat, meend, etc.) appear as natural fluid curves rather than rigid segments
- **No dot markers** at individual pitch points — the line itself conveys all the information
- During live recording, the line grows from left to right in real time as the user sings

---

## Live Recording Mode vs Review Mode (Same Canvas)

### Live Recording Mode
- The canvas shows the current window of time (scrolling or fixed window)
- A vertical **playhead line** is drawn on the canvas
  - Position: advances with playback time
  - Color: `rgba(249,115,22,0.45)` (semi-transparent orange), line width: `1px`, solid (no dash)
  - A small filled circle at the top of the playhead: radius `3px`, fill `#f97316`
- Only the portion of the performance recorded so far is rendered

### Post-Recording Review Mode
- After the recording ends, the **entire performance** is laid out across the full canvas width from start to finish — no playhead
- The singer's all phrases and the user's complete pitch line are both visible simultaneously across the whole timeline
- **Section dividers**: subtle vertical lines at equal intervals dividing the canvas into sections (Verse 1, Chorus, Verse 2, Bridge, Outro)
  - Color: `rgba(255,255,255,0.06)`, line width: `0.5px`, solid
- Section labels sit **below the canvas** in a strip, one label per section, centered in its column
  - Font size: `10px`, color: `#333`, background: `#1a1a22`, padding: `6px 0`
  - Separated by `0.5px solid #1a1a22` vertical borders between each label cell

---

## Legend

- Sits directly below the pitch canvas (or below the section label strip in review mode)
- Two items displayed horizontally with `1.5rem` gap:
  1. A `24px × 2px` white line (`rgba(255,255,255,0.65)`) + label `"Reference singer"`
  2. A `24px × 2px` orange line (`#f97316`) + label `"Your voice"`
- Label font size: `12px`, color: `#666`

---

## Controls

- Three buttons in a horizontal row with `10px` gap:
  1. **Upload vocals** — background `#1a1a22`, border `0.5px solid #2a2a35`, text color `#ccc`, label: `"↑ Upload vocals"`
  2. **Record** — background `#ef4444` (red), text color `#fff`, label: `"● Record"`
     - When recording is active, label changes to `"■ Stop"` and background darkens to `#7f1d1d`
  3. **Play back** — background `#1a1a22`, border `0.5px solid #2a2a35`, text color `#ccc`, label: `"▶ Play back"`
- All buttons: `font-size: 13px`, `font-weight: 500`, `border-radius: 6px`, `padding: 7px 16px`

---

## Timeline Scrubber

- A thin `3px` horizontal track, background `#1e1e28`, border-radius `2px`
- A filled orange portion showing how far through the recording the playhead is
  - Fill color: `#f97316`, animates in width as playback progresses
- A circular dot at the leading edge of the fill: `10px × 10px`, border-radius `50%`, color `#f97316`
- Time labels below the track: start time on left, current time in center, total duration on right
  - Font size: `10px`, color: `#333`

---

## Accuracy Review Section (Post-Recording Only)

- Shown only after recording ends, below the controls and timeline
- Displays a **line graph** of pitch accuracy over the full duration of the performance
- X-axis: full timeline (timestamps matching the recording duration)
- Y-axis: pitch accuracy `0%` to `100%`
- The line is a smooth curve (tension ~`0.45`) in orange (`#f97316`)
- A very faint orange fill under the line (gradient from `rgba(249,115,22,0.18)` at top to transparent at bottom)
- Grid lines: `rgba(255,255,255,0.04)`, `0.5px`
- Axis tick labels: `10px`, color `#444`
- Y-axis ticks: `0%, 25%, 50%, 75%, 100%`
- X-axis ticks: auto-skipped to avoid overlap, max ~8 visible labels
- **No Chart.js default legend** — replaced by two summary pills at the top right:
  - `"Avg XX%"` in orange
  - `"Peak XX%"` in green (`#22c55e`)
- Section labels (Verse 1, Chorus, etc.) sit below the X-axis aligned to their time ranges, same style as the review canvas section labels
- Tooltip on hover: dark background `#1a1a22`, border `0.5px solid #2a2a35`, body text in orange showing `"XX% on pitch"`
- Chart container background: `#0a0a0d`, border `0.5px solid #1e1e28`, border-radius `8px`, padding `1rem 1.25rem`

---

## Dashboard State 1 — Before / During Performance (Live Screen)

This is what the user sees when they first open the app or are actively recording. The layout from top to bottom is:

1. **Navbar** — VOCAL logo on the left, a genre tag pill (e.g. `"Bollywood"`) and user avatar circle on the right
2. **Song card** — shows the uploaded reference track with a music icon thumbnail, song title, artist name, album and duration metadata, and a `"Ready"` status pill on the right. Background `#111116`, border `0.5px solid #1e1e28`, border-radius `10px`
3. **Pitch canvas** — in live mode, the canvas scrolls or fills left-to-right as the user sings. The singer's reference phrases are pre-drawn across the full timeline. The user's orange pitch line grows in real time from left to right as pitch is detected. A vertical orange playhead advances across the canvas in sync with playback
4. **Legend** — reference singer (white line) and your voice (orange line), directly below the canvas
5. **Controls row** — Upload, Record (red), Play back buttons in a horizontal row
6. **Timeline scrubber** — thin track that fills orange as the song progresses, with a dot at the leading edge and time labels (start / current / total) below
7. **No accuracy graph** — the accuracy section is completely hidden during live mode; it only appears after recording ends
8. **No stat cards** — match score and best section cards are hidden; they appear only post-performance
9. **Top bar match score pill** — shows `"—"` or is hidden entirely during recording; it populates only after the session ends

---

## Dashboard State 2 — After Performance (Review Screen)

This is what the user sees immediately after the recording ends. The layout from top to bottom is:

1. **Navbar** — same as live screen; VOCAL logo, genre tag, avatar
2. **Song card** — same as live screen, status pill updates to `"Done"` or `"Reviewed"`
3. **Two stat cards** in a 2-column grid:
   - Left card: `"Match score"` label + the overall percentage in orange (e.g. `62%`) + sub-label `"after full run"`
   - Right card: `"Best section"` label + the highest section accuracy in green (`#22c55e`) (e.g. `78%`) + sub-label showing the section name (e.g. `"Verse 1"`)
   - Card background: `#111116`, border: `0.5px solid #1e1e28`, border-radius: `8px`, padding: `0.85rem 1rem`
4. **Section heading** — small uppercase label `"Pitch canvas — review"` in `11px`, color `#444`, above the canvas
5. **Pitch canvas in review mode** — the entire performance is laid out across the full width, no playhead. Singer's phrases and the user's complete orange line are both fully visible. Subtle vertical section dividers split the canvas into 5 equal columns
6. **Section label strip** — directly below the canvas, 5 cells (Verse 1, Chorus, Verse 2, Bridge, Outro), each centered, `10px`, color `#2a2a35`
7. **Legend** — same as live screen
8. **Controls row** — same buttons (Upload, Record, Play back); Record now functions as "Try again"
9. **Timeline scrubber** — fully filled orange (100% width) indicating the complete performance has been captured. Dot sits at the far right end
10. **Divider line** — `0.5px solid #1a1a22` horizontal rule separating the canvas area from the accuracy graph below
11. **Accuracy over time graph** — line graph showing pitch accuracy across the full song duration. Contains avg/peak pills at top right, smooth orange curve with faint fill underneath, section labels below the X-axis. Full spec in the Accuracy Review Section above

---



| Element | Color |
|---|---|
| App shell background | `#0d0d10` |
| Canvas / chart background | `#0a0a0d` |
| Surface / button background | `#1a1a22` |
| Borders | `#1e1e28` to `#2a2a35` |
| Singer phrase zone fill | `rgba(239,68,68,0.06)` |
| Singer phrase zone border | `rgba(239,68,68,0.25)` |
| Singer center pitch line | `rgba(255,255,255,0.70)` |
| Phrase connection curve | `rgba(255,255,255,0.20)` |
| User pitch line | `#f97316` |
| Record button | `#ef4444` |
| Recording active button | `#7f1d1d` |
| Match score / accuracy value | `#f97316` |
| Peak accuracy value | `#22c55e` |
| Note labels / axis text | `rgba(255,255,255,0.22)` / `#444` |
| Section dividers | `rgba(255,255,255,0.06)` |
| Playhead line | `rgba(249,115,22,0.45)` |
| Playhead dot | `#f97316` |
