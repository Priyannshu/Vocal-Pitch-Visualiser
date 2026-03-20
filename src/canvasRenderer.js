/**
 * CanvasRenderer — VOCAL Pitch Visualiser
 *
 * Renders the pitch canvas in both Live Recording Mode and Post-Recording
 * Review Mode, following the VOCAL_UI_Specifications exactly.
 *
 * Key visual elements:
 *  - Note grid (C4–C5 dashed lines, labels in left margin)
 *  - Singer's reference phrases (faint red-tinted rounded zones with white center line)
 *  - Bezier connections between continuous phrases
 *  - User's sung pitch line (smooth orange quadratic bezier)
 *  - Playhead (orange vertical line + dot) in live mode
 *  - Section dividers and full-width layout in review mode
 */

export class CanvasRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');

        // ── Pitch range ─────────────────────────────────────
        // The spec grid shows C4–C5, but we keep a wider decode range
        // so out-of-range singing is still visible at the edges.
        this.minFreq = 261.63;  // C4
        this.maxFreq = 523.25;  // C5

        // ── Layout margins (spec) ───────────────────────────
        this.LEFT_MARGIN = 44;   // reserved for note labels
        this.RIGHT_MARGIN = 12;
        this.TOP_MARGIN = 12;
        this.BOTTOM_MARGIN = 12;

        // ── Grid notes (top to bottom) ──────────────────────
        this.gridNotes = [
            { name: 'C5', freq: 523.25 },
            { name: 'B4', freq: 493.88 },
            { name: 'A4', freq: 440.00 },
            { name: 'G4', freq: 392.00 },
            { name: 'F4', freq: 349.23 },
            { name: 'E4', freq: 329.63 },
            { name: 'D4', freq: 293.66 },
            { name: 'C4', freq: 261.63 },
        ];

        // ── Time mapping ────────────────────────────────────
        this.pixelsPerSecond = 150;

        // ── Data ────────────────────────────────────────────
        this.noteBlocks = [];       // [{startTime, endTime, avgPitch, points, isContinuous?}]
        this.rawPitchData = [];     // [{time, pitch}]
        this.livePitchData = [];    // [{time, pitch}]

        // ── Mode ────────────────────────────────────────────
        this.mode = 'live';         // 'live' | 'review'
        this.totalDuration = 0;     // set when entering review mode

        // ── Playback state ──────────────────────────────────
        this.currentTime = 0;
        this.isPlaying = false;
        this.animationFrame = null;

        // ── Section labels (for review mode dividers) ───────
        this.sections = ['Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Outro'];

        // ── Line break gap (ms) — gaps longer than this start new segment
        this.LINE_BREAK_GAP = 0.12; // 120ms

        // Bootstrap
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.loop();
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
        this.draw();
    }

    addLivePitch(pitch) {
        if (pitch == null || pitch < 50 || pitch > 2000) return;
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
        // Playhead sits at 20% of plot width
        const playheadX = this.plotLeft + this.plotWidth * 0.2;
        return playheadX + (t - this.currentTime) * this.pixelsPerSecond;
    }

    /** Map time → x position (review mode — full duration across canvas) */
    timeToXReview(t) {
        if (this.totalDuration <= 0) return this.plotLeft;
        const ratio = t / this.totalDuration;
        return this.plotLeft + ratio * this.plotWidth;
    }

    /** Current time→x mapper depending on mode */
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

        // 1. Note grid
        this.drawNoteGrid();

        // 2. Section dividers (review mode only)
        if (this.mode === 'review') {
            this.drawSectionDividers();
        }

        // 3. Singer's reference phrases
        this.drawReferencePhrases();

        // 4. Connections between continuous reference phrases
        this.drawPhraseConnections();

        // 5. User pitch line (orange)
        this.drawUserPitchLine();

        // 6. Playhead (live mode only)
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
            ctx.strokeStyle = 'rgba(255,255,255,0.045)';
            ctx.moveTo(this.plotLeft, y);
            ctx.lineTo(this.plotRight, y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Note label (left margin, right-aligned)
            ctx.fillStyle = 'rgba(255,255,255,0.22)';
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

            // Skip if off-screen
            if (x2 < this.plotLeft - 10 || x1 > this.plotRight + 10) continue;

            const centerY = this.freqToY(block.avgPitch);
            const halfH = this.plotHeight * 0.055; // 5.5% of plot height
            const top = centerY - halfH;
            const width = Math.max(x2 - x1, 2);
            const height = halfH * 2;

            // Zone fill (very faint red tint)
            ctx.fillStyle = 'rgba(239,68,68,0.06)';
            this.roundRect(ctx, x1, top, width, height, 3);
            ctx.fill();

            // Zone border
            ctx.strokeStyle = 'rgba(239,68,68,0.25)';
            ctx.lineWidth = 0.75;
            this.roundRect(ctx, x1, top, width, height, 3);
            ctx.stroke();

            // Center pitch line (solid white)
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.70)';
            ctx.lineWidth = 1.5;
            ctx.moveTo(x1, centerY);
            ctx.lineTo(x1 + width, centerY);
            ctx.stroke();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  4. Connections Between Continuous Phrases
    // ═══════════════════════════════════════════════════════════

    drawPhraseConnections() {
        const ctx = this.ctx;
        const MAX_GAP = 0.12; // seconds — treat as continuous if gap ≤ this

        for (let i = 0; i < this.noteBlocks.length - 1; i++) {
            const curr = this.noteBlocks[i];
            const next = this.noteBlocks[i + 1];
            const gap = next.startTime - curr.endTime;

            // Only connect if no breath gap
            if (gap > MAX_GAP) continue;

            const x1 = this.timeToX(curr.endTime);
            const y1 = this.freqToY(curr.avgPitch);
            const x2 = this.timeToX(next.startTime);
            const y2 = this.freqToY(next.avgPitch);

            // Skip if off-screen
            if (x1 > this.plotRight + 10 && x2 > this.plotRight + 10) continue;
            if (x1 < this.plotLeft - 10 && x2 < this.plotLeft - 10) continue;

            // Solid bezier S-curve
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

        // Split into segments on time gaps > LINE_BREAK_GAP
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

        // Style: smooth orange line, no dots
        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        for (const segment of segments) {
            // Convert to screen coords
            const pts = segment.map(p => ({
                x: this.timeToX(p.time),
                y: this.freqToY(p.pitch)
            }));

            // Skip off-screen segments
            const minX = pts[0].x;
            const maxX = pts[pts.length - 1].x;
            if (maxX < this.plotLeft - 50 || minX > this.plotRight + 50) continue;

            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);

            if (pts.length === 2) {
                ctx.lineTo(pts[1].x, pts[1].y);
            } else {
                // Quadratic bezier midpoint interpolation for smooth curves
                for (let i = 0; i < pts.length - 1; i++) {
                    const midX = (pts[i].x + pts[i + 1].x) / 2;
                    const midY = (pts[i].y + pts[i + 1].y) / 2;
                    if (i === 0) {
                        ctx.lineTo(midX, midY);
                    } else {
                        ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
                    }
                }
                // Final point
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

        // Vertical line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(249,115,22,0.45)';
        ctx.lineWidth = 1;
        ctx.moveTo(x, this.plotTop);
        ctx.lineTo(x, this.plotBottom);
        ctx.stroke();

        // Dot at the top
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
