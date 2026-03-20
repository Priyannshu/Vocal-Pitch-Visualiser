/**
 * PitchProcessor — VOCAL Audio Processing Engine
 *
 * Uses `pitchy` (McLeod Pitch Method) for both offline singer analysis
 * and real-time microphone pitch detection.
 *
 * Key parameters (from spec, tuned for ornamental quality):
 *   Buffer size:  2048 samples
 *   Hop size:     512 samples
 *   Sample rate:  44100 Hz (or actual AudioContext rate)
 *   Clarity:      > 0.5 offline / > 0.88 live (raised from 0.6 to reject noise)
 *   Freq range:   80 Hz – 1200 Hz
 *
 * Fixes applied vs original:
 *   1. LIVE_CLARITY_THRESHOLD raised 0.6 → 0.88 (was accepting too many noisy frames)
 *   2. RMS gate added before findPitch() — silence/breath frames never enter MPM
 *   3. Octave jump guard added — catches MPM harmonic errors between consecutive frames
 *   4. Median filter (5-frame) added — smooths remaining single-frame spikes
 *   5. lastPitch + pitchHistory reset on silence — prevents stale data bleeding into note onsets
 *   6. liveDetector never recreated mid-session — fixed size enforced in initMicDetector
 */

import { PitchDetector } from 'pitchy';

// ── Constants ───────────────────────────────────────────────────────────────────

const BUFFER_SIZE = 2048;
const HOP_SIZE = 512;
const DEFAULT_SAMPLE_RATE = 44100;
const MIN_FREQ = 80;
const MAX_FREQ = 1200;

// Clarity thresholds
const OFFLINE_CLARITY_THRESHOLD = 0.5;   // captures vibrato, meend, harkat frames
const LIVE_CLARITY_THRESHOLD = 0.88;     // raised from 0.6 — rejects uncertain MPM frames

// RMS gate — frames below this are silence/breath, skip MPM entirely
const RMS_THRESHOLD = 0.02;

// Octave jump guard — ratios beyond these are MPM harmonic errors, not real pitch jumps
const OCTAVE_UP_RATIO = 1.9;    // ~1 octave up
const OCTAVE_DOWN_RATIO = 0.52; // ~1 octave down

// Median filter window size for live pitch smoothing
const MEDIAN_WINDOW = 5;

export class PitchProcessor {
    constructor() {
        this.sampleRate = DEFAULT_SAMPLE_RATE;

        // Reusable offline detector — created once, reused for all frames
        this.offlineDetector = null;

        // Reusable live detector — created once in initMicDetector, never recreated
        this.liveDetector = null;

        // Live pitch accumulation
        this.livePitchTrack = [];

        // Smoothing state for live detection
        this.lastPitch = null;
        this.pitchHistory = [];

        // Callback when offline analysis is done
        this.onOriginalPitchReady = () => { };
    }

    /**
     * Initialize mic detector with the actual AudioContext sample rate.
     * Creates the detector once with the fixed BUFFER_SIZE — never recreated mid-session.
     */
    initMicDetector(sampleRate) {
        this.sampleRate = sampleRate;
        // Fix: always use BUFFER_SIZE here so the detector is never recreated mid-session.
        // If your AudioWorklet sends a different buffer size, enforce slicing to BUFFER_SIZE there.
        this.liveDetector = PitchDetector.forFloat32Array(BUFFER_SIZE);
        // Reset smoothing state on (re)init
        this.lastPitch = null;
        this.pitchHistory = [];
    }

    // ═══════════════════════════════════════════════════════════
    //  Real-Time Mic Pitch Detection
    // ═══════════════════════════════════════════════════════════

    /**
     * Detect pitch from a Float32Array buffer (from AudioWorklet or ScriptProcessor).
     *
     * Processing pipeline:
     *   Gate 1 — RMS energy:     silence / breath frames never reach MPM
     *   Gate 2 — findPitch():    MPM detection on clean frames only
     *   Gate 3 — clarity ≥ 0.88: discard frames MPM isn't confident about
     *   Gate 4 — freq range:     80 Hz – 1200 Hz hard clamp
     *   Gate 5 — octave jump:    catch harmonic errors between consecutive frames
     *   Gate 6 — median filter:  smooth remaining single-frame spikes
     *
     * Returns the smoothed frequency if all gates pass, else null.
     */
    detectPitch(float32Array) {
        // Gate 1: RMS energy gate — skip silence and breath frames entirely.
        // Resetting lastPitch and pitchHistory here ensures note onsets start clean.
        const rms = Math.sqrt(
            float32Array.reduce((sum, v) => sum + v * v, 0) / float32Array.length
        );
        if (rms < RMS_THRESHOLD) {
            this.lastPitch = null;
            this.pitchHistory = [];
            return null;
        }

        // Gate 2: run MPM — reuse the fixed-size detector, never recreate mid-session.
        // If the incoming buffer is larger than BUFFER_SIZE, slice it first.
        const buffer = float32Array.length === BUFFER_SIZE
            ? float32Array
            : float32Array.slice(0, BUFFER_SIZE);

        const [frequency, clarity] = this.liveDetector.findPitch(buffer, this.sampleRate);

        // Gate 3: clarity threshold — discard frames MPM isn't confident about.
        // Ornaments (meend, gamak, harkat) are real voiced sounds and score high clarity;
        // this threshold only drops genuinely ambiguous / transitional frames.
        if (clarity < LIVE_CLARITY_THRESHOLD) return null;

        // Gate 4: frequency range hard clamp
        if (frequency < MIN_FREQ || frequency > MAX_FREQ) return null;

        // Gate 5: octave jump guard — consecutive pitch frames shouldn't jump > ~1 octave.
        // MPM sometimes locks onto the wrong harmonic; this catches those errors.
        if (this.lastPitch !== null) {
            const ratio = frequency / this.lastPitch;
            if (ratio > OCTAVE_UP_RATIO || ratio < OCTAVE_DOWN_RATIO) return null;
        }
        this.lastPitch = frequency;

        // Gate 6: median filter — smooths out any remaining single-frame spikes.
        this.pitchHistory.push(frequency);
        if (this.pitchHistory.length > MEDIAN_WINDOW) this.pitchHistory.shift();
        const sorted = [...this.pitchHistory].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    }

