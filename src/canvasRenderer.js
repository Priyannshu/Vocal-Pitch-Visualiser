export class CanvasRenderer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');

        // Pitch configuration
        this.minFreq = 65.41;   // C2
        this.maxFreq = 1046.50; // C6

        // UI mapping
        this.pixelsPerSecond = 150;

        // Note block height in pixels
        this.blockHeight = 18;

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
        this.unplayedGlow = 'rgba(255, 152, 0, 0.4)';
        this.playedGlow = 'rgba(76, 175, 80, 0.4)';
        this.connectorColor = 'rgba(255, 152, 0, 0.25)';
        this.userColor = '#f43f5e';
        this.userGlow = 'rgba(244, 63, 94, 0.4)';

        // Handle resizing
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupNoteLabels();
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
    }

    start() {
        this.isPlaying = true;
        this.loop();
    }

    stop() {
        this.isPlaying = false;
        cancelAnimationFrame(this.animationFrame);
    }

    loop() {
        if (this.isPlaying) {
            this.draw();
            this.animationFrame = requestAnimationFrame(() => this.loop());
        }
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

        // 2. Draw smooth curved connectors between consecutive blocks (only when no pause)
        if (this.noteBlocks.length > 1) {
            const MAX_GAP_FOR_CONNECTOR = 0.12; // seconds — skip connector if gap > this (pause)

            for (let i = 0; i < this.noteBlocks.length - 1; i++) {
                const curr = this.noteBlocks[i];
                const next = this.noteBlocks[i + 1];

                // Skip off-screen pairs
                if (curr.endTime < visibleTimeStart - 1 && next.startTime < visibleTimeStart - 1) continue;
                if (curr.startTime > visibleTimeEnd + 1) break;

                // Only connect if gap is small (no pause)
                const gap = next.startTime - curr.endTime;
                if (gap > MAX_GAP_FOR_CONNECTOR) continue;

                const x1 = this.timeToX(curr.endTime);
                const y1 = this.freqToY(curr.avgPitch);
                const x2 = this.timeToX(next.startTime);
                const y2 = this.freqToY(next.avgPitch);

                // Quadratic bezier curve for smooth, organic transition
                const midX = (x1 + x2) / 2;

                this.ctx.beginPath();
                this.ctx.strokeStyle = this.connectorColor;
                this.ctx.lineWidth = 1.2;
                this.ctx.setLineDash([]);
                this.ctx.moveTo(x1, y1);
                this.ctx.quadraticCurveTo(midX, y1, x2, y2);
                this.ctx.stroke();
            }
        }

        // 3. Draw note blocks as rounded rectangles with inner pitch detail
        for (const block of this.noteBlocks) {
            if (block.endTime < visibleTimeStart - 1) continue;
            if (block.startTime > visibleTimeEnd + 1) break;

            const x = this.timeToX(block.startTime);
            const blockWidth = (block.endTime - block.startTime) * this.pixelsPerSecond;
            const y = this.freqToY(block.avgPitch) - this.blockHeight / 2;

            // Minimum width so very short notes are still visible
            const w = Math.max(blockWidth, 4);

            // Determine if block has been played (sweep line has passed it)
            const isPlayed = block.endTime <= this.currentTime;
            const isPartiallyPlayed = block.startTime <= this.currentTime && block.endTime > this.currentTime;

            if (isPartiallyPlayed) {
                const playedWidth = (this.currentTime - block.startTime) * this.pixelsPerSecond;
                const unplayedWidth = w - playedWidth;

                // Played portion
                this.ctx.save();
                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = this.playedGlow;
                this.ctx.fillStyle = this.playedColor;
                this.drawRoundedRect(x, y, Math.max(playedWidth, 2), this.blockHeight, 4);
                this.ctx.fill();
                this.ctx.restore();

                // Unplayed portion
                this.ctx.save();
                this.ctx.shadowBlur = 6;
                this.ctx.shadowColor = this.unplayedGlow;
                this.ctx.fillStyle = this.unplayedColor;
                this.drawRoundedRect(x + playedWidth, y, Math.max(unplayedWidth, 2), this.blockHeight, 4);
                this.ctx.fill();
                this.ctx.restore();
            } else {
                const color = isPlayed ? this.playedColor : this.unplayedColor;
                const glow = isPlayed ? this.playedGlow : this.unplayedGlow;

                this.ctx.save();
                this.ctx.shadowBlur = isPlayed ? 4 : 6;
                this.ctx.shadowColor = glow;
                this.ctx.fillStyle = color;
                this.drawRoundedRect(x, y, w, this.blockHeight, 4);
                this.ctx.fill();
                this.ctx.restore();
            }

            // 3b. Draw raw pitch detail line INSIDE the block
            if (block.points && block.points.length > 1 && w > 6) {
                // Find the pitch range within this block
                let minP = Infinity, maxP = -Infinity;
                for (const p of block.points) {
                    if (p.pitch < minP) minP = p.pitch;
                    if (p.pitch > maxP) maxP = p.pitch;
                }

                // Use a minimum display range of ±1 semitone around the average
                // so even subtle vibrato variations are amplified visually
                const avgP = block.avgPitch;
                const minSemitoneRange = avgP * (Math.pow(2, 1 / 12) - 1); // ~1 semitone in Hz
                const actualRange = maxP - minP;
                let displayMin, displayMax;
                if (actualRange < minSemitoneRange * 2) {
                    // Expand to at least ±1 semitone
                    displayMin = avgP - minSemitoneRange;
                    displayMax = avgP + minSemitoneRange;
                } else {
                    // Add 15% padding to actual range
                    const pad = actualRange * 0.15;
                    displayMin = minP - pad;
                    displayMax = maxP + pad;
                }
                const displayRange = displayMax - displayMin;

                const innerTop = y + 2;
                const innerHeight = this.blockHeight - 4;

                this.ctx.save();
                // Clip to the block shape
                this.drawRoundedRect(x, y, w, this.blockHeight, 4);
                this.ctx.clip();

                this.ctx.beginPath();
                this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
                this.ctx.lineWidth = 1.3;
                this.ctx.lineJoin = 'round';
                this.ctx.lineCap = 'round';

                let started = false;
                for (const p of block.points) {
                    const px = this.timeToX(p.time);
                    const ratio = (p.pitch - displayMin) / displayRange;
                    const py = innerTop + innerHeight - (ratio * innerHeight); // invert Y

                    if (!started) {
                        this.ctx.moveTo(px, py);
                        started = true;
                    } else {
                        this.ctx.lineTo(px, py);
                    }
                }
                this.ctx.stroke();
                this.ctx.restore();
            }
        }

        // 4. Draw user live pitch as a continuous thin line
        this.drawUserPitchLine();
    }

    drawUserPitchLine() {
        if (this.livePitchData.length === 0) return;

        const visibleTimeStart = this.currentTime - (this.playheadX / this.pixelsPerSecond);
        const visibleTimeEnd = this.currentTime + ((this.width - this.playheadX) / this.pixelsPerSecond);

        this.ctx.strokeStyle = this.userColor;
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        let isDrawing = false;
        let lastTime = -1;

        this.ctx.beginPath();

        for (const pt of this.livePitchData) {
            if (pt.time < visibleTimeStart - 1) continue;
            if (pt.time > visibleTimeEnd + 1) break;

            const x = this.timeToX(pt.time);
            const y = this.freqToY(pt.pitch);

            if (lastTime !== -1 && (pt.time - lastTime > 0.15)) {
                isDrawing = false;
            }

            if (!isDrawing) {
                this.ctx.moveTo(x, y);
                isDrawing = true;
            } else {
                this.ctx.lineTo(x, y);
            }

            lastTime = pt.time;
        }

        this.ctx.stroke();

        this.ctx.save();
        this.ctx.shadowBlur = 5;
        this.ctx.shadowColor = this.userGlow;
        this.ctx.stroke();
        this.ctx.restore();
    }
}
