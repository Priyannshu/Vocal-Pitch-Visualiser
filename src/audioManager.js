/**
 * AudioManager — VOCAL Audio Processing Engine
 *
 * Manages two separate audio tracks:
 *   - vocalsBuffer    → decoded PCM of the singer's isolated vocals (for pitch analysis only, NOT played back)
 *   - instrumentalBuffer → decoded PCM of the backing instrumental (played during recording)
 *
 * Microphone capture uses AudioWorkletNode (spec requirement) with fallback
 * to ScriptProcessorNode for older browsers.
 *
 * The instrumental plays through speakers during recording.
 * The vocals are analysed offline by PitchProcessor.
 */

export class AudioManager {
    constructor() {
        this.audioContext = null;

        // Two distinct audio buffers
        this.vocalsBuffer = null;
        this.instrumentalBuffer = null;

        // Playback source (instrumental only)
        this.source = null;

        // Mic subsystem
        this.micStream = null;
        this.micSource = null;
        this.workletNode = null;
        this.scriptProcessor = null; // fallback
        this.useWorklet = false;

        // State
        this.state = {
            isReady: false,
            isPlaying: false,
            currentTime: 0,
            duration: 0
        };

        this.onStateChange = () => {};
        this.onMicAudioProcess = () => {};

        this.startTime = 0;
        this.pauseTime = 0;
        this.animationFrame = null;
    }

    // ═══════════════════════════════════════════════════════════
    //  Context
    // ═══════════════════════════════════════════════════════════

    initContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Loading — supports both File objects and ArrayBuffers
    // ═══════════════════════════════════════════════════════════

    /**
     * Load vocals audio from a File or ArrayBuffer.
     * Returns the decoded AudioBuffer for offline pitch analysis.
     */
    async loadVocals(source) {
        this.initContext();
        const arrayBuffer = source instanceof File ? await source.arrayBuffer() : source;
        this.vocalsBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Duration is based on whichever is longer (usually the same)
        this._updateDuration();
        return this.vocalsBuffer;
    }

    /**
     * Load instrumental audio from a File or ArrayBuffer.
     * This is the track that plays through speakers during recording.
     */
    async loadInstrumental(source) {
        this.initContext();
        const arrayBuffer = source instanceof File ? await source.arrayBuffer() : source;
        this.instrumentalBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this._updateDuration();
        return this.instrumentalBuffer;
    }

    /**
     * Legacy: load a single file as both vocals + instrumental (for backward compat).
     * Returns the decoded AudioBuffer.
     */
    async loadFile(file) {
        this.initContext();
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.vocalsBuffer = buffer;
        this.instrumentalBuffer = buffer;
        this._updateDuration();
        return buffer;
    }

    _updateDuration() {
        const vocDur = this.vocalsBuffer ? this.vocalsBuffer.duration : 0;
        const instDur = this.instrumentalBuffer ? this.instrumentalBuffer.duration : 0;
        this.state.duration = Math.max(vocDur, instDur);
        this.state.isReady = this.vocalsBuffer !== null && this.instrumentalBuffer !== null;
        this.state.currentTime = 0;
        this.pauseTime = 0;
        this.updateState();
    }

    // ═══════════════════════════════════════════════════════════
    //  Playback (instrumental only → speakers)
    // ═══════════════════════════════════════════════════════════

    play() {
        if (!this.instrumentalBuffer || this.state.isPlaying) return;
        this.initContext();

        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.instrumentalBuffer;
        this.source.connect(this.audioContext.destination);

        const offset = this.pauseTime;
        this.source.start(0, offset);

        this.startTime = this.audioContext.currentTime - offset;
        this.state.isPlaying = true;
        this.updateState();

        this.source.onended = () => {
            if (this.state.isPlaying) {
                this.stop();
            }
        };

        this.updateProgressLoop();
    }

