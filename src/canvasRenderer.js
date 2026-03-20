/**
 * CanvasRenderer — VOCAL Pitch Visualiser
 *
 * Renders the pitch canvas in both Live Recording Mode and Post-Recording
 * Review Mode, following the VOCAL_UI_Specifications.
 *
 * Key visual elements:
 *  - Note grid with dashed lines and left-margin labels
 *  - Singer's reference phrases (faint red-tinted rounded zones with white center line)
 *  - Bezier connections between continuous phrases
 *  - User's sung pitch line (smooth orange quadratic bezier)
 *  - Playhead (orange vertical line + dot) in live mode
 *  - Section dividers and full-width layout in review mode
 *
 * AUTO-ADAPTIVE PITCH RANGE:
 *  - Default range: C2 (65 Hz) to C6 (1047 Hz) — 4 octaves
 *  - When pitch data arrives, range adapts to actual data ± 3 semitone padding
 *  - Grid labels shown at all semitone lines for visible notes
 */

export class CanvasRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');

        // ── Default pitch range (expanded from C4–C5 to C2–C6) ──
        this.minFreq = 65.41;    // C2
        this.maxFreq = 1046.50;  // C6

        // ── Layout margins ──────────────────────────────────
        this.LEFT_MARGIN = 44;
        this.RIGHT_MARGIN = 12;
        this.TOP_MARGIN = 12;
        this.BOTTOM_MARGIN = 12;

        // ── All note names and frequencies for grid ─────────
        this.ALL_NOTES = this._buildNoteTable();

        // ── Currently visible grid notes (rebuilt on range change) ──
        this.gridNotes = this._computeGridNotes();

        // ── Time mapping ────────────────────────────────────
        this.pixelsPerSecond = 150;

        // ── Data ────────────────────────────────────────────
        this.noteBlocks = [];
        this.rawPitchData = [];
        this.livePitchData = [];

        // ── Mode ────────────────────────────────────────────
        this.mode = 'live';
        this.totalDuration = 0;

        // ── Playback state ──────────────────────────────────
        this.currentTime = 0;
        this.isPlaying = false;
        this.animationFrame = null;

        // ── Section labels ──────────────────────────────────
        this.sections = ['Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Outro'];

        // ── Line break gap ──────────────────────────────────
        this.LINE_BREAK_GAP = 0.12;

        // Bootstrap
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.loop();
    }

    // ═══════════════════════════════════════════════════════════
    //  Note Table — all chromatic notes from C1 to C7
    // ═══════════════════════════════════════════════════════════

    _buildNoteTable() {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const notes = [];

        // MIDI 24 (C1) to MIDI 96 (C7)
        for (let midi = 24; midi <= 96; midi++) {
            const octave = Math.floor((midi - 12) / 12);
            const noteIndex = midi % 12;
            const name = noteNames[noteIndex] + octave;
            const freq = 440 * Math.pow(2, (midi - 69) / 12);
            notes.push({ midi, name, freq });
        }

        return notes;
    }

    // ═══════════════════════════════════════════════════════════
    //  Compute visible grid notes based on current range
    // ═══════════════════════════════════════════════════════════

    _computeGridNotes() {
        // Filter notes within the current frequency range
        const visible = this.ALL_NOTES.filter(
            n => n.freq >= this.minFreq * 0.95 && n.freq <= this.maxFreq * 1.05
        );

        // Decide label density based on how many notes are visible
        const rangeInSemitones = 12 * Math.log2(this.maxFreq / this.minFreq);

        if (rangeInSemitones <= 14) {
            // Narrow range: show all notes
            return visible;
        } else if (rangeInSemitones <= 26) {
            // Medium range (~2 octaves): show naturals only (no sharps)
            return visible.filter(n => !n.name.includes('#'));
        } else {
            // Wide range (3+ octaves): show only C and key notes (C, E, G, A)
            return visible.filter(n => {
                const noteLetter = n.name.replace(/[0-9]/g, '');
                return ['C', 'E', 'G', 'A'].includes(noteLetter);
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  Auto-Adaptive Range — fit to actual pitch data
    // ═══════════════════════════════════════════════════════════

    _adaptRangeToData() {
        // Collect all frequencies from raw pitch data and note blocks
        const allFreqs = [];

        for (const p of this.rawPitchData) {
            allFreqs.push(p.pitch);
        }
        for (const b of this.noteBlocks) {
            allFreqs.push(b.avgPitch);
            if (b.points) {
                for (const pt of b.points) {
                    allFreqs.push(pt.pitch);
                }
            }
        }

        if (allFreqs.length === 0) return;

        // Find actual min/max
        let dataMin = Infinity, dataMax = -Infinity;
        for (const f of allFreqs) {
            if (f < dataMin) dataMin = f;
            if (f > dataMax) dataMax = f;
        }

        // Add 3 semitones of padding on each side
        const padSemitones = 3;
        const paddedMin = dataMin * Math.pow(2, -padSemitones / 12);
        const paddedMax = dataMax * Math.pow(2, padSemitones / 12);

        // Snap to nearest octave boundary for clean grid lines
        // but don't exceed our absolute limits
        this.minFreq = Math.max(32.70, paddedMin);   // C1 floor
        this.maxFreq = Math.min(2093.00, paddedMax);  // C7 ceiling

        // Ensure at least 1 octave range
        if (this.maxFreq / this.minFreq < 2) {
            const center = Math.sqrt(this.minFreq * this.maxFreq);
            this.minFreq = center / Math.SQRT2;
            this.maxFreq = center * Math.SQRT2;
        }

        // Rebuild grid notes for the new range
        this.gridNotes = this._computeGridNotes();

        console.log(`[Canvas] Adapted range: ${this.minFreq.toFixed(1)} Hz – ${this.maxFreq.toFixed(1)} Hz`);
    }

    // ═══════════════════════════════════════════════════════════
    //  Sizing
    // ═══════════════════════════════════════════════════════════

    resize() {
        const parent = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        const rect = parent.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.cssWidth = rect.width;
        this.cssHeight = rect.height;
        this.plotLeft = this.LEFT_MARGIN;
        this.plotRight = this.cssWidth - this.RIGHT_MARGIN;
        this.plotTop = this.TOP_MARGIN;
        this.plotBottom = this.cssHeight - this.BOTTOM_MARGIN;
        this.plotWidth = this.plotRight - this.plotLeft;
        this.plotHeight = this.plotBottom - this.plotTop;
        this.draw();
    }

    // ═══════════════════════════════════════════════════════════
    //  Data Setters
    // ═══════════════════════════════════════════════════════════

    setOriginalPitchData(data) {
        this.rawPitchData = data.rawPitch || [];
        this.noteBlocks = data.noteBlocks || [];
        this.livePitchData = [];

        // Auto-adapt canvas range to the actual pitch data
        this._adaptRangeToData();

        this.draw();
    }

    addLivePitch(pitch) {
        if (pitch == null || pitch < 30 || pitch > 3000) return;
        this.livePitchData.push({ time: this.currentTime, pitch });
    }

    setCurrentTime(time) {
        this.currentTime = time;
        if (!this.isPlaying) this.draw();
    }

    setMode(mode, totalDuration) {
        this.mode = mode;
        if (mode === 'review' && totalDuration) {
            this.totalDuration = totalDuration;
        }
        this.draw();
    }

    start() {
        this.isPlaying = true;
        if (!this.animationFrame) this.loop();
    }

    stop() {
        this.isPlaying = false;
    }

    // ═══════════════════════════════════════════════════════════
    //  Coordinate Helpers
    // ═══════════════════════════════════════════════════════════

    /** Map frequency → y position within the plot area (log scale) */
    freqToY(freq) {
        if (!freq) return this.plotBottom;
        const minLog = Math.log2(this.minFreq);
        const maxLog = Math.log2(this.maxFreq);
        const valLog = Math.log2(Math.max(this.minFreq, Math.min(this.maxFreq, freq)));
        const ratio = (valLog - minLog) / (maxLog - minLog);
        return this.plotBottom - (ratio * this.plotHeight);
    }

    /** Map time → x position (live scrolling mode) */
    timeToXLive(t) {
        const playheadX = this.plotLeft + this.plotWidth * 0.2;
        return playheadX + (t - this.currentTime) * this.pixelsPerSecond;
    }

    /** Map time → x position (review mode) */
    timeToXReview(t) {
        if (this.totalDuration <= 0) return this.plotLeft;
        const ratio = t / this.totalDuration;
        return this.plotLeft + ratio * this.plotWidth;
    }

    timeToX(t) {
        return this.mode === 'review' ? this.timeToXReview(t) : this.timeToXLive(t);
    }

    // ═══════════════════════════════════════════════════════════
    //  Animation Loop
    // ═══════════════════════════════════════════════════════════

    loop() {
        this.draw();
        this.animationFrame = requestAnimationFrame(() => this.loop());
    }

    // ═══════════════════════════════════════════════════════════
    //  Main Draw
    // ═══════════════════════════════════════════════════════════

    draw() {
        const ctx = this.ctx;
        const W = this.cssWidth;
        const H = this.cssHeight;
        if (!W || !H) return;

        ctx.clearRect(0, 0, W, H);

        this.drawNoteGrid();

        if (this.mode === 'review') {
            this.drawSectionDividers();
        }

        this.drawReferencePhrases();
        this.drawPhraseConnections();
        this.drawUserPitchLine();

        if (this.mode === 'live') {
            this.drawPlayhead();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  1. Note Grid
    // ═══════════════════════════════════════════════════════════

    drawNoteGrid() {
        const ctx = this.ctx;

        for (const note of this.gridNotes) {
            const y = this.freqToY(note.freq);

            // Dashed grid line
            ctx.beginPath();
            ctx.setLineDash([3, 6]);
            ctx.lineWidth = 0.5;
            // Octave C notes get a slightly brighter line
            const isOctaveC = note.name.startsWith('C') && !note.name.includes('#');
            ctx.strokeStyle = isOctaveC ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.035)';
            ctx.moveTo(this.plotLeft, y);
            ctx.lineTo(this.plotRight, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Note label
            ctx.fillStyle = isOctaveC ? 'rgba(255,255,255,0.30)' : 'rgba(255,255,255,0.18)';
            ctx.font = '10px Inter, system-ui, sans-serif';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(note.name, this.LEFT_MARGIN - 6, y);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  2. Section Dividers (Review Mode)
    // ═══════════════════════════════════════════════════════════

    drawSectionDividers() {
        const ctx = this.ctx;
        const numSections = this.sections.length;

        for (let i = 1; i < numSections; i++) {
            const x = this.plotLeft + (i / numSections) * this.plotWidth;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 0.5;
            ctx.moveTo(x, this.plotTop);
            ctx.lineTo(x, this.plotBottom);
            ctx.stroke();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  3. Singer's Reference Phrases (White Blocks)
    // ═══════════════════════════════════════════════════════════

    drawReferencePhrases() {
        const ctx = this.ctx;

        for (const block of this.noteBlocks) {
            const x1 = this.timeToX(block.startTime);
            const x2 = this.timeToX(block.endTime);

            if (x2 < this.plotLeft - 10 || x1 > this.plotRight + 10) continue;

            const centerY = this.freqToY(block.avgPitch);
            const halfH = this.plotHeight * 0.04; // slightly narrower zones
            const top = centerY - halfH;
            const width = Math.max(x2 - x1, 2);
            const height = halfH * 2;

            // Zone fill
            ctx.fillStyle = 'rgba(239,68,68,0.06)';
            this.roundRect(ctx, x1, top, width, height, 3);
            ctx.fill();

            // Zone border
            ctx.strokeStyle = 'rgba(239,68,68,0.25)';
            ctx.lineWidth = 0.75;
            this.roundRect(ctx, x1, top, width, height, 3);
            ctx.stroke();

            // Draw the actual pitch contour within this block (shows vibrato/meend)
            if (block.points && block.points.length >= 2) {
                this._drawPhraseContour(block.points);
            } else {
                // Fallback: straight center line
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(255,255,255,0.70)';
                ctx.lineWidth = 1.5;
                ctx.moveTo(x1, centerY);
                ctx.lineTo(x1 + width, centerY);
                ctx.stroke();
            }
        }
    }

    /**
     * Draw the actual pitch contour within a phrase block.
     * This is what makes vibrato, meend, and harkat visible —
     * instead of a flat center line, we draw the real frequency curve.
     */
    _drawPhraseContour(points) {
        const ctx = this.ctx;

        const pts = points.map(p => ({
            x: this.timeToX(p.time),
            y: this.freqToY(p.pitch)
        }));

        // Skip off-screen
        if (pts[pts.length - 1].x < this.plotLeft - 50 || pts[0].x > this.plotRight + 50) return;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        ctx.moveTo(pts[0].x, pts[0].y);

        if (pts.length === 2) {
            ctx.lineTo(pts[1].x, pts[1].y);
        } else {
            // Smooth quadratic bezier through midpoints
            for (let i = 0; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) / 2;
                const midY = (pts[i].y + pts[i + 1].y) / 2;
                if (i === 0) {
                    ctx.lineTo(midX, midY);
                } else {
                    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
                }
            }
            const last = pts[pts.length - 1];
            const secondLast = pts[pts.length - 2];
            ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
        }

        ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════════
    //  4. Connections Between Continuous Phrases
    // ═══════════════════════════════════════════════════════════

    drawPhraseConnections() {
        const ctx = this.ctx;
        const MAX_GAP = 0.12;

        for (let i = 0; i < this.noteBlocks.length - 1; i++) {
            const curr = this.noteBlocks[i];
            const next = this.noteBlocks[i + 1];
            const gap = next.startTime - curr.endTime;

            if (gap > MAX_GAP) continue;

            const x1 = this.timeToX(curr.endTime);
            const y1 = this.freqToY(curr.avgPitch);
            const x2 = this.timeToX(next.startTime);
            const y2 = this.freqToY(next.avgPitch);

            if (x1 > this.plotRight + 10 && x2 > this.plotRight + 10) continue;
            if (x1 < this.plotLeft - 10 && x2 < this.plotLeft - 10) continue;

            const midX = (x1 + x2) / 2;
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.20)';
            ctx.lineWidth = 1;
            ctx.moveTo(x1, y1);
            ctx.bezierCurveTo(midX, y1, midX, y2, x2, y2);
            ctx.stroke();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  5. User's Sung Pitch Line (Orange)
    // ═══════════════════════════════════════════════════════════

    drawUserPitchLine() {
        const data = this.livePitchData;
        if (data.length < 2) return;

        const ctx = this.ctx;

        const segments = [];
        let seg = [data[0]];

        for (let i = 1; i < data.length; i++) {
            if (data[i].time - data[i - 1].time > this.LINE_BREAK_GAP) {
                if (seg.length >= 2) segments.push(seg);
                seg = [data[i]];
            } else {
                seg.push(data[i]);
            }
        }
        if (seg.length >= 2) segments.push(seg);

        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (const segment of segments) {
            const pts = segment.map(p => ({
                x: this.timeToX(p.time),
                y: this.freqToY(p.pitch)
            }));

            const minX = pts[0].x;
            const maxX = pts[pts.length - 1].x;
            if (maxX < this.plotLeft - 50 || minX > this.plotRight + 50) continue;

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);

            if (pts.length === 2) {
                ctx.lineTo(pts[1].x, pts[1].y);
            } else {
                for (let i = 0; i < pts.length - 1; i++) {
                    const midX = (pts[i].x + pts[i + 1].x) / 2;
                    const midY = (pts[i].y + pts[i + 1].y) / 2;
                    if (i === 0) {
                        ctx.lineTo(midX, midY);
                    } else {
                        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
                    }
                }
                const last = pts[pts.length - 1];
                const secondLast = pts[pts.length - 2];
                ctx.quadraticCurveTo(secondLast.x, secondLast.y, last.x, last.y);
            }

            ctx.stroke();
        }

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════
    //  6. Playhead (Live Mode)
    // ═══════════════════════════════════════════════════════════

    drawPlayhead() {
        const ctx = this.ctx;
        const x = this.plotLeft + this.plotWidth * 0.2;

        ctx.beginPath();
        ctx.strokeStyle = 'rgba(249,115,22,0.45)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, this.plotTop);
        ctx.lineTo(x, this.plotBottom);
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = '#f97316';
        ctx.arc(x, this.plotTop, 3, 0, Math.PI * 2);
        ctx.fill();
    }

    // ═══════════════════════════════════════════════════════════
    //  Utility: Rounded Rectangle Path
    // ═══════════════════════════════════════════════════════════

    roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, h / 2, w / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
    }
}
