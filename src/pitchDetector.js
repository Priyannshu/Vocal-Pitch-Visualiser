/**
 * Antigravity Hybrid YIN-MPM Monophonic Pitch Detector
 *
 * Features:
 *  - Hann windowing on 1024-sample frames
 *  - NSDF (Normalized Square Difference Function) for periodicity detection
 *  - Parabolic interpolation for sub-bin frequency accuracy
 *  - Median filter with bypass toggle for A/B debugging
 *  - Clarity score (0.0–1.0) with raw fallback (never outputs null – low-clarity
 *    frames emit the raw autocorrelation result so the wave stays visible)
 *  - Input amplitude normalization so quiet vocals don't disappear
 *
 * Reference: McLeod & Wyvill, "A Smarter Way to Find Pitch" (2005)
 */

// ── Constants ───────────────────────────────────────────────────────────────────
const FRAME_SIZE = 1024;

// Pre-computed Hann window
const hannWindow = new Float32Array(FRAME_SIZE);
for (let i = 0; i < FRAME_SIZE; i++) {
    hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1)));
}

// ── Circular Buffer ─────────────────────────────────────────────────────────────
class CircularBuffer {
    constructor(size) {
        this.buffer = new Float32Array(size);
        this.size = size;
        this.writeIndex = 0;
        this.filled = 0;
    }

    push(samples) {
        for (let i = 0; i < samples.length; i++) {
            this.buffer[this.writeIndex] = samples[i];
            this.writeIndex = (this.writeIndex + 1) % this.size;
        }
        this.filled = Math.min(this.filled + samples.length, this.size);
    }

    isFull() {
        return this.filled >= this.size;
    }

    getFrame() {
        const frame = new Float32Array(this.size);
        const start = (this.writeIndex - this.size + this.buffer.length) % this.buffer.length;
        for (let i = 0; i < this.size; i++) {
            frame[i] = this.buffer[(start + i) % this.buffer.length];
        }
        return frame;
    }
}

// ── Median Filter ───────────────────────────────────────────────────────────────
class MedianFilter {
    constructor(windowSize) {
        this.windowSize = windowSize;
        this.history = [];
    }

    process(value) {
        this.history.push(value);
        if (this.history.length > this.windowSize) {
            this.history.shift();
        }
        const sorted = [...this.history].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    reset() {
        this.history = [];
    }
}

// ── Core Functions ──────────────────────────────────────────────────────────────

/**
 * Compute RMS amplitude of a frame for normalization.
 */
function computeRMS(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
        sum += frame[i] * frame[i];
    }
    return Math.sqrt(sum / frame.length);
}

/**
 * Normalize frame amplitude to a target RMS level.
 * Ensures quiet singing produces the same detection quality as loud singing.
 */
function normalizeAmplitude(frame, targetRMS = 0.1) {
    const rms = computeRMS(frame);
    if (rms < 1e-6) return frame; // silence, don't amplify noise

    const gain = targetRMS / rms;
    // Cap gain to avoid amplifying noise in very quiet frames
    const cappedGain = Math.min(gain, 20);

    const normalized = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
        normalized[i] = frame[i] * cappedGain;
    }
    return normalized;
}

function applyHannWindow(frame) {
    const windowed = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
        windowed[i] = frame[i] * hannWindow[i];
    }
    return windowed;
}

/**
 * Compute NSDF (Normalized Square Difference Function).
 */
function computeNSDF(frame) {
    const n = frame.length;
    const nsdf = new Float32Array(n);

    for (let tau = 0; tau < n; tau++) {
        let acf = 0;
        let m = 0;

        for (let j = 0; j < n - tau; j++) {
            acf += frame[j] * frame[j + tau];
            m += frame[j] * frame[j] + frame[j + tau] * frame[j + tau];
        }

        nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
    }

    return nsdf;
}

/**
 * Find key maxima in the NSDF (positive peaks after zero-crossings).
 */
function findNSDFPeaks(nsdf) {
    const peaks = [];
    let positiveRegion = false;
    let currentPeakTau = 0;
    let currentPeakVal = -Infinity;

    for (let tau = 1; tau < nsdf.length; tau++) {
        if (nsdf[tau] > 0) {
            if (!positiveRegion) {
                positiveRegion = true;
                currentPeakTau = tau;
                currentPeakVal = nsdf[tau];
            } else if (nsdf[tau] > currentPeakVal) {
                currentPeakTau = tau;
                currentPeakVal = nsdf[tau];
            }
        } else if (positiveRegion) {
            peaks.push({ tau: currentPeakTau, value: currentPeakVal });
            positiveRegion = false;
            currentPeakVal = -Infinity;
        }
    }

    if (positiveRegion && currentPeakVal > 0) {
        peaks.push({ tau: currentPeakTau, value: currentPeakVal });
    }

    return peaks;
}

/**
 * Parabolic interpolation for sub-sample accuracy.
 */
function parabolicInterpolation(nsdf, tau) {
    if (tau <= 0 || tau >= nsdf.length - 1) {
        return { tau: tau, value: nsdf[tau] };
    }

    const s0 = nsdf[tau - 1];
    const s1 = nsdf[tau];
    const s2 = nsdf[tau + 1];

    const denom = 2 * (2 * s1 - s0 - s2);
    if (Math.abs(denom) < 1e-12) {
        return { tau: tau, value: s1 };
    }

    const shift = (s2 - s0) / denom;
    return {
        tau: tau + shift,
        value: s1 - 0.25 * (s0 - s2) * shift
    };
}

