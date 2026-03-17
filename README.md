# 🎵 Vocal Pitch Visualizer

A real-time browser-based tool that lets you sing along to a track and visually compare your pitch against the original. Load any audio file, enable your microphone, and watch your voice plotted live against the song's pitch curve.

---

## ✨ Features

- **Offline Pitch Analysis** — Automatically extracts the pitch track from any uploaded audio file (MP3, WAV, OGG) using a custom hybrid YIN-MPM detector.
- **Live Mic Input** — Captures your voice in real time through the Web Audio API and plots it as a smooth Catmull-Rom spline overlay.
- **Note Block Visualization** — The original pitch is segmented into note blocks with glide (meend) arcs, ornamental accents, and smart connectors between consecutive notes.
- **Inner Pitch Detail** — Each note block shows its internal pitch micro-movement (vibrato, oscillations) via a gradient-filled detail line.
- **Seekable Playback** — Full play/pause/stop controls and a clickable + draggable progress bar.
- **Logarithmic Frequency Scale** — The Y-axis maps C2–C6 on a log2 scale, matching how human pitch perception works.
- **Responsive Canvas** — The visualization automatically resizes with the browser window.

---

## 🗂️ Project Structure

```
PitchVisualizer/
├── index.html              # App shell, layout & controls UI
├── src/
│   ├── main.js             # App entry point, wires all modules together
│   ├── audioManager.js     # Web Audio API: file loading, playback, seek, mic capture
│   ├── pitchDetector.js    # Custom YIN-MPM pitch detection engine
│   ├── canvasRenderer.js   # Canvas 2D rendering: note blocks, glides, user pitch line
│   └── style.css           # All styling (dark theme, Outfit font, glassmorphism cards)
├── package.json
└── vite.config.js          # Vite dev/build config
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later recommended)
- A modern browser with Web Audio API support (Chrome, Edge, Firefox)

### Install & Run

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

Then open `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
```

The output will be in the `dist/` folder.

---

## 🎤 How to Use

1. **Load a Track** — Click **Select Track** and choose an MP3, WAV, or OGG file. The app will analyse the audio offline and draw the original pitch track on the canvas.
2. **Enable Microphone** — Click **Enable Mic** and grant browser permission. Your live vocal pitch will start appearing as a **cyan line** overlaid on the canvas.
3. **Play Along** — Hit **Play** to start the backing track. Sing along and watch your pitch (cyan) track the original (orange/green blocks).
4. **Seek** — Click or drag the progress bar to jump to any position.

---

## 🧠 Pitch Detection Algorithm

The detector (`pitchDetector.js`) implements a custom **hybrid YIN-MPM** algorithm:

| Step | Detail |
|------|--------|
| **Amplitude Normalization** | RMS-based normalization (up to 200× gain) so quiet voices are detected equally |
| **Hann Windowing** | Applied to each 1024-sample frame to reduce spectral leakage |
| **NSDF** | Normalized Square Difference Function (McLeod & Wyvill, 2005) for periodicity detection |
| **Peak Picking** | Key maxima are selected with a k-threshold of 0.5; frequencies >3000 Hz are rejected as noise |
| **Parabolic Interpolation** | Sub-sample frequency accuracy without FFT padding |
| **Clarity Score** | 0.0–1.0 confidence metric; low-clarity frames still output a frequency (never null) so the wave stays visible |
| **Median Filter** | 2-tap median smoother on the live stream; bypassed for offline analysis quality |

**Range supported:** 50 Hz – 3000 Hz (roughly C1–B7)

---

## 🎨 Visualizer Color Legend

| Color | Meaning |
|-------|---------|
| 🟠 **Orange** | Upcoming (unplayed) note block |
| 🟢 **Green** | Passed (played) note block |
| 🔵 **Cyan** | Your live vocal pitch |
| 🟡 **Yellow stripe** | Ornamental / grace-note accent |
| ╌ **Dashed line** | Melodic leap connector (>4 semitones) |
| **Bezier arc** | Smooth glide (meend) between close notes |

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Vite](https://vitejs.dev/) | Dev server & bundler |
| [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) | Audio decoding, playback, mic capture |
| [Canvas 2D API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) | All pitch visualization rendering |
| [Outfit (Google Fonts)](https://fonts.google.com/specimen/Outfit) | UI typography |

> No UI frameworks used — pure vanilla JS, HTML & CSS.

---

## 📄 License

This project is private. All rights reserved.
