🎵 Vocal Pitch Visualizer
A real-time, browser-based tool that lets you sing along to any audio track and visually compare your pitch against the original. Load a pure-vocal file, enable your microphone, and watch your voice plotted live against the song's pitch curve — all with no backend, no frameworks, and no internet connection required after load.

✨ Features

Offline Pitch Analysis — Automatically extracts the pitch track from any uploaded audio file (MP3, WAV, OGG) using a custom hybrid YIN-MPM detector built from scratch.
Live Mic Input — Captures your voice in real time through the Web Audio API and plots it as a smooth Catmull-Rom spline overlay.
Note Block Visualization — The original pitch is segmented into note blocks with glide (meend) arcs, ornamental accents, and smart connectors between consecutive notes.
Inner Pitch Detail — Each note block shows its internal pitch micro-movement (vibrato, oscillations) via a gradient-filled detail line.
Seekable Playback — Full play / pause / stop controls plus a clickable and draggable progress bar.
Logarithmic Frequency Scale — The Y-axis maps C2–C6 on a log₂ scale, matching how human pitch perception works.
Responsive Canvas — The visualization automatically resizes with the browser window.
Zero UI Framework Dependency — Pure vanilla JS, HTML, and CSS.



🚀 Getting Started
Prerequisites
RequirementVersionNode.jsv18.0.0 or laternpmv9.0.0 or laterModern browserChrome 66+, Edge 79+, or Firefox 76+

The browser must support Web Audio API, Canvas 2D API, and getUserMedia (for microphone access).

Install & Run
bash# 1. Clone the repository
git clone <your-repo-url>
cd PitchVisualizer

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
Then open http://localhost:5173 in your browser.
Build for Production
bashnpm run build
Output is placed in the dist/ folder. Serve it with any static file host.
Preview the Production Build
bashnpm run preview

🎤 How to Use

Load a Track — Click Select Track and choose an MP3, WAV, or OGG file. The app analyses the audio offline and draws the original pitch track on the canvas.
Enable Microphone — Click Enable Mic and grant browser permission. Your live vocal pitch will begin appearing as a cyan line overlaid on the canvas.
Play Along — Hit Play to start the backing track. Sing along and watch your pitch (cyan) track against the original (orange/green blocks).
Seek — Click or drag the progress bar to jump to any position in the track.


🧠 Pitch Detection Algorithm
The detector (src/pitchDetector.js) implements a custom hybrid YIN-MPM algorithm:
StepDetailAmplitude NormalisationRMS-based normalisation (up to 200× gain) so quiet voices are detected equally wellHann WindowingApplied to each 1024-sample frame to reduce spectral leakageNSDFNormalized Square Difference Function (McLeod & Wyvill, 2005) for periodicity detectionPeak PickingKey maxima selected with a k-threshold of 0.5; frequencies above 3000 Hz rejected as noiseParabolic InterpolationSub-sample frequency accuracy without FFT paddingClarity Score0.0–1.0 confidence metric; low-clarity frames still output a frequency (never null) so the wave stays continuousMedian Filter2-tap median smoother on the live stream; bypassed for offline analysis to preserve quality
Supported range: 50 Hz – 3000 Hz (roughly C1 – B7)

🎨 Visualizer Color Legend
ColorMeaning🟠 OrangeUpcoming (unplayed) note block🟢 GreenPassed (played) note block🔵 CyanYour live vocal pitch🟡 Yellow stripeOrnamental / grace-note accent╌ Dashed lineMelodic leap connector (> 4 semitones)Bézier arcSmooth glide (meend) between close notes

🛠️ Tech Stack
TechnologyPurposeVite 7Dev server & ES module bundlerpitchfinder 2.3.4Pitch detection reference / utilityWeb Audio APIAudio decoding, playback, mic captureCanvas 2D APIAll pitch visualization renderingOutfit — Google FontsUI typography

No UI frameworks — pure vanilla JS, HTML, and CSS throughout.


🔒 Ignored Files
The following are excluded from version control via .gitignore:

node_modules/ — installed dependencies
dist/ and dist-ssr/ — production build output
*.local — local environment files
Editor directories: .vscode/ (except extensions.json), .idea/
OS files: .DS_Store

