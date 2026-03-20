# VOCAL Pitch Visualiser — Audio Processing Specifications

---

## Overview

The audio processing pipeline has three major parts that work in sequence:

1. **Vocal Separation** — split the uploaded song into vocals and instrumental
2. **Singer Pitch Analysis** — analyse the vocals track to generate the reference pitch map
3. **Live User Recording** — capture the user's voice in real time and detect pitch frame by frame

---

## Part 1 — Audio Input

The user has two ways to feed the audio into the app. Both paths must end up with the same two things in React state: `vocalsAudio` and `instrumentalAudio`. Everything downstream (pitch analysis, playback) is identical regardless of which path was used.

---

### Option A — YouTube Link

The user pastes a YouTube link into the app. The Python backend downloads the full song from YouTube, runs the separation script on it, and returns the vocals and instrumental back to React.

**Python Backend (`backend/`)**

Folder structure:
```
backend/
  main.py          ← FastAPI server (new file to create)
  separate.py      ← existing separation script (do not modify)
  outputs/         ← directory where separated files are saved
```

FastAPI server requirements (`main.py`):
- Endpoint: `POST /separate-from-url`
- Accepts a JSON body with a single field: `{ "url": "<youtube link>" }`
- Uses **`yt-dlp`** (Python library) to download the audio from the YouTube URL as a wav or mp3 file
- Passes the downloaded file into `separate.py` which outputs vocals + instrumental
- Returns both files as **base64 encoded strings in a JSON response**
- **CORS must be enabled** for `http://localhost:3000`
- Server runs on `http://localhost:8000`

Install yt-dlp: `pip install yt-dlp`

Example response shape:
```json
{
  "vocals": "<base64 encoded audio string>",
  "instrumental": "<base64 encoded audio string>",
  "format": "wav"
}
```

React frontend flow for Option A:
1. User pastes a YouTube link into a text input field in the UI
2. React sends a POST request to `http://localhost:8000/separate-from-url` with `{ "url": "<link>" }` as JSON body
3. A **loading state** is shown — this will take longer than Option B (download + separation combined)
4. On response, React decodes both base64 strings into audio blobs and stores them in state
5. Song card updates to `"Ready"` status

---

### Option B — Upload Both Files Directly

The user already has both files downloaded on their device — the vocals file and the instrumental file separately. They upload them directly into the app. No Python backend is involved at all for this path.

React frontend flow for Option B:
1. The UI shows **two separate file upload inputs**:
   - `"Upload vocals"` — accepts the singer's isolated voice file
   - `"Upload instrumental"` — accepts the backing track file
2. Both inputs accept common audio formats: `mp3`, `wav`, `m4a`, `ogg`
3. As soon as both files are selected, React reads them directly as audio blobs using the browser's `FileReader` API — no server call needed
4. Stores them directly in state as `vocalsAudio` and `instrumentalAudio`
5. Song card updates to `"Ready"` status immediately

---

### UI — Letting the User Choose Between Options

The song upload area in the UI should present both options clearly. Suggested layout:
- A **text input + submit button** at the top for the YouTube link (Option A)
- A visual divider with the word `"or"` between the two options
- Two **file upload buttons** below for direct file upload (Option B)
- Both options sit inside the song card area before a track is loaded
- Once either option completes successfully, the song card collapses into the compact track display (title, artist, duration, Ready pill) and the upload UI is hidden

---

### Shared Result (Both Options)

Regardless of which option the user chose, after completion React state holds:
- `vocalsAudio` — audio blob of the singer's isolated vocals
- `instrumentalAudio` — audio blob of the backing instrumental track

Everything from Part 2 onwards uses these two values identically.

---

## Part 2 — Singer Pitch Analysis

### What it does
After separation, the app analyses the vocals track offline (not in real time) to generate a complete pitch map of the singer across the full song. This pitch map is what gets drawn as the **white reference line and phrase blocks** on the pitch canvas.

### Library
**`pitchy`** — a JavaScript library using the McLeod Pitch Method (MPM) for accurate vocal pitch detection.

Install: `npm install pitchy`

