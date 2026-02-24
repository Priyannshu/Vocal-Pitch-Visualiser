import './style.css';
import { AudioManager } from './audioManager.js';
import { PitchProcessor } from './pitchProcessor.js';
import { CanvasRenderer } from './canvasRenderer.js';

class App {
    constructor() {
        this.audioManager = new AudioManager();
        this.pitchProcessor = new PitchProcessor();
        this.canvasRenderer = new CanvasRenderer(document.getElementById('pitch-canvas'));

        this.bindEvents();
        this.canvasRenderer.start(); // Start drawing loop
    }

    bindEvents() {
        const uploadInput = document.getElementById('audio-upload');
        const btnMic = document.getElementById('btn-mic');
        const btnPlay = document.getElementById('btn-play');
        const btnPause = document.getElementById('btn-pause');
        const btnStop = document.getElementById('btn-stop');

        uploadInput.addEventListener('change', (e) => this.handleFileUpload(e));
        btnMic.addEventListener('click', () => this.toggleMic());

        btnPlay.addEventListener('click', () => this.audioManager.play());
        btnPause.addEventListener('click', () => this.audioManager.pause());
        btnStop.addEventListener('click', () => this.audioManager.stop());

        // Listen for state changes from audio manager
        this.audioManager.onStateChange = (state) => this.updateUIState(state);

        // Receive original pitch data (now includes rawPitch + noteBlocks)
        this.pitchProcessor.onOriginalPitchReady = (pitchData) => {
            this.canvasRenderer.setOriginalPitchData(pitchData);
        };

        // Receive live user pitch
        this.audioManager.onMicAudioProcess = (audioBuffer) => {
            const pitch = this.pitchProcessor.detectPitch(audioBuffer);
            this.canvasRenderer.addLivePitch(pitch);
        };
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        document.getElementById('file-name').textContent = file.name;

        // Decode audio and get buffer
        const audioBuffer = await this.audioManager.loadFile(file);
        if (audioBuffer) {
            // Process offline to find pitch track
            this.pitchProcessor.analyzeFullBuffer(audioBuffer);
        }
    }

    async toggleMic() {
        const isMicActive = await this.audioManager.toggleMic();
        const micStatus = document.getElementById('mic-status');
        const btnMic = document.getElementById('btn-mic');

        if (isMicActive) {
            // Initialize mic pitch detector with the actual AudioContext sample rate
            if (this.audioManager.audioContext) {
                this.pitchProcessor.initMicDetector(this.audioManager.audioContext.sampleRate);
            }
            micStatus.textContent = '● Live';
            micStatus.classList.add('active');
            btnMic.textContent = 'Disable Mic';
            btnMic.classList.replace('secondary-btn', 'primary-btn');
        } else {
            micStatus.textContent = '● Offline';
            micStatus.classList.remove('active');
            btnMic.textContent = 'Enable Mic';
            btnMic.classList.replace('primary-btn', 'secondary-btn');
        }
    }

    updateUIState(state) {
        const btnPlay = document.getElementById('btn-play');
        const btnPause = document.getElementById('btn-pause');
        const btnStop = document.getElementById('btn-stop');

        btnPlay.disabled = !state.isReady || state.isPlaying;
        btnPause.disabled = !state.isPlaying;
        btnStop.disabled = !state.isPlaying && state.currentTime === 0;

        // Update playhead mapping in renderer
        this.canvasRenderer.setCurrentTime(state.currentTime);
        document.getElementById('time-display').textContent = this.formatTime(state.currentTime) + ' / ' + this.formatTime(state.duration);

        if (state.duration > 0) {
            const progress = (state.currentTime / state.duration) * 100;
            document.getElementById('progress-bar').style.width = `${progress}%`;
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }
}

// Init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new App();
});