/**
 * Main detection function.
 *
 * KEY CHANGE: When clarity is below threshold, we DO NOT return null.
 * Instead we return the raw autocorrelation-derived frequency estimate
 * so the pitch wave remains visible as a "low confidence" signal.
 *
 * @returns {{frequency: number|null, clarity: number, confident: boolean, rms: number}}
 */
function detectPitchFromFrame(frame, sampleRate, clarityThreshold = 0.2) {
    // 0. Measure raw input amplitude
    const rawRMS = computeRMS(frame);

    // Very quiet frame — true silence
    if (rawRMS < 0.005) {
        return { frequency: null, clarity: 0, confident: false, rms: rawRMS };
    }

    // 1. Normalize amplitude so quiet vocals get equal detection quality
    const normalized = normalizeAmplitude(frame);

    // 2. Apply Hann window
    const windowed = applyHannWindow(normalized);

    // 3. Compute NSDF
    const nsdf = computeNSDF(windowed);

    // 4. Find key maxima
    const peaks = findNSDFPeaks(nsdf);

    if (peaks.length === 0) {
        return { frequency: null, clarity: 0, confident: false, rms: rawRMS };
    }

    // 5. Select best peak — LOWERED k-threshold to 0.5 for more sensitive detection
    let globalMax = -Infinity;
    for (const p of peaks) {
        if (p.value > globalMax) globalMax = p.value;
    }

    const kThreshold = 0.5; // Lowered from 0.8 → 0.5 for sensitivity
    let selectedPeak = null;

    for (const p of peaks) {
        if (p.value >= kThreshold * globalMax) {
            selectedPeak = p;
            break;
        }
    }

    if (!selectedPeak) {
        return { frequency: null, clarity: 0, confident: false, rms: rawRMS };
    }

    // 6. Parabolic interpolation for sub-sample accuracy
    const interpolated = parabolicInterpolation(nsdf, selectedPeak.tau);

    if (interpolated.tau <= 0) {
        return { frequency: null, clarity: 0, confident: false, rms: rawRMS };
    }

    // 7. Convert lag to frequency
    const frequency = sampleRate / interpolated.tau;
    const clarity = Math.max(0, Math.min(1, interpolated.value));

    // Reject unreasonable frequencies
    if (frequency < 50 || frequency > 2000) {
        return { frequency: null, clarity: clarity, confident: false, rms: rawRMS };
    }

    // 8. DEBUG OUTPUT: If clarity is below threshold, still output the raw
    //    autocorrelation frequency — don't suppress it. Mark as low-confidence.
    const confident = clarity >= clarityThreshold;

    return {
        frequency: frequency,
        clarity: clarity,
        confident: confident,
        rms: rawRMS
    };
}


// ── Exported PitchDetector Class ────────────────────────────────────────────────

export class PitchDetector {
    /**
     * @param {number} sampleRate
     * @param {object} options
     * @param {number} options.clarityThreshold - Min clarity for "confident" flag (default 0.2)
     * @param {number} options.medianWindowSize - Median filter window (default 5)
     * @param {boolean} options.bypassSmoothing - Bypass median filter for debugging (default false)
     */
    constructor(sampleRate, options = {}) {
        this.sampleRate = sampleRate;
        this.clarityThreshold = options.clarityThreshold ?? 0.2;
        this.bypassSmoothing = options.bypassSmoothing ?? false;
        this.medianFilter = new MedianFilter(options.medianWindowSize ?? 5);
        this.circularBuffer = new CircularBuffer(FRAME_SIZE);
    }

    /** Toggle the median filter bypass at runtime for A/B debugging */
    setBypassSmoothing(bypass) {
        this.bypassSmoothing = bypass;
        if (bypass) {
            this.medianFilter.reset();
        }
    }

    /**
     * Real-time streaming detection from mic.
     * Returns frequency even for low-clarity frames (debug mode).
     */
    processRealtime(samples) {
        this.circularBuffer.push(samples);

        if (!this.circularBuffer.isFull()) {
            return { frequency: null, clarity: 0, confident: false, rms: 0 };
        }

        const frame = this.circularBuffer.getFrame();
        const result = detectPitchFromFrame(frame, this.sampleRate, this.clarityThreshold);

        // Apply median filter only if not bypassed AND we have a frequency
        if (result.frequency !== null && !this.bypassSmoothing) {
            result.frequency = this.medianFilter.process(result.frequency);
        }

        return result;
    }

    /**
     * Single-frame detection (offline).
     */
    processFrame(frame) {
        return detectPitchFromFrame(frame, this.sampleRate, this.clarityThreshold);
    }

    /**
     * Full offline analysis.
     * Now includes ALL detected frames (even low-confidence ones) to keep
     * the wave visible. The 'confident' flag lets the renderer decide styling.
     */
    analyzeOffline(channelData, stepSize = 512) {
        const results = [];
        const medianF = new MedianFilter(5);
        const numFrames = Math.floor((channelData.length - FRAME_SIZE) / stepSize);

        for (let i = 0; i < numFrames; i++) {
            const start = i * stepSize;
            const frame = channelData.slice(start, start + FRAME_SIZE);
            const result = detectPitchFromFrame(frame, this.sampleRate, this.clarityThreshold);
            const timeInSeconds = start / this.sampleRate;

            if (result.frequency !== null) {
                // Apply median filter unless bypassed
                const freq = this.bypassSmoothing
                    ? result.frequency
                    : medianF.process(result.frequency);

                results.push({
                    time: timeInSeconds,
                    pitch: freq,
                    clarity: result.clarity,
                    confident: result.confident
                });
            }
        }

        return results;
    }

    /** Reset internal state */
    reset() {
        this.medianFilter.reset();
        this.circularBuffer = new CircularBuffer(FRAME_SIZE);
    }
}