### How it works
1. Decode `vocalsAudio` blob using Web Audio API's `AudioContext.decodeAudioData()` — converts compressed audio (mp3/wav) into raw PCM float data
2. Extract the raw samples using `getChannelData(0)` — returns a `Float32Array` of the entire song
3. Slide a window across the full array using these parameters:
   - **Buffer size:** `2048` samples per frame
   - **Hop size:** `512` samples (step between frames)
   - **Sample rate:** `44100` Hz
   - This gives a time resolution of ~11ms between readings — fine enough to capture ornaments like murki, harkat, meend, and vibrato naturally
4. For each frame, feed the buffer into `pitchy`'s `PitchDetector.findPitch()`:
   - Returns `[frequency, clarity]`
   - **Clarity threshold:** `> 0.9` — below this is treated as silence or noise and skipped
   - **Vocal frequency range:** `80 Hz – 1200 Hz` — readings outside this range are discarded
5. For each valid frame, record `{ time, frequency }` where `time = (frameIndex * hopSize) / sampleRate`
6. The result is a complete array of `{ time, frequency }` objects covering the full song — this is the **singer's pitch map**

### Important note on ornaments
Pitchy detects raw frequency every ~11ms with no knowledge of musical ornaments. This means:
- **Meend (glide)** — detected as a smooth frequency slide, draws as a natural curve on canvas
- **Vibrato** — detected as oscillating frequencies, draws as a natural wave
- **Murki / Harkat** — rapid oscillations detected frame by frame, draw as tight rapid curves
- **Gamak** — wide oscillations detected cleanly

No ornament recognition or labelling is needed or wanted. The raw pitch data is plotted as-is so the user sees the natural shape of every phrase and ornament visually.

---

## Part 3 — Live User Recording

### What happens when the user hits Record
1. The **instrumental track starts playing** through the speakers immediately — user hears the backing music and sings along (karaoke style)
2. The **microphone opens** simultaneously using `navigator.mediaDevices.getUserMedia({ audio: true })`
3. A **timer starts** at `t = 0` — this is the shared X-axis reference for both the singer's pre-drawn line and the user's live line
4. Pitch detection runs in real time on the microphone input
5. The user's orange pitch line grows left to right on the canvas in sync with the timer
6. When the user hits Stop — instrumental stops, mic closes, review screen appears

### Microphone Capture Architecture
- Use **Web Audio API** `AudioContext` to connect the mic stream
- Use **`AudioWorkletNode`** (not the deprecated `ScriptProcessorNode`) for real-time audio processing — runs off the main thread so the UI never stutters
- The worklet fires every ~23ms, providing a fresh buffer of raw audio samples
- Each buffer is fed into `pitchy` → returns `[frequency, clarity]`
- Same thresholds as singer analysis: clarity `> 0.9`, frequency `80–1200 Hz`
- Valid readings are immediately plotted on the canvas as the orange line

### Time Alignment
- The instrumental track and the mic timer must start at exactly the same moment (when Record is pressed)
- The X position of each detected pitch point is calculated as:
  ```
  xPosition = (currentTime / totalDuration) * canvasWidth
  ```
- This ensures the user's orange line stays in sync with the singer's pre-drawn white reference line

---

## Frequency to Canvas Coordinate Mapping

This is the bridge between audio data and the visual canvas. Applies to both the singer's pitch map and the user's live pitch.

### Step 1 — Frequency (Hz) to MIDI note number
```
midiNote = 12 * log2(frequency / 440) + 69
```
Examples: A4 = 69, C4 = 60, C5 = 72

### Step 2 — MIDI note to Y position on canvas
Canvas displays notes from **C4 (MIDI 60) at the bottom** to **C5 (MIDI 72) at the top**:
```
yPosition = canvasHeight - ((midiNote - 60) / 12) * canvasHeight
```
- Notes below C4 are clamped to the bottom edge
- Notes above C5 are clamped to the top edge

### Step 3 — Time to X position
```
xPosition = (currentTime / totalDuration) * canvasWidth
```

---

## Complete Data Flow

