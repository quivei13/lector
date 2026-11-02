// The reading guide overlay. A single band element sits over the reader; its
// huge box-shadow is the veil that dims everything outside the band, and its
// own background controls how visible the highlighted text is.

import { settings, setSetting, clamp, THEMES } from '../settings.js'

const rgba = (hex, alpha) => {
    const n = parseInt(hex.slice(1), 16)
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${clamp(alpha, 0, 1)})`
}

export class ReadingGuide {
    reader = null
    cursor = null
    freeY = null
    #frame = 0
    #pending = 0
    #busy = false

    constructor(layer) {
        this.layer = layer
        this.band = layer.querySelector('.guide-band')
        this.handle = layer.querySelector('.guide-handle')
        this.#setupHandle()
        window.addEventListener('resize', () => this.render())
    }

    attach(reader) {
        this.reader = reader
        this.cursor = null
        this.freeY = null
        reader.addEventListener('change', () => this.#onReaderChange())
        reader.addEventListener('relocate', () => this.reset())
        this.reset()
    }

    detach() {
        this.reader = null
        this.cursor = null
        this.render()
    }

    async reset() {
        this.cursor = await this.reader?.initialCursor()
        this.render()
    }

    // PDF scrolling can leave the band far away; bring it back to the
    // first visible line once the scroll settles.
    #changeTimer
    #onReaderChange() {
        this.render()
        clearTimeout(this.#changeTimer)
        this.#changeTimer = setTimeout(() => {
            if (settings.mode === 'snap' && !this.#bandInView()) this.reset()
        }, 200)
    }

    #bandInView() {
        const band = this.cursor && this.reader?.bandRect(this.cursor, settings.linesPerBand)
        if (!band) return false
        const area = this.reader.area()
        return band.bottom > area.top && band.top < area.bottom
    }

    // ---- movement ----------------------------------------------------------

    // Key repeat can fire faster than a page turn; coalesce pending steps.
    move(delta) {
        this.#pending += delta
        if (!this.#busy) this.#drain()
    }

    async #drain() {
        this.#busy = true
        try {
            while (this.#pending) {
                const delta = this.#pending
                this.#pending = 0
                await this.#moveNow(delta)
            }
        } finally {
            this.#busy = false
        }
    }

    async #moveNow(delta) {
        const reader = this.reader
        if (!reader) return
        if (settings.mode === 'free') {
            const area = reader.area()
            const h = settings.freeHeight
            let y = (this.freeY ?? this.#defaultFreeY(area)) + delta * h * 0.8
            if (y + h / 2 > area.bottom || y - h / 2 < area.top) {
                const shift = y + h / 2 > area.bottom ? area.height * 0.6 : -area.height * 0.6
                await reader.scrollBy(shift)
                if (reader.kind === 'pdf') y -= shift
                else y = shift > 0 ? area.top + h : area.bottom - h
            }
            this.freeY = clamp(y, area.top + h / 2, area.bottom - h / 2)
        } else if (!this.cursor || !this.#bandInView()) {
            this.cursor = await reader.initialCursor()
        } else if (this.#wordMode()) {
            for (let i = 0; i < Math.abs(delta); i++) await this.#stepWord(Math.sign(delta))
        } else {
            this.cursor = await reader.move(this.cursor, delta, settings.linesPerBand)
        }
        this.render()
    }

    #wordMode() {
        return settings.wordMode && settings.mode === 'snap'
    }

    // One word forward or back; past the end of the line, the first word of
    // the next line (or the last word of the previous one).
    async #stepWord(dir) {
        const reader = this.reader
        const word = (this.cursor.word ?? 0) + dir
        if (word >= 0 && word < reader.wordsOf(this.cursor).length) {
            this.cursor = { ...this.cursor, word }
            return
        }
        const { word: _, ...line } = this.cursor
        const next = await reader.move(line, dir, 1)
        if (JSON.stringify(next) === JSON.stringify(line)) return // start or end of the document
        this.cursor = { ...next, word: dir > 0 ? 0 : Math.max(0, reader.wordsOf(next).length - 1) }
    }

    pointAt(x, y) {
        if (!this.reader) return
        if (settings.mode === 'free') this.freeY = y
        else {
            const c = this.reader.cursorAt(x, y)
            if (!c) return
            this.cursor = this.#wordMode() ? { ...c, word: this.#wordIndexAt(c, x) } : c
        }
        this.render()
    }

    #wordIndexAt(cursor, x) {
        let best = 0, bestDist = Infinity
        this.reader.wordsOf(cursor).forEach((w, i) => {
            const d = x < w.left ? w.left - x : x > w.right ? x - w.right : 0
            if (d < bestDist) best = i, bestDist = d
        })
        return best
    }

    // The band around the current word: word width, full line height so the
    // band does not jump in height between short and tall words.
    #wordRect() {
        const line = this.reader.bandRect(this.cursor, 1)
        const words = this.reader.wordsOf(this.cursor)
        if (!line || !words.length) return line
        const w = words[clamp(this.cursor.word ?? 0, 0, words.length - 1)]
        return { ...line, left: w.left, right: w.right }
    }

    #defaultFreeY(area) {
        return area.top + area.height * 0.35
    }

    // ---- rendering ---------------------------------------------------------

    render() {
        cancelAnimationFrame(this.#frame)
        this.#frame = requestAnimationFrame(() => this.#draw())
    }

    #draw() {
        const { reader, layer, band } = this
        const s = settings
        if (!reader || !s.guideEnabled) {
            layer.hidden = true
            return
        }
        const area = reader.area()
        let rect
        if (s.mode === 'free') {
            const h = s.freeHeight
            const y = clamp(this.freeY ?? this.#defaultFreeY(area), area.top + h / 2, area.bottom - h / 2)
            rect = { top: y - h / 2, bottom: y + h / 2, left: area.left, right: area.right, lineHeight: 0 }
        } else {
            rect = this.cursor && (this.#wordMode()
                ? this.#wordRect()
                : reader.bandRect(this.cursor, s.linesPerBand))
        }
        if (!rect) {
            layer.hidden = true
            return
        }

        layer.hidden = false
        Object.assign(layer.style, {
            left: `${area.left}px`,
            top: `${area.top}px`,
            width: `${area.width}px`,
            height: `${area.height}px`,
        })

        const padY = s.mode === 'free' ? 0 : Math.max(2, rect.lineHeight * 0.22)
        const padX = s.mode === 'free' ? 0 : this.#wordMode() ? 2 : 10
        Object.assign(band.style, {
            left: `${rect.left - area.left - padX}px`,
            top: `${rect.top - area.top - padY}px`,
            width: `${rect.right - rect.left + padX * 2}px`,
            height: `${rect.bottom - rect.top + padY * 2}px`,
        })

        const pageBg = THEMES[s.theme].pageBg
        band.style.boxShadow = `0 0 0 200vmax ${rgba(pageBg, 1 - s.dimOpacity)}`
        const tint = rgba(s.tintColor, s.tintStrength)
        band.style.background = `linear-gradient(${tint}, ${tint}), ${rgba(pageBg, 1 - s.highlightOpacity)}`
        layer.classList.toggle('free', s.mode === 'free')
    }

    // Free mode: drag the handle under the band to change its height.
    #setupHandle() {
        let startY, startH
        this.handle.addEventListener('pointerdown', e => {
            e.preventDefault()
            this.handle.setPointerCapture(e.pointerId)
            this.dragging = true
            startY = e.clientY
            startH = settings.freeHeight
        })
        this.handle.addEventListener('pointermove', e => {
            if (!this.dragging) return
            setSetting('freeHeight', Math.round(clamp(startH + (e.clientY - startY) * 2, 16, 400)))
        })
        const end = () => this.dragging = false
        this.handle.addEventListener('pointerup', end)
        this.handle.addEventListener('pointercancel', end)
    }
}
