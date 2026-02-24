import { YIN } from 'pitchfinder';

export class PitchProcessor {
    constructor() {
        this.sampleRate = 44100;

        this.offlineDetector = YIN({
            sampleRate: this.sampleRate,
            threshold: 0.1
        });

        this.micDetector = YIN({
            sampleRate: this.sampleRate,
            threshold: 0.15
        });

        this.onOriginalPitchReady = () => { };
    }

    initMicDetector(sampleRate) {
        this.micDetector = YIN({
            sampleRate: sampleRate,
            threshold: 0.15
        });
    }

    detectPitch(float32Array) {
        const pitch = this.micDetector(float32Array);
        return pitch || null;
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

    segmentIntoNotes(pitchTrack) {
        if (pitchTrack.length === 0) return [];

        const SILENCE_GAP = 0.15;
        const SEMITONE_THRESHOLD = 3;

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

        return notes.filter(n => (n.endTime - n.startTime) >= 0.03);
    }
}