```
User chooses input method
        ↓
┌─────────────────────────────┬─────────────────────────────────┐
│ Option A — YouTube link     │ Option B — Upload both files    │
│                             │                                 │
│ React sends URL →           │ User selects vocals file        │
│ FastAPI (localhost:8000/    │ + instrumental file             │
│ separate-from-url)          │                                 │
│         ↓                   │         ↓                       │
│ yt-dlp downloads audio      │ FileReader reads both files     │
│ separate.py splits it       │ directly in browser             │
│ returns base64 JSON         │ no server call needed           │
└─────────────────────────────┴─────────────────────────────────┘
        ↓
Both paths → vocalsAudio + instrumentalAudio stored in React state
        ↓
Pitchy analyses vocals offline
→ generates singer's pitch map [ { time, frequency }, ... ]
→ draws white reference phrases on canvas
        ↓
User hits Record
→ instrumental plays through speakers
→ mic opens (getUserMedia)
→ AudioWorkletNode fires every ~23ms
→ pitchy detects live frequency
→ orange line grows on canvas in real time
        ↓
User hits Stop
→ instrumental stops, mic closes
→ full user pitch map is complete
→ review screen renders
→ match score calculated
→ accuracy graph populated
```

---

## Key Parameters Reference

| Parameter | Value |
|---|---|
| Pitch detection library | `pitchy` (McLeod Pitch Method) |
| Buffer size | `2048` samples |
| Hop size | `512` samples |
| Sample rate | `44100` Hz |
| Time resolution | ~11ms per frame |
| Clarity threshold | `> 0.9` |
| Vocal frequency range | `80 Hz – 1200 Hz` |
| Canvas note range | C4 (bottom) to C5 (top) |
| Python server port | `8000` |
| React app port | `3000` |
| CORS origin allowed | `http://localhost:3000` |
| Real-time audio node | `AudioWorkletNode` |
| YouTube download library | `yt-dlp` |
| YouTube endpoint | `POST /separate-from-url` |
| YouTube request body | `{ "url": "<youtube link>" }` |
| Direct upload — state keys | `vocalsAudio`, `instrumentalAudio` |
| Accepted audio formats | `mp3`, `wav`, `m4a`, `ogg` |

---

## What to Tell Opus When Building

### For the Python backend (Option A — YouTube link):
*"I have a standalone Python script called `separate.py` that takes an audio file and outputs two files — vocals and instrumental. Wrap it in a FastAPI server in `main.py` with a POST endpoint `/separate-from-url` that accepts a JSON body with a single field `url` containing a YouTube link. Use `yt-dlp` to download the audio from that URL, pass the downloaded file into `separate.py`, and return both output files as base64 encoded strings in a JSON response with keys `vocals`, `instrumental`, and `format`. Enable CORS for `http://localhost:3000`. Server runs on port 8000. Do not modify `separate.py`."*

### For the React audio input UI:
*"The song upload area must support two options. Option A: a text input where the user pastes a YouTube link, with a submit button that sends a POST request to `http://localhost:8000/separate-from-url` with `{ url }` as a JSON body, shows a loading state while waiting, then stores the returned base64-decoded vocals and instrumental as audio blobs in state. Option B: two separate file upload inputs — one for vocals and one for instrumental — that read the files directly as audio blobs using FileReader with no server call. Both options must result in the same state shape: `vocalsAudio` and `instrumentalAudio`. Once either option completes, hide the upload UI and show the song card in its compact ready state."*

### For the React audio pipeline:
*"Use pitchy for pitch detection and Web Audio API for both file decoding and microphone capture. Use AudioWorkletNode for real-time processing. Buffer size 2048, hop size 512, sample rate 44100 Hz. Clarity threshold 0.9, vocal frequency range 80–1200 Hz. Convert frequency to MIDI using `12 * log2(f/440) + 69`, map MIDI to canvas Y position over a C4–C5 range. Map time to canvas X position as `(currentTime / totalDuration) * canvasWidth`. When Record is pressed, start the instrumental audio and the mic simultaneously using the same timer as the X-axis reference."*
