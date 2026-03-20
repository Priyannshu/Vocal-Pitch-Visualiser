import './style.css';
import { AudioManager } from './audioManager.js';
import { PitchProcessor } from './pitchProcessor.js';
import { CanvasRenderer } from './canvasRenderer.js';

/**
 * VOCAL — Main Application Controller
 *
 * Manages the complete data flow:
 *   Option A: YouTube link → FastAPI backend → vocals + instrumental
 *   Option B: Direct upload of both files → vocals + instrumental
 *
 * After either option completes:
 *   1. Vocals → offline pitch analysis (pitchy) → reference pitch map on canvas
 *   2. Record → instrumental plays + mic opens → live pitch detection → orange line
 *   3. Stop → review screen with accuracy graph
 */

const BACKEND_URL = 'http://localhost:8000';

class App {
    constructor() {
        this.audioManager = new AudioManager();
        this.pitchProcessor = new PitchProcessor();
        this.canvasRenderer = new CanvasRenderer(document.getElementById('pitch-canvas'));

        // State
        this.isRecording = false;
        this.hasPerformed = false;
        this.trackTitle = '';

        // Direct upload state (Option B)
        this.vocalsFile = null;
        this.instrumentalFile = null;

        this.bindEvents();
        this.canvasRenderer.start();
    }

    // ═══════════════════════════════════════════════════════════
    //  Event Binding
    // ═══════════════════════════════════════════════════════════

