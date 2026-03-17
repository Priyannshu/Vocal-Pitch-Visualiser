export class CanvasRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');

        // Pitch configuration
        this.minFreq = 65.41;   // C2
        this.maxFreq = 1046.50; // C6

        // UI mapping
        this.pixelsPerSecond = 150;

        // State
        this.noteBlocks = [];       // [{startTime, endTime, avgPitch, points}]
        this.rawPitchData = [];     // [{time, pitch}]
        this.livePitchData = [];    // [{time, pitch}]

        this.currentTime = 0;
        this.isPlaying = false;
        this.animationFrame = null;

        // Colors
        this.unplayedColor = '#ff9800';         // Warm orange for upcoming blocks
        this.playedColor = '#4caf50';           // Green for passed blocks
        this.unplayedGlow = 'rgba(255, 152, 0, 0.5)';
        this.playedGlow = 'rgba(76, 175, 80, 0.5)';
        this.connectorColor = 'rgba(255, 152, 0, 0.35)';
        this.userLineColor = '#22d3ee';          // Cyan/teal for user pitch line
        this.userLineGlow = 'rgba(34, 211, 238, 0.5)';

        // Line break threshold (ms) — gaps longer than this start a new line segment
        this.LINE_BREAK_GAP = 0.12; // 120ms — tight enough to preserve fast harkat connections

        // Handle resizing
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupNoteLabels();

        // Start rendering loop immediately (it handles its own state)
        this.loop();
    }

    resize() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.width = this.canvas.width;
        this.height = this.canvas.height;
        this.playheadX = this.width * 0.2;
        this.setupNoteLabels();
        this.draw();
    }

    setupNoteLabels() {
        const container = document.getElementById('pitch-labels');
        if (!container) return;
        container.innerHTML = '';

        const notes = [
            { name: 'C6', freq: 1046.50 },
            { name: 'A5', freq: 880.00 },
            { name: 'G5', freq: 783.99 },
            { name: 'E5', freq: 659.25 },
            { name: 'C5', freq: 523.25 },
            { name: 'A4', freq: 440.00 },
            { name: 'G4', freq: 392.00 },
            { name: 'E4', freq: 329.63 },
            { name: 'C4', freq: 261.63 },
            { name: 'A3', freq: 220.00 },
            { name: 'G3', freq: 196.00 },
            { name: 'E3', freq: 164.81 },
            { name: 'C3', freq: 130.81 },
            { name: 'A2', freq: 110.00 },
            { name: 'G2', freq: 98.00 },
            { name: 'E2', freq: 82.41 },
            { name: 'C2', freq: 65.41 }
        ];

        this.gridNotes = notes;

        notes.forEach(note => {
            const y = this.freqToY(note.freq);
            const el = document.createElement('div');
            el.className = 'pitch-label';
            el.textContent = note.name;
            el.style.top = `${y}px`;
            container.appendChild(el);
        });
    }

    setOriginalPitchData(data) {
        // data = {rawPitch: [...], noteBlocks: [...]}
        this.rawPitchData = data.rawPitch || [];
        this.noteBlocks = data.noteBlocks || [];
        this.livePitchData = [];
        this.draw();
    }

    addLivePitch(pitch) {
        if (pitch === null || pitch === undefined) return;
        if (pitch < 50 || pitch > 2000) return;
        this.livePitchData.push({
            time: this.currentTime,
            pitch: pitch
        });
    }



    setCurrentTime(time) {
        this.currentTime = time;
        if (!this.isPlaying) {
            // Force a draw frame if time is updated while paused
            this.draw();
        }
    }

    start() {
        this.isPlaying = true;
        if (!this.animationFrame) {
            this.loop();
        }
    }

    stop() {
        this.isPlaying = false;
        // Do NOT stop the animation frame here, otherwise live mic data stops rendering
        // when the song is paused!
    }

    loop() {
        this.draw();
        // Always continue the loop so live mic updates are visible immediately
        this.animationFrame = requestAnimationFrame(() => this.loop());
    }

    freqToY(freq) {
        if (!freq || freq < this.minFreq) return this.height;
        if (freq > this.maxFreq) return 0;
        const minLog = Math.log2(this.minFreq);
        const maxLog = Math.log2(this.maxFreq);
        const valLog = Math.log2(freq);
        const ratio = (valLog - minLog) / (maxLog - minLog);
        return this.height - (ratio * this.height);
    }

    timeToX(t) {
        const timeDiff = t - this.currentTime;
        return this.playheadX + (timeDiff * this.pixelsPerSecond);
    }

    /**
     * Draw a rounded rectangle (pill shape for note blocks)
     */
    drawRoundedRect(x, y, w, h, radius) {
        const r = Math.min(radius, h / 2, w / 2);
        this.ctx.beginPath();
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.arcTo(x + w, y, x + w, y + r, r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.arcTo(x, y + h, x, y + h - r, r);
        this.ctx.lineTo(x, y + r);
        this.ctx.arcTo(x, y, x + r, y, r);
        this.ctx.closePath();
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);

        const visibleTimeStart = this.currentTime - (this.playheadX / this.pixelsPerSecond);
        const visibleTimeEnd = this.currentTime + ((this.width - this.playheadX) / this.pixelsPerSecond);

        // 1. Draw grid lines
        if (this.gridNotes) {
            this.ctx.lineWidth = 1;
            this.gridNotes.forEach(note => {
                const y = this.freqToY(note.freq);
                this.ctx.beginPath();
                this.ctx.moveTo(0, y);
                this.ctx.lineTo(this.width, y);
                this.ctx.strokeStyle = note.name.startsWith('C')
                    ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)';
                this.ctx.stroke();
            });
        }

        // 2. Draw smart connectors between consecutive blocks
        if (this.noteBlocks.length > 1) {
            const MAX_TIME_GAP = 0.12;     // seconds — skip connector if time gap > this
            const MAX_SEMITONE_JUMP = 6;   // skip connector entirely above this
            const MEDIUM_SEMITONE_JUMP = 4; // dashed line for 4–6 semitones

            for (let i = 0; i < this.noteBlocks.length - 1; i++) {
                const curr = this.noteBlocks[i];
                const next = this.noteBlocks[i + 1];

                // Skip off-screen pairs
                if (curr.endTime < visibleTimeStart - 1 && next.startTime < visibleTimeStart - 1) continue;
                if (curr.startTime > visibleTimeEnd + 1) break;

                const timeGap = next.startTime - curr.endTime;
                if (timeGap > MAX_TIME_GAP) continue;

                // Calculate pitch distance in semitones
                const semitoneDist = Math.abs(12 * Math.log2(next.avgPitch / curr.avgPitch));
                if (semitoneDist > MAX_SEMITONE_JUMP) continue;

                const x1 = this.timeToX(curr.endTime);
                const y1 = this.freqToY(curr.avgPitch);
                const x2 = this.timeToX(next.startTime);
                const y2 = this.freqToY(next.avgPitch);

                // Opacity based on both pitch distance and time gap
                const pitchFactor = 1 - (semitoneDist / MAX_SEMITONE_JUMP);
                const timeFactor = 1 - (timeGap / MAX_TIME_GAP);
                const opacity = Math.max(0.12, pitchFactor * timeFactor * 0.5);

                this.ctx.beginPath();
                this.ctx.lineWidth = 1.8;

                if (semitoneDist > MEDIUM_SEMITONE_JUMP) {
                    // Medium jump: dashed diagonal to show "intentional leap"
                    this.ctx.setLineDash([3, 4]);
                    this.ctx.strokeStyle = `rgba(255, 180, 40, ${opacity * 0.9})`;
                    this.ctx.moveTo(x1, y1);
                    this.ctx.lineTo(x2, y2);
                } else {
                    // Small jump: smooth bezier curve
                    this.ctx.setLineDash([]);
                    this.ctx.strokeStyle = `rgba(255, 180, 40, ${opacity})`;
                    const midX = (x1 + x2) / 2;
                    this.ctx.moveTo(x1, y1);
                    this.ctx.quadraticCurveTo(midX, y1, x2, y2);
                }
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }
        }

        // 3. Draw note blocks with duration-scaled heights, ornamental accents, and glide arcs
        for (const block of this.noteBlocks) {
            if (block.endTime < visibleTimeStart - 1) continue;
            if (block.startTime > visibleTimeEnd + 1) break;

            const x = this.timeToX(block.startTime);
            const blockWidth = (block.endTime - block.startTime) * this.pixelsPerSecond;
            const w = Math.max(blockWidth, 4);

            // Duration-scaled block height: 10px (short ornamental) to 20px (sustained)
            const duration = block.endTime - block.startTime;
            const dynamicHeight = Math.min(20, Math.max(10, 10 + (duration * 20)));
            const bh = dynamicHeight;

            const y = this.freqToY(block.avgPitch) - bh / 2;

            // Determine play status
            const isPlayed = block.endTime <= this.currentTime;
            const isPartiallyPlayed = block.startTime <= this.currentTime && block.endTime > this.currentTime;

            // Check if this is a glide block — render as a smooth arc
            if (block.isGlide && block.points && block.points.length >= 3) {
                this.drawGlideArc(block, x, w, bh, isPlayed, isPartiallyPlayed, visibleTimeStart, visibleTimeEnd);
                continue;
            }

            if (isPartiallyPlayed) {
                const playedWidth = (this.currentTime - block.startTime) * this.pixelsPerSecond;
                const unplayedWidth = w - playedWidth;

                // Played portion
                this.ctx.save();
                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = this.playedGlow;
                this.ctx.fillStyle = this.playedColor;
                this.drawRoundedRect(x, y, Math.max(playedWidth, 2), bh, 4);
                this.ctx.fill();
                this.ctx.restore();

                // Unplayed portion
                this.ctx.save();
                this.ctx.shadowBlur = 6;
                this.ctx.shadowColor = this.unplayedGlow;
                this.ctx.fillStyle = this.unplayedColor;
                this.drawRoundedRect(x + playedWidth, y, Math.max(unplayedWidth, 2), bh, 4);
                this.ctx.fill();
                this.ctx.restore();
            } else {
                const color = isPlayed ? this.playedColor : this.unplayedColor;
                const glow = isPlayed ? this.playedGlow : this.unplayedGlow;

                this.ctx.save();
                this.ctx.shadowBlur = isPlayed ? 4 : 6;
                this.ctx.shadowColor = glow;
                this.ctx.fillStyle = color;
                this.drawRoundedRect(x, y, w, bh, 4);
                this.ctx.fill();
                this.ctx.restore();
            }

            // Ornamental accent: bright left-stripe for ornamental blocks
            if (block.isOrnamental && w > 6) {
                this.ctx.save();
                this.ctx.fillStyle = 'rgba(255, 235, 59, 0.7)'; // bright yellow accent
                const stripeWidth = Math.min(3, w * 0.1);
                this.drawRoundedRect(x, y, stripeWidth, bh, 2);
                this.ctx.fill();
                this.ctx.restore();
            }

            // 3b. Draw raw pitch detail line INSIDE the block (enhanced)
            if (block.points && block.points.length > 1 && w > 6) {
                this.drawInnerPitchDetail(block, x, y, w, bh);
            }
        }

        // 4. Draw user vocal pitch line
        this.drawUserPitchLine(visibleTimeStart, visibleTimeEnd);

        // 5. Draw playhead line
        this.ctx.beginPath();
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.moveTo(this.playheadX, 0);
        this.ctx.lineTo(this.playheadX, this.height);
        this.ctx.stroke();
    }

    /**
     * Draw a glide (meend) block as a smooth curved arc instead of a flat rectangle.
     */
    drawGlideArc(block, x, w, bh, isPlayed, isPartiallyPlayed) {
        const startY = this.freqToY(block.points[0].pitch);
        const endY = this.freqToY(block.points[block.points.length - 1].pitch);
        const color = isPlayed ? this.playedColor : this.unplayedColor;
        const glow = isPlayed ? this.playedGlow : this.unplayedGlow;

        // Draw a thick, smooth bezier arc for the glide
        this.ctx.save();
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = glow;
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = bh * 0.6;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.globalAlpha = 0.85;

        this.ctx.beginPath();

        // Draw through actual pitch points for fidelity
        if (block.points.length > 2) {
            const firstX = this.timeToX(block.points[0].time);
            const firstY = this.freqToY(block.points[0].pitch);
            this.ctx.moveTo(firstX, firstY);

            // Use cardinal spline approximation for smoothness
            for (let i = 1; i < block.points.length; i++) {
                const px = this.timeToX(block.points[i].time);
                const py = this.freqToY(block.points[i].pitch);

                if (i === 1) {
                    this.ctx.lineTo(px, py);
                } else {
                    const prevX = this.timeToX(block.points[i - 1].time);
                    const prevY = this.freqToY(block.points[i - 1].pitch);
                    const cpX = (prevX + px) / 2;
                    this.ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + py) / 2);
                }
            }
            // Final point
            const lastPt = block.points[block.points.length - 1];
            this.ctx.lineTo(this.timeToX(lastPt.time), this.freqToY(lastPt.pitch));
        } else {
            this.ctx.moveTo(x, startY);
            const midX = x + w / 2;
            this.ctx.quadraticCurveTo(midX, startY, x + w, endY);
        }

        this.ctx.stroke();
        this.ctx.restore();

        // Partial play overlay
        if (isPartiallyPlayed) {
            const playedWidth = (this.currentTime - block.startTime) * this.pixelsPerSecond;
            this.ctx.save();
            this.ctx.beginPath();
            this.ctx.rect(x, 0, playedWidth, this.height);
            this.ctx.clip();

            this.ctx.strokeStyle = this.playedColor;
            this.ctx.lineWidth = bh * 0.6;
            this.ctx.lineCap = 'round';
            this.ctx.globalAlpha = 0.85;
            this.ctx.shadowBlur = 8;
            this.ctx.shadowColor = this.playedGlow;

            this.ctx.beginPath();
            const firstX = this.timeToX(block.points[0].time);
            const firstY = this.freqToY(block.points[0].pitch);
            this.ctx.moveTo(firstX, firstY);
            for (let i = 1; i < block.points.length; i++) {
                const px = this.timeToX(block.points[i].time);
                const py = this.freqToY(block.points[i].pitch);
                this.ctx.lineTo(px, py);
            }
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    /**
     * Draw enhanced inner pitch detail line with gradient fill.
     * Vibrato is rendered with maximum amplitude and crisp strokes.
     */
    drawInnerPitchDetail(block, x, y, w, bh, strokeColor = 'rgba(0, 0, 0, 0.92)', gradientTop = 'rgba(0, 0, 0, 0.3)') {
        // Find the pitch range within this block
        let minP = Infinity, maxP = -Infinity;
        for (const p of block.points) {
            if (p.pitch < minP) minP = p.pitch;
            if (p.pitch > maxP) maxP = p.pitch;
        }

        // Use QUARTER-semitone range — maximally amplifies vibrato and subtle pitch changes
        const avgP = block.avgPitch;
        const quarterSemitoneRange = avgP * (Math.pow(2, 0.25 / 12) - 1);
        const actualRange = maxP - minP;
        let displayMin, displayMax;
        if (actualRange < quarterSemitoneRange * 2) {
            // Expand to at least ±0.25 semitone — amplifies even micro-vibrato
            displayMin = avgP - quarterSemitoneRange;
            displayMax = avgP + quarterSemitoneRange;
        } else {
            // Add 5% padding to actual range — keep it tight for maximum amplitude
            const pad = actualRange * 0.05;
            displayMin = minP - pad;
            displayMax = maxP + pad;
        }
        const displayRange = displayMax - displayMin;

        const innerTop = y + 1;
        const innerHeight = bh - 2;

        this.ctx.save();
        // Clip to the block shape
        this.drawRoundedRect(x, y, w, bh, 4);
        this.ctx.clip();

        // Build the path points
        const pathPoints = [];
        for (const p of block.points) {
            const px = this.timeToX(p.time);
            const ratio = (p.pitch - displayMin) / displayRange;
            const clamped = Math.max(0, Math.min(1, ratio));
            const py = innerTop + innerHeight - (clamped * innerHeight);
            pathPoints.push({ x: px, y: py });
        }

        if (pathPoints.length > 1) {
            // Draw gradient fill under the detail curve
            this.ctx.beginPath();
            this.ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
            for (let i = 1; i < pathPoints.length; i++) {
                this.ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
            }
            this.ctx.lineTo(pathPoints[pathPoints.length - 1].x, y + bh);
            this.ctx.lineTo(pathPoints[0].x, y + bh);
            this.ctx.closePath();

            const gradient = this.ctx.createLinearGradient(0, y, 0, y + bh);
            gradient.addColorStop(0, gradientTop);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0.02)');
            this.ctx.fillStyle = gradient;
            this.ctx.fill();

            // Draw the detail stroke — CRISP and SHARP
            this.ctx.beginPath();
            this.ctx.strokeStyle = strokeColor;
            this.ctx.lineWidth = 2.2;
            this.ctx.lineJoin = 'miter';  // sharp corners for crisp vibrato peaks
            this.ctx.lineCap = 'butt';

            this.ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
            for (let i = 1; i < pathPoints.length; i++) {
                this.ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
            }
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    /**
     * Catmull-Rom spline interpolation helper.
     * Returns the interpolated point on the spline for parameter t (0–1)
     * between points p1 and p2, using p0 and p3 as surrounding context.
     * alpha = 0.5 for centripetal Catmull-Rom (avoids cusps and self-intersections).
     */
    catmullRom(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        return {
            x: 0.5 * ((2 * p1.x) +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
            y: 0.5 * ((2 * p1.y) +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        };
    }

    /**
     * Draw user vocal pitch as a smooth continuous Catmull-Rom spline line.
     * Breaks the line on gaps > LINE_BREAK_GAP to handle stop-mid-phrase cleanly.
     */
    drawUserPitchLine(visibleTimeStart, visibleTimeEnd) {
        const data = this.livePitchData;
        if (data.length < 2) return;

        // Split data into segments (break on time gaps > LINE_BREAK_GAP)
        const segments = [];
        let currentSegment = [data[0]];

        for (let i = 1; i < data.length; i++) {
            const gap = data[i].time - data[i - 1].time;
            if (gap > this.LINE_BREAK_GAP) {
                if (currentSegment.length >= 2) {
                    segments.push(currentSegment);
                }
                currentSegment = [data[i]];
            } else {
                currentSegment.push(data[i]);
            }
        }
        if (currentSegment.length >= 2) {
            segments.push(currentSegment);
        }

        // Draw each segment as a smooth Catmull-Rom spline
        this.ctx.save();
        this.ctx.strokeStyle = this.userLineColor;
        this.ctx.lineWidth = 2.5;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = this.userLineGlow;

        for (const segment of segments) {
            // Convert to screen coordinates
            const pts = [];
            for (const p of segment) {
                const sx = this.timeToX(p.time);
                const sy = this.freqToY(p.pitch);
                pts.push({ x: sx, y: sy });
            }

            // Skip segments entirely off-screen
            const firstX = pts[0].x;
            const lastX = pts[pts.length - 1].x;
            if (lastX < -50 || firstX > this.width + 50) continue;

            this.ctx.beginPath();
            this.ctx.moveTo(pts[0].x, pts[0].y);

            if (pts.length === 2) {
                // Simple line for 2-point segments
                this.ctx.lineTo(pts[1].x, pts[1].y);
            } else {
                // Catmull-Rom spline: interpolate between each pair of interior points
                // with 4 subdivisions per segment for smoothness
                const SUBDIVISIONS = 4;
                for (let i = 0; i < pts.length - 1; i++) {
                    const p0 = pts[Math.max(0, i - 1)];
                    const p1 = pts[i];
                    const p2 = pts[i + 1];
                    const p3 = pts[Math.min(pts.length - 1, i + 2)];

                    for (let s = 1; s <= SUBDIVISIONS; s++) {
                        const t = s / SUBDIVISIONS;
                        const pt = this.catmullRom(p0, p1, p2, p3, t);
                        this.ctx.lineTo(pt.x, pt.y);
                    }
                }
            }

            this.ctx.stroke();
        }

        this.ctx.restore();
    }
}
