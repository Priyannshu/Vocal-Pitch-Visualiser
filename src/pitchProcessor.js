/**
 * PitchProcessor — VOCAL Audio Processing Engine
 *
 * Uses `pitchy` (McLeod Pitch Method) for both offline singer analysis
 * and real-time microphone pitch detection.
 *
 * Key parameters (from spec):
 *   Buffer size:  2048 samples
 *   Hop size:     512 samples
 *   Sample rate:  44100 Hz (or actual AudioContext rate)
 *   Clarity:      > 0.9 for confident detection
 *   Freq range:   80 Hz – 1200 Hz
 *
 * Frequency → Canvas mapping:
 *   MIDI note = 12 * log2(freq / 440) + 69
 *   Y position = canvasHeight - ((midi - 60) / 12) * canvasHeight
 */

import { PitchDetector } from 'pitchy';

// ── Constants ───────────────────────────────────────────────────────────────────

const BUFFER_SIZE = 2048;
const HOP_SIZE = 512;
const DEFAULT_SAMPLE_RATE = 44100;
const CLARITY_THRESHOLD = 0.9;
const MIN_FREQ = 80;
const MAX_FREQ = 1200;

export class PitchProcessor {
    constructor() {
        this.sampleRate = DEFAULT_SAMPLE_RATE;

        // Live pitch accumulation
        this.livePitchTrack = [];

        // Callback when offline analysis is done
        this.onOriginalPitchReady = () => {};
    }

    /**
     * Initialize mic detector with the actual AudioContext sample rate.
     */
    initMicDetector(sampleRate) {
        this.sampleRate = sampleRate;
    }

    // ═══════════════════════════════════════════════════════════
    //  Real-Time Mic Pitch Detection
    // ═══════════════════════════════════════════════════════════

    /**
     * Detect pitch from a Float32Array buffer (from AudioWorklet or ScriptProcessor).
     * Returns the detected frequency if confident, else null.
     */
    detectPitch(float32Array) {
        const detector = PitchDetector.forFloat32Array(float32Array.length);
        const [frequency, clarity] = detector.findPitch(float32Array, this.sampleRate);

        // Apply spec thresholds
        if (clarity < CLARITY_THRESHOLD) return null;
        if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;

        return frequency;
    }

    // ═══════════════════════════════════════════════════════════
    //  Live Pitch Accumulation
    // ═══════════════════════════════════════════════════════════

    /**
     * Accumulate a live pitch sample from mic detection.
     */
    addLivePitchSample(time, pitch) {
        if (pitch == null) return;
        if (pitch < MIN_FREQ || pitch > MAX_FREQ) return;
        this.livePitchTrack.push({ time, pitch });
    }

    /**
     * Reset live pitch data (on stop / new track).
     */
    resetLivePitch() {
        this.livePitchTrack = [];
    }

    // ═══════════════════════════════════════════════════════════
    //  Offline Singer Pitch Analysis (Part 2 of spec)
    // ═══════════════════════════════════════════════════════════

    /**
     * Analyse the full vocals AudioBuffer offline.
     * Slides a 2048-sample window with 512-sample hop across the entire track.
     * Uses pitchy's PitchDetector.findPitch() for each frame.
     *
     * Produces:
     *   - rawPitch: [{ time, pitch }] — every valid frame
     *   - noteBlocks: [{ startTime, endTime, avgPitch, points }] — segmented phrases
     */
    analyzeFullBuffer(audioBuffer) {
        console.log('[PitchProcessor] Starting offline pitch analysis with pitchy...');

        const fileSampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0); // mono
        const numFrames = Math.floor((channelData.length - BUFFER_SIZE) / HOP_SIZE);

        const pitchTrack = [];

        for (let i = 0; i < numFrames; i++) {
            const start = i * HOP_SIZE;
            const frame = channelData.slice(start, start + BUFFER_SIZE);

            const detector = PitchDetector.forFloat32Array(frame.length);
            const [frequency, clarity] = detector.findPitch(frame, fileSampleRate);

            // Apply spec thresholds
            if (clarity < CLARITY_THRESHOLD) continue;
            if (frequency < MIN_FREQ || frequency > MAX_FREQ) continue;

            const timeInSeconds = start / fileSampleRate;
            pitchTrack.push({ time: timeInSeconds, pitch: frequency });
        }