    pause() {
        if (!this.state.isPlaying || !this.source) return;

        this.source.stop();
        this.pauseTime = this.audioContext.currentTime - this.startTime;
        this.state.isPlaying = false;
        this.updateState();
        cancelAnimationFrame(this.animationFrame);
    }

    stop() {
        if (this.source && this.state.isPlaying) {
            this.source.stop();
        }
        this.state.isPlaying = false;
        this.state.currentTime = 0;
        this.pauseTime = 0;
        this.updateState();
        cancelAnimationFrame(this.animationFrame);
    }

    seek(time) {
        const buf = this.instrumentalBuffer;
        if (!buf) return;
        const clampedTime = Math.max(0, Math.min(time, buf.duration));

        if (this.state.isPlaying) {
            if (this.source) {
                this.source.onended = null;
                this.source.stop();
            }
            this.state.isPlaying = false;
            cancelAnimationFrame(this.animationFrame);
            this.pauseTime = clampedTime;
            this.play();
        } else {
            this.pauseTime = clampedTime;
            this.state.currentTime = clampedTime;
            this.updateState();
        }
    }

    updateProgressLoop() {
        if (!this.state.isPlaying) return;
        this.state.currentTime = this.audioContext.currentTime - this.startTime;
        this.updateState();
        this.animationFrame = requestAnimationFrame(() => this.updateProgressLoop());
    }

    updateState() {
        this.onStateChange(this.state);
    }

    // ═══════════════════════════════════════════════════════════
    //  Microphone — AudioWorkletNode (preferred) + SPNode fallback
    // ═══════════════════════════════════════════════════════════

    async toggleMic() {
        if (this.micStream) {
            this.disableMic();
            return false;
        } else {
            return await this.enableMic();
        }
    }

    async enableMic() {
        try {
            this.initContext();

            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    autoGainControl: true,
                    noiseSuppression: true,
                    latency: 0
                }
            });

            this.micSource = this.audioContext.createMediaStreamSource(this.micStream);
            this.micStartTime = this.audioContext.currentTime;

            // Try AudioWorkletNode first (spec requirement)
            try {
                await this.audioContext.audioWorklet.addModule('/pitch-worklet.js');
                this.workletNode = new AudioWorkletNode(this.audioContext, 'pitch-worklet-processor');
                this.useWorklet = true;

                this.workletNode.port.onmessage = (event) => {
                    if (event.data.type === 'audio-buffer') {
                        const buffer = event.data.buffer;
                        const micActiveTime = this.audioContext.currentTime - this.micStartTime;
                        const timeToReport = this.state.isPlaying ? this.state.currentTime : micActiveTime;
                        this.onMicAudioProcess(buffer, timeToReport);
                    }
                };

                this.micSource.connect(this.workletNode);
                // Connect to destination to keep the graph alive (silent output)
                this.workletNode.connect(this.audioContext.destination);

                console.log('[AudioManager] Using AudioWorkletNode for mic capture');
            } catch (workletError) {
                // Fallback to ScriptProcessorNode
                console.warn('[AudioManager] AudioWorklet not available, falling back to ScriptProcessorNode:', workletError);
                this.useWorklet = false;

                this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);

                this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                    const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                    const dataCopy = new Float32Array(inputData.length);
                    dataCopy.set(inputData);

                    const micActiveTime = this.audioContext.currentTime - this.micStartTime;
                    const timeToReport = this.state.isPlaying ? this.state.currentTime : micActiveTime;
                    this.onMicAudioProcess(dataCopy, timeToReport);
                };

                this.micSource.connect(this.scriptProcessor);
                this.scriptProcessor.connect(this.audioContext.destination);
            }

            return true;
        } catch (err) {
            console.error('Error enabling mic:', err);
            return false;
        }
    }

    disableMic() {
        if (this.workletNode) {
            this.workletNode.disconnect();
            this.workletNode = null;
        }
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        if (this.micSource) {
            this.micSource.disconnect();
            this.micSource = null;
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        this.useWorklet = false;
    }
}
