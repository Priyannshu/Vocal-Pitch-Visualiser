export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.buffer = null;
        this.source = null;

        // Sub-system for mic recording
        this.micStream = null;
        this.micSource = null;
        this.scriptProcessor = null;

        // State state
        this.state = {
            isReady: false,
            isPlaying: false,
            currentTime: 0,
            duration: 0
        };

        this.onStateChange = () => { };
        this.onMicAudioProcess = () => { };

        this.startTime = 0;
        this.pauseTime = 0;
        this.animationFrame = null;
    }

    initContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    async loadFile(file) {
        this.initContext();

        const arrayBuffer = await file.arrayBuffer();
        this.buffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.state.isReady = true;
        this.state.duration = this.buffer.duration;
        this.state.currentTime = 0;
        this.pauseTime = 0;
        this.updateState();

        return this.buffer;
    }

    play() {
        if (!this.buffer || this.state.isPlaying) return;
        this.initContext();

        this.source = this.audioContext.createBufferSource();
        this.source.buffer = this.buffer;
        this.source.connect(this.audioContext.destination);

        // Calculate offest based on pauses
        let offset = this.pauseTime;
        this.source.start(0, offset);

        this.startTime = this.audioContext.currentTime - offset;
        this.state.isPlaying = true;
        this.updateState();

        this.source.onended = () => {
            // Only reset if it naturally ended, not from user pause
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

    updateProgressLoop() {
        if (!this.state.isPlaying) return;

        this.state.currentTime = this.audioContext.currentTime - this.startTime;
        this.updateState();

        this.animationFrame = requestAnimationFrame(() => this.updateProgressLoop());
    }

    updateState() {
        this.onStateChange(this.state);
    }

    // --- Microphone Handling ---
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
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false,
                    latency: 0
                }
            });

            this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

            // Use ScriptProcessorNode for wide compatibility and direct access to audio buffer arrays for pitch rendering
            // 2048 buffer size gives decent time resolution
            this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);

            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const inputBuffer = audioProcessingEvent.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                // CRITICAL: copy the buffer — ScriptProcessor reuses the same Float32Array
                const dataCopy = new Float32Array(inputData.length);
                dataCopy.set(inputData);
                if (this.onMicAudioProcess) {
                    this.onMicAudioProcess(dataCopy);
                }
            };

            // Connect to graph
            this.micSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            return true;
        } catch (err) {
            console.error('Error enabling mic:', err);
            // In a real app we'd trigger a UI toast
            return false;
        }
    }

    disableMic() {
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
    }
}