        console.log(`[PitchProcessor] Analysis complete. Found ${pitchTrack.length} pitched frames (${numFrames} total)`);

        // Segment into note blocks for canvas rendering
        const noteBlocks = this.segmentIntoNotes(pitchTrack);
        console.log(`[PitchProcessor] Segmented into ${noteBlocks.length} note blocks.`);

        this.onOriginalPitchReady({ rawPitch: pitchTrack, noteBlocks });
    }

    // ═══════════════════════════════════════════════════════════
    //  Note Segmentation
    // ═══════════════════════════════════════════════════════════

    /**
     * Segment raw pitch data into note blocks.
     * A new note starts when:
     *   - There's a silence gap > 100ms between frames
     *   - The pitch jumps more than a threshold in semitones
     */
    segmentIntoNotes(pitchTrack) {
        if (pitchTrack.length === 0) return [];

        const SILENCE_GAP = 0.10; // seconds
        const SEMITONE_THRESHOLD = 2.0; // semitones for breaking

        const notes = [];
        let currentNote = {
            startTime: pitchTrack[0].time,
            endTime: pitchTrack[0].time,
            pitchSum: pitchTrack[0].pitch,
            pitchCount: 1,
            points: [pitchTrack[0]]
        };

        for (let i = 1; i < pitchTrack.length; i++) {
            const pt = pitchTrack[i];
            const prevPt = pitchTrack[i - 1];
            const avgPitch = currentNote.pitchSum / currentNote.pitchCount;

            const semitones = Math.abs(12 * Math.log2(pt.pitch / avgPitch));
            const timeGap = pt.time - prevPt.time;

            if (timeGap > SILENCE_GAP || semitones > SEMITONE_THRESHOLD) {
                // Close current note
                notes.push({
                    startTime: currentNote.startTime,
                    endTime: currentNote.endTime,
                    avgPitch: currentNote.pitchSum / currentNote.pitchCount,
                    points: currentNote.points
                });

                // Start new note
                currentNote = {
                    startTime: pt.time,
                    endTime: pt.time,
                    pitchSum: pt.pitch,
                    pitchCount: 1,
                    points: [pt]
                };
            } else {
                currentNote.endTime = pt.time;
                currentNote.pitchSum += pt.pitch;
                currentNote.pitchCount++;
                currentNote.points.push(pt);
            }
        }

        // Push final note
        notes.push({
            startTime: currentNote.startTime,
            endTime: currentNote.endTime,
            avgPitch: currentNote.pitchSum / currentNote.pitchCount,
            points: currentNote.points
        });

        // Filter out very short fragments (< 20ms)
        return notes.filter(n => (n.endTime - n.startTime) >= 0.02);
    }

    // ═══════════════════════════════════════════════════════════
    //  Frequency → Canvas Helpers (spec mapping)
    // ═══════════════════════════════════════════════════════════

    /**
     * Convert frequency (Hz) to MIDI note number.
     * Formula: midiNote = 12 * log2(frequency / 440) + 69
     */
    static freqToMidi(freq) {
        return 12 * Math.log2(freq / 440) + 69;
    }

    /**
     * Convert MIDI note to Y position on canvas.
     * C4 (MIDI 60) at bottom, C5 (MIDI 72) at top.
     */
    static midiToCanvasY(midiNote, canvasHeight) {
        const clamped = Math.max(60, Math.min(72, midiNote));
        return canvasHeight - ((clamped - 60) / 12) * canvasHeight;
    }

    /**
     * Convert frequency (Hz) directly to canvas Y position.
     */
    static freqToCanvasY(freq, canvasHeight) {
        const midi = PitchProcessor.freqToMidi(freq);
        return PitchProcessor.midiToCanvasY(midi, canvasHeight);
    }
}