    // ═══════════════════════════════════════════════════════════
    //  Live Pitch Accumulation
    // ═══════════════════════════════════════════════════════════

    addLivePitchSample(time, pitch) {
        if (pitch == null) return;
        if (pitch < MIN_FREQ || pitch > MAX_FREQ) return;
        this.livePitchTrack.push({ time, pitch });
    }

    resetLivePitch() {
        this.livePitchTrack = [];
        this.lastPitch = null;
        this.pitchHistory = [];
    }

    // ═══════════════════════════════════════════════════════════
    //  Offline Singer Pitch Analysis (Part 2 of spec)
    // ═══════════════════════════════════════════════════════════

    /**
     * Analyse the full vocals AudioBuffer offline.
     * Slides a 2048-sample window with 512-sample hop across the entire track.
     * Uses pitchy's PitchDetector.findPitch() for each frame.
     *
     * CRITICAL: Reuses a single PitchDetector instance across all frames.
     * Lower clarity threshold (0.5 vs 0.88) to capture ornamental frames.
     */
    analyzeFullBuffer(audioBuffer) {
        console.log('[PitchProcessor] Starting offline pitch analysis with pitchy...');
        console.log(`[PitchProcessor] Clarity threshold: ${OFFLINE_CLARITY_THRESHOLD} (tuned for ornaments)`);

        const fileSampleRate = audioBuffer.sampleRate;
        const channelData = audioBuffer.getChannelData(0); // mono
        const numFrames = Math.floor((channelData.length - BUFFER_SIZE) / HOP_SIZE);

        // Create ONE detector and reuse it for all frames
        this.offlineDetector = PitchDetector.forFloat32Array(BUFFER_SIZE);

        const pitchTrack = [];

        for (let i = 0; i < numFrames; i++) {
            const start = i * HOP_SIZE;
            const frame = channelData.slice(start, start + BUFFER_SIZE);

            const [frequency, clarity] = this.offlineDetector.findPitch(frame, fileSampleRate);

            // Lowered clarity threshold captures vibrato/meend/harkat
            if (clarity < OFFLINE_CLARITY_THRESHOLD) continue;
            if (frequency < MIN_FREQ || frequency > MAX_FREQ) continue;

            const timeInSeconds = start / fileSampleRate;
            pitchTrack.push({ time: timeInSeconds, pitch: frequency });
        }

        console.log(`[PitchProcessor] Analysis complete. ${pitchTrack.length} pitched frames out of ${numFrames} total`);

        // Segment into note blocks for canvas rendering
        const noteBlocks = this.segmentIntoNotes(pitchTrack);
        console.log(`[PitchProcessor] Segmented into ${noteBlocks.length} note blocks.`);

        this.onOriginalPitchReady({ rawPitch: pitchTrack, noteBlocks });
    }

    // ═══════════════════════════════════════════════════════════
    //  Note Segmentation — Tuned for Ornamental Preservation
    // ═══════════════════════════════════════════════════════════

    /**
     * Segment raw pitch data into note blocks.
     * A new note starts when:
     *   - There's a silence gap > 100ms between frames
     *   - The pitch jumps more than 4.0 semitones (raised from 2.0 to keep ornaments intact)
     *
     * Min block duration lowered to 0.01s (from 0.02s) to keep micro-ornaments.
     */
    segmentIntoNotes(pitchTrack) {
        if (pitchTrack.length === 0) return [];

        const SILENCE_GAP = 0.10;           // seconds
        const SEMITONE_THRESHOLD = 4.0;     // raised from 2.0 — keeps gamak/meend in one block
        const MIN_BLOCK_DURATION = 0.01;    // lowered from 0.02 — preserves murki flicks

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

        // Filter out very short fragments
        return notes.filter(n => (n.endTime - n.startTime) >= MIN_BLOCK_DURATION);
    }

    // ═══════════════════════════════════════════════════════════
    //  Frequency → Canvas Helpers (spec mapping)
    // ═══════════════════════════════════════════════════════════

    static freqToMidi(freq) {
        return 12 * Math.log2(freq / 440) + 69;
    }

    static midiToCanvasY(midiNote, canvasHeight) {
        const clamped = Math.max(60, Math.min(72, midiNote));
        return canvasHeight - ((clamped - 60) / 12) * canvasHeight;
    }

    static freqToCanvasY(freq, canvasHeight) {
        const midi = PitchProcessor.freqToMidi(freq);
        return PitchProcessor.midiToCanvasY(midi, canvasHeight);
    }
}