/**
 * PitchWorkletProcessor — AudioWorkletProcessor for real-time mic pitch detection
 *
 * Runs OFF the main thread inside an AudioWorklet context.
 * Collects audio samples into a 2048-sample buffer, then posts the buffer
 * to the main thread for pitch analysis via pitchy.
 *
 * Fires every ~23ms (128 samples at 44100 Hz), accumulates until 2048 reached.
 */

class PitchWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 2048;
        this.buffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0]; // mono channel

        for (let i = 0; i < channelData.length; i++) {
            this.buffer[this.writeIndex] = channelData[i];
            this.writeIndex++;

            if (this.writeIndex >= this.bufferSize) {
                // Buffer full — send copy to main thread
                const copy = new Float32Array(this.buffer);
                this.port.postMessage({
                    type: 'audio-buffer',
                    buffer: copy,
                    timestamp: currentTime
                });
                this.writeIndex = 0;
            }
        }

        return true; // keep processor alive
    }
}

registerProcessor('pitch-worklet-processor', PitchWorkletProcessor);