    bindEvents() {
        // ── Option A: YouTube link ────────────────────────────
        const btnYtSubmit = document.getElementById('btn-yt-submit');
        const ytInput = document.getElementById('yt-url-input');

        btnYtSubmit.addEventListener('click', () => this.handleYouTubeSubmit());
        ytInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleYouTubeSubmit();
        });

        // ── Option B: Direct file upload ──────────────────────
        document.getElementById('upload-vocals').addEventListener('change', (e) => this.handleVocalsUpload(e));
        document.getElementById('upload-instrumental').addEventListener('change', (e) => this.handleInstrumentalUpload(e));

        // ── Controls ──────────────────────────────────────────
        document.getElementById('btn-record').addEventListener('click', () => this.toggleRecord());
        document.getElementById('btn-playback').addEventListener('click', () => this.togglePlayback());

        // ── Scrubber seek ─────────────────────────────────────
        const scrubberTrack = document.querySelector('.scrubber-track');
        if (scrubberTrack) {
            let isDragging = false;
            const seekFromEvent = (e) => {
                const rect = scrubberTrack.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const seekTime = ratio * this.audioManager.state.duration;
                this.audioManager.seek(seekTime);
            };
            scrubberTrack.addEventListener('mousedown', (e) => {
                if (this.audioManager.state.duration > 0) {
                    isDragging = true;
                    seekFromEvent(e);
                }
            });
            window.addEventListener('mousemove', (e) => { if (isDragging) seekFromEvent(e); });
            window.addEventListener('mouseup', () => { isDragging = false; });
        }

        // ── Audio state changes ───────────────────────────────
        this.audioManager.onStateChange = (state) => this.updateUIState(state);

        // ── Original pitch data ready ─────────────────────────
        this.pitchProcessor.onOriginalPitchReady = (pitchData) => {
            this.canvasRenderer.setOriginalPitchData(pitchData);
        };

        // ── Live mic pitch ────────────────────────────────────
        let lastLog = 0;
        this.audioManager.onMicAudioProcess = (audioBuffer, micTime) => {
            const pitch = this.pitchProcessor.detectPitch(audioBuffer);

            // If the backing track isn't playing, drive the playhead using the mic's clock
            if (!this.audioManager.state.isPlaying && micTime !== undefined) {
                this.canvasRenderer.setCurrentTime(micTime);
            }

            if (pitch !== null) {
                const currentTime = this.canvasRenderer.currentTime;

                const now = performance.now();
                if (now - lastLog > 1000) {
                    console.log(`[Main] Mic Pitch: ${pitch.toFixed(1)} Hz at t=${currentTime.toFixed(2)}s`);
                    lastLog = now;
                }

                this.canvasRenderer.addLivePitch(pitch);
                this.pitchProcessor.addLivePitchSample(currentTime, pitch);
            }
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  Option A — YouTube Link
    // ═══════════════════════════════════════════════════════════

    async handleYouTubeSubmit() {
        const input = document.getElementById('yt-url-input');
        const url = input.value.trim();
        if (!url) return;

        const statusEl = document.getElementById('yt-status');
        const statusText = document.getElementById('yt-status-text');
        const btnSubmit = document.getElementById('btn-yt-submit');

        // Show loading
        statusEl.classList.remove('hidden', 'error');
        statusText.textContent = 'Downloading and separating... this may take a few minutes';
        btnSubmit.disabled = true;

        try {
            const response = await fetch(`${BACKEND_URL}/separate-from-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ detail: 'Server error' }));
                throw new Error(errData.detail || `HTTP ${response.status}`);
            }

            const data = await response.json();
            statusText.textContent = 'Processing audio...';

            // Decode base64 → ArrayBuffer
            const vocalsArrayBuffer = this.base64ToArrayBuffer(data.vocals);
            const instrumentalArrayBuffer = this.base64ToArrayBuffer(data.instrumental);

            this.trackTitle = data.title || 'YouTube Track';

            // Load into AudioManager
            const vocalsBuffer = await this.audioManager.loadVocals(vocalsArrayBuffer);
            await this.audioManager.loadInstrumental(instrumentalArrayBuffer);

            // Analyse vocals for pitch map
            this.pitchProcessor.initMicDetector(this.audioManager.audioContext.sampleRate);
            this.pitchProcessor.analyzeFullBuffer(vocalsBuffer);

            // Transition UI
            this.showSongCard(this.trackTitle, 'YouTube', vocalsBuffer.duration);

        } catch (err) {
            console.error('[YouTube] Error:', err);
            statusEl.classList.add('error');
            statusText.textContent = `Error: ${err.message}`;
        } finally {
            btnSubmit.disabled = false;
        }
    }

    base64ToArrayBuffer(base64) {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // ═══════════════════════════════════════════════════════════
    //  Option B — Direct Upload (Vocals + Instrumental)
    // ═══════════════════════════════════════════════════════════

    async handleVocalsUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.vocalsFile = file;

        // Update UI
        const label = document.getElementById('upload-vocals-name');
        label.textContent = file.name;
        label.closest('.file-upload-label').classList.add('loaded');

        // Check if both files are ready
        await this.tryCompleteDirectUpload();
    }

    async handleInstrumentalUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        this.instrumentalFile = file;

        // Update UI
        const label = document.getElementById('upload-instrumental-name');
        label.textContent = file.name;
        label.closest('.file-upload-label').classList.add('loaded');

        // Check if both files are ready
        await this.tryCompleteDirectUpload();
    }

    async tryCompleteDirectUpload() {
        if (!this.vocalsFile || !this.instrumentalFile) {
            // Show partial status
            const statusEl = document.getElementById('direct-upload-status');
            const statusText = document.getElementById('direct-upload-status-text');
            statusEl.classList.remove('hidden', 'ready');

            if (this.vocalsFile && !this.instrumentalFile) {
                statusText.textContent = 'Vocals loaded. Now upload the instrumental.';
            } else if (!this.vocalsFile && this.instrumentalFile) {
                statusText.textContent = 'Instrumental loaded. Now upload the vocals.';
            }
            return;
        }

        // Both files are selected — process them
        const statusEl = document.getElementById('direct-upload-status');
        const statusText = document.getElementById('direct-upload-status-text');
        statusEl.classList.remove('hidden');
        statusText.textContent = 'Processing audio...';

        try {
            const vocalsBuffer = await this.audioManager.loadVocals(this.vocalsFile);
            await this.audioManager.loadInstrumental(this.instrumentalFile);

            this.trackTitle = this.vocalsFile.name.replace(/\.[^/.]+$/, '');

            // Analyse vocals for pitch map
            this.pitchProcessor.initMicDetector(this.audioManager.audioContext.sampleRate);
            this.pitchProcessor.analyzeFullBuffer(vocalsBuffer);

            // Transition UI
            statusEl.classList.add('ready');
            statusText.textContent = 'Both files loaded!';
            this.showSongCard(this.trackTitle, 'Uploaded', vocalsBuffer.duration);

        } catch (err) {
            console.error('[DirectUpload] Error:', err);
            statusText.textContent = `Error: ${err.message}`;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Song Card — Show After Either Upload Path Completes
    // ═══════════════════════════════════════════════════════════

    showSongCard(title, artist, duration) {
        // Hide upload area
        document.getElementById('upload-area').classList.add('hidden');

        // Show song card
        const songCard = document.getElementById('song-card');
        songCard.classList.remove('hidden');
        document.getElementById('song-title').textContent = title;
        document.getElementById('song-artist').textContent = artist;
        document.getElementById('song-duration').textContent = this.formatTime(duration);
        document.getElementById('song-status').textContent = 'Ready';
        document.getElementById('time-total').textContent = this.formatTime(duration);

        // Enable controls
        document.getElementById('btn-record').disabled = false;
        document.getElementById('btn-playback').disabled = false;
    }

    // ═══════════════════════════════════════════════════════════
    //  Record Toggle
    // ═══════════════════════════════════════════════════════════

    async toggleRecord() {
        const btn = document.getElementById('btn-record');

        if (this.isRecording) {
            // ── Stop recording ────────────────────────────────
            this.isRecording = false;
            btn.textContent = '● Record';
            btn.classList.remove('recording');

            // Disable mic
            await this.audioManager.toggleMic();

            // Stop instrumental if playing
            if (this.audioManager.state.isPlaying) {
                this.audioManager.stop();
            }

            // Switch to review mode
            this.enterReviewMode();
        } else {
            // ── Start recording ───────────────────────────────
            this.isRecording = true;
            btn.textContent = '■ Stop';
            btn.classList.add('recording');

            // Reset live pitch data for fresh recording
            this.pitchProcessor.resetLivePitch();
            this.canvasRenderer.livePitchData = [];

            // Switch to live mode
            this.enterLiveMode();

            // Enable mic (AudioWorkletNode per spec)
            const micActive = await this.audioManager.toggleMic();
            if (micActive && this.audioManager.audioContext) {
                this.pitchProcessor.initMicDetector(this.audioManager.audioContext.sampleRate);
            }

            // Start instrumental playback simultaneously (karaoke style)
            if (this.audioManager.state.isReady) {
                this.audioManager.seek(0);
                this.audioManager.play();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Playback Toggle
    // ═══════════════════════════════════════════════════════════

    togglePlayback() {
        if (this.audioManager.state.isPlaying) {
            this.audioManager.pause();
        } else if (this.audioManager.state.isReady) {
            this.audioManager.play();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Dashboard Modes
    // ═══════════════════════════════════════════════════════════

    enterLiveMode() {
        this.canvasRenderer.setMode('live');

        // Hide review-only elements
        document.getElementById('stat-cards').classList.add('hidden');
        document.getElementById('canvas-section-heading').classList.add('hidden');
        document.getElementById('section-label-strip').classList.add('hidden');
        document.getElementById('review-divider').classList.add('hidden');
        document.getElementById('accuracy-container').classList.add('hidden');

        // Hide match score value
        document.getElementById('match-score-value').textContent = '—';

        // Update song status
        document.getElementById('song-status').textContent = 'Recording';
    }

    enterReviewMode() {
        this.hasPerformed = true;
        const duration = this.audioManager.state.duration || this.canvasRenderer.currentTime;
        this.canvasRenderer.setMode('review', duration);

        // Show review-only elements
        document.getElementById('stat-cards').classList.remove('hidden');
        document.getElementById('canvas-section-heading').classList.remove('hidden');
        document.getElementById('section-label-strip').classList.remove('hidden');
        document.getElementById('review-divider').classList.remove('hidden');
        document.getElementById('accuracy-container').classList.remove('hidden');

        // Update song status
        document.getElementById('song-status').textContent = 'Done';

        // Compute match score
        const score = this.computeMatchScore();
        document.getElementById('match-score-value').textContent = `${score}%`;
        document.getElementById('stat-match-score').textContent = `${score}%`;

        // Best section (placeholder)
        document.getElementById('stat-best-section-value').textContent = '78%';
        document.getElementById('stat-best-section-name').textContent = 'Verse 1';

        // Accuracy pills
        document.getElementById('accuracy-avg-pill').textContent = `Avg ${score}%`;
        document.getElementById('accuracy-peak-pill').textContent = `Peak 78%`;

        // Fill scrubber to 100%
        document.getElementById('scrubber-fill').style.width = '100%';
        document.getElementById('scrubber-dot').style.left = '100%';

        // Draw accuracy graph
        this.drawAccuracyGraph();
    }

    // ═══════════════════════════════════════════════════════════
    //  Match Score
    // ═══════════════════════════════════════════════════════════

    computeMatchScore() {
        const userPitches = this.canvasRenderer.livePitchData;
        const refBlocks = this.canvasRenderer.noteBlocks;

        if (userPitches.length === 0 || refBlocks.length === 0) return 0;

        let matchCount = 0;
        let totalChecked = 0;

        for (const up of userPitches) {
            const ref = refBlocks.find(b => up.time >= b.startTime && up.time <= b.endTime);
            if (!ref) continue;

            totalChecked++;
            const semitoneError = Math.abs(12 * Math.log2(up.pitch / ref.avgPitch));
            if (semitoneError < 1.5) matchCount++;
        }

        if (totalChecked === 0) return 0;
        return Math.round((matchCount / totalChecked) * 100);
    }

    // ═══════════════════════════════════════════════════════════
    //  Accuracy Graph (Canvas-drawn)
    // ═══════════════════════════════════════════════════════════

    drawAccuracyGraph() {
        const canvas = document.getElementById('accuracy-canvas');
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const W = rect.width;
        const H = rect.height;
        const PAD_L = 36, PAD_R = 12, PAD_T = 10, PAD_B = 24;
        const plotW = W - PAD_L - PAD_R;
        const plotH = H - PAD_T - PAD_B;

        // Y-axis grid
        const yTicks = [0, 25, 50, 75, 100];
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (const t of yTicks) {
            const y = PAD_T + plotH - (t / 100) * plotH;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            ctx.moveTo(PAD_L, y);
            ctx.lineTo(PAD_L + plotW, y);
            ctx.stroke();
            ctx.fillStyle = '#444';
            ctx.fillText(`${t}%`, PAD_L - 6, y);
        }

        // Compute accuracy data
        const duration = this.audioManager.state.duration || this.canvasRenderer.currentTime || 1;
        const numPoints = 50;
        const accuracyData = [];

        for (let i = 0; i < numPoints; i++) {
            const t = (i / (numPoints - 1)) * duration;
            const nearby = this.canvasRenderer.livePitchData.filter(
                p => Math.abs(p.time - t) < duration / numPoints
            );
            const refBlocks = this.canvasRenderer.noteBlocks;

            if (nearby.length === 0) {
                accuracyData.push({ time: t, accuracy: 0 });
                continue;
            }

            let match = 0;
            for (const p of nearby) {
                const ref = refBlocks.find(b => p.time >= b.startTime && p.time <= b.endTime);
                if (ref) {
                    const err = Math.abs(12 * Math.log2(p.pitch / ref.avgPitch));
                    if (err < 2) match++;
                }
            }
            accuracyData.push({ time: t, accuracy: (match / nearby.length) * 100 });
        }

        // Fill gradient under curve
        if (accuracyData.length > 1) {
            ctx.beginPath();
            ctx.moveTo(PAD_L, PAD_T + plotH);
            for (const d of accuracyData) {
                const x = PAD_L + (d.time / duration) * plotW;
                const y = PAD_T + plotH - (d.accuracy / 100) * plotH;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(PAD_L + plotW, PAD_T + plotH);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
            grad.addColorStop(0, 'rgba(249,115,22,0.18)');
            grad.addColorStop(1, 'rgba(249,115,22,0)');
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            ctx.strokeStyle = '#f97316';
            ctx.lineWidth = 1.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            for (let i = 0; i < accuracyData.length; i++) {
                const d = accuracyData[i];
                const x = PAD_L + (d.time / duration) * plotW;
                const y = PAD_T + plotH - (d.accuracy / 100) * plotH;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }

        // X-axis labels
        ctx.fillStyle = '#444';
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const maxLabels = 8;
        const step = Math.ceil(numPoints / maxLabels);
        for (let i = 0; i < numPoints; i += step) {
            const d = accuracyData[i];
            if (!d) continue;
            const x = PAD_L + (d.time / duration) * plotW;
            ctx.fillText(this.formatTime(d.time), x, PAD_T + plotH + 6);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  UI State Updates
    // ═══════════════════════════════════════════════════════════

    updateUIState(state) {
        const btnPlayback = document.getElementById('btn-playback');
        if (state.isPlaying) {
            btnPlayback.textContent = '⏸ Pause';
        } else {
            btnPlayback.textContent = '▶ Play back';
        }

        this.canvasRenderer.setCurrentTime(state.currentTime);

        document.getElementById('time-current').textContent = this.formatTime(state.currentTime);
        document.getElementById('time-total').textContent = this.formatTime(state.duration);

        if (state.duration > 0) {
            const pct = (state.currentTime / state.duration) * 100;
            document.getElementById('scrubber-fill').style.width = `${pct}%`;
            document.getElementById('scrubber-dot').style.left = `${pct}%`;
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Util
    // ═══════════════════════════════════════════════════════════

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
