import { YIN } from 'pitchfinder';
import { PitchDetector } from './pitchDetector.js';

export class PitchProcessor {
    constructor() {
        this.sampleRate = 44100;

        this.offlineDetector = YIN({
            sampleRate: this.sampleRate,
            threshold: 0.1
        });

        // High-quality mic detector using our custom NSDF-based PitchDetector
        this.micPitchDetector = new PitchDetector(this.sampleRate, {
            clarityThreshold: 0.15,
            medianWindowSize: 2,  // window=2 catches octave errors while preserving ornamental detail
            bypassSmoothing: false
        });

        // Accumulate raw live pitch points (fed directly to line renderer, no block segmentation)
        this.livePitchTrack = [];

        this.onOriginalPitchReady = () => { };
    }

    initMicDetector(sampleRate) {
        this.sampleRate = sampleRate;
        this.micPitchDetector = new PitchDetector(sampleRate, {
            clarityThreshold: 0.15,
            medianWindowSize: 2,
            bypassSmoothing: false
        });
    }

    /**
     * Detect pitch from mic audio buffer using the high-quality PitchDetector.
     * Returns frequency if confident, else null.
     */
    detectPitch(float32Array) {
        const result = this.micPitchDetector.processRealtime(float32Array);
        
        // Debugging to see what's happening
        if (!this._debugLogTimer) this._debugLogTimer = 0;
        const now = performance.now();
        if (now - this._debugLogTimer > 1000) {
            console.log(`[Mic Debug] RMS: ${result.rms ? result.rms.toFixed(4) : 0}, Conf: ${result.confident}, Clr: ${result.clarity ? result.clarity.toFixed(2) : 0}, Freq: ${result.frequency}`);
            this._debugLogTimer = now;
        }

        // CRITICAL: Must check confident flag, otherwise background noise creates random fast
        // pitch spikes, which fragments notes into < 0.02s shards that get filtered out!
        if (result.confident && result.frequency !== null && result.frequency >= 50 && result.frequency <= 3000) {
            return result.frequency;
        }
        return null;
    }

    /**
     * Accumulate a live pitch sample — raw points feed the line renderer directly.
     * No block segmentation during real-time input (eliminates latency).
     */
    addLivePitchSample(time, pitch) {
        if (pitch === null || pitch === undefined) return;
        if (pitch < 50 || pitch > 2000) return;

        this.livePitchTrack.push({ time, pitch });
    }

    /**
     * Reset live pitch data (on stop/new track).
     */
    resetLivePitch() {
        this.livePitchTrack = [];
        this.micPitchDetector.reset();
    }

    analyzeFullBuffer(audioBuffer) {
        console.log("Starting offline pitch analysis...");

        const fileSampleRate = audioBuffer.sampleRate;

        this.offlineDetector = YIN({
            sampleRate: fileSampleRate,
            threshold: 0.1
        });

        const channelData = audioBuffer.getChannelData(0);
        const windowSize = 2048;
        const stepSize = 512;  // Fine step for capturing vibrato/ornamentations
        const numFrames = Math.floor((channelData.length - windowSize) / stepSize);

        const pitchTrack = [];

        for (let i = 0; i < numFrames; i++) {
            const start = i * stepSize;
            const windowData = channelData.slice(start, start + windowSize);
            let pitch = this.offlineDetector(windowData);

            if (pitch && (pitch < 50 || pitch > 2000)) {
                pitch = null;
            }

            const timeInSeconds = start / fileSampleRate;

            if (pitch) {
                pitchTrack.push({ time: timeInSeconds, pitch: pitch });
            }
        }

        console.log(`Pitch analysis complete. Found ${pitchTrack.length} pitched frames.`);

        const noteBlocks = this.segmentIntoNotes(pitchTrack);
        console.log(`Segmented into ${noteBlocks.length} note blocks.`);

        this.onOriginalPitchReady({ rawPitch: pitchTrack, noteBlocks: noteBlocks });
    }

    /**
     * Compute local pitch variance over a window of points to detect ornamental zones.
     */
    computeLocalVariance(pitchTrack, index, windowSize = 12) {
        const halfWin = Math.floor(windowSize / 2);
        const start = Math.max(0, index - halfWin);
        const end = Math.min(pitchTrack.length, index + halfWin);

        let sum = 0, count = 0;
        for (let i = start; i < end; i++) {
            sum += pitchTrack[i].pitch;
            count++;
        }
        const mean = sum / count;

        let variance = 0;
        for (let i = start; i < end; i++) {
            const diff = 12 * Math.log2(pitchTrack[i].pitch / mean); // in semitones
            variance += diff * diff;
        }
        return variance / count;
    }

    segmentIntoNotes(pitchTrack) {
        if (pitchTrack.length === 0) return [];

        const SILENCE_GAP = 0.10;
        // Adaptive thresholds
        const ORNAMENTAL_SEMITONE_THRESHOLD = 1.0;
        const SUSTAINED_SEMITONE_THRESHOLD = 2.5;
        const ORNAMENTAL_VARIANCE_THRESHOLD = 0.5; // variance in semitones² to classify as ornamental zone

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

            // Adaptive threshold: use local variance to decide
            const localVar = this.computeLocalVariance(pitchTrack, i);
            const isOrnamentalZone = localVar > ORNAMENTAL_VARIANCE_THRESHOLD;
            const threshold = isOrnamentalZone ? ORNAMENTAL_SEMITONE_THRESHOLD : SUSTAINED_SEMITONE_THRESHOLD;

            if (timeGap > SILENCE_GAP || semitones > threshold) {
                notes.push({
                    startTime: currentNote.startTime,
                    endTime: currentNote.endTime,
                    avgPitch: currentNote.pitchSum / currentNote.pitchCount,
                    points: currentNote.points
                });

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

        notes.push({
            startTime: currentNote.startTime,
            endTime: currentNote.endTime,
            avgPitch: currentNote.pitchSum / currentNote.pitchCount,
            points: currentNote.points
        });

        // Post-process: detect glides and ornamental blocks
        const processedNotes = notes
            .filter(n => (n.endTime - n.startTime) >= 0.02)
            .map(note => {
                // Compute pitch std deviation for ornamental detection
                const pitches = note.points.map(p => p.pitch);
                const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
                const stdDev = Math.sqrt(
                    pitches.reduce((sum, p) => sum + Math.pow(12 * Math.log2(p / mean), 2), 0) / pitches.length
                );

                // Detect glide (monotonic pitch change over ≥5 consecutive frames)
                let isGlide = false;
                if (note.points.length >= 5) {
                    let increasing = 0, decreasing = 0;
                    for (let i = 1; i < note.points.length; i++) {
                        if (note.points[i].pitch > note.points[i - 1].pitch) increasing++;
                        else if (note.points[i].pitch < note.points[i - 1].pitch) decreasing++;
                    }
                    const total = note.points.length - 1;
                    // If 80%+ of transitions go in one direction, it's a glide (meend)
                    if (increasing / total >= 0.8 || decreasing / total >= 0.8) {
                        const totalSemitones = Math.abs(12 * Math.log2(
                            note.points[note.points.length - 1].pitch / note.points[0].pitch
                        ));
                        // Only flag as glide if it spans at least 1.5 semitones
                        if (totalSemitones >= 1.5) {
                            isGlide = true;
                        }
                    }
                }

                return {
                    ...note,
                    isOrnamental: stdDev > 0.3,  // high internal variance = ornamental
                    isGlide: isGlide,
                    stdDev: stdDev
                };
            });

        return processedNotes;
    }
}
