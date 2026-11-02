// PDF reader: continuous vertical scroll, pages rendered lazily with pdf.js,
// plus a selectable text layer. Line positions are computed from the PDF text
// content itself, so they are known even for pages not yet drawn.
//
// Cursor shape: { page, line }

import * as pdfjs from '../vendor/foliate-js/vendor/pdfjs/pdf.mjs'
import { groupIntoLines, lineIndexAt } from '../guide/lineDetector.js'
import { settings, setSetting, clamp } from '../settings.js'

const base = new URL('../vendor/foliate-js/vendor/pdfjs/', import.meta.url)
pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', base).href

const PAGE_GAP = 16
const DEFAULT_MAX_SCALE = 1.3
// Phones run out of canvas memory quickly: draw fewer pixels per page there.
const MAX_CANVAS_PIXELS = window.matchMedia('(pointer: coarse)').matches ? 3e6 : 16e6
const measureCtx = document.createElement('canvas').getContext('2d')

export class PdfReader extends EventTarget {
    kind = 'pdf'
    #pages = []
    #observer
    #scale = settings.pdfScale ?? DEFAULT_MAX_SCALE
    #startAt = null

    constructor(container) {
        super()
        this.el = document.createElement('div')
        this.el.className = 'pdf-viewer'
        container.append(this.el)
        this.el.addEventListener('scroll', () => {
            this.#emit('change')
            this.#emitLocation()
        }, { passive: true })
        this.#observer = new IntersectionObserver(entries => {
            for (const e of entries) {
                const p = this.#pages[e.target.dataset.index]
                if (e.isIntersecting) this.#render(p)
                else this.#release(p)
            }
        }, { root: this.el, rootMargin: '150% 0px' })
    }

    async open(file, pos) {
        const data = new Uint8Array(await file.arrayBuffer())
        this.doc = await pdfjs.getDocument({
            data,
            cMapUrl: new URL('cmaps/', base).href,
            cMapPacked: true,
            standardFontDataUrl: new URL('standard_fonts/', base).href,
        }).promise

        for (let i = 0; i < this.doc.numPages; i++) {
            const page = await this.doc.getPage(i + 1)
            const viewport = page.getViewport({ scale: 1 })
            const { width, height } = viewport
            const el = document.createElement('div')
            el.className = 'pdf-page'
            el.dataset.index = i
            this.el.append(el)
            this.#pages.push({ index: i, el, width, height, viewport, rendered: 0, lines: null })
        }
        this.#scale = settings.pdfScale ?? this.#fitScale()
        this.#layout()
        if (pos?.page != null) this.#scrollToPage(pos.page, pos.offset ?? 0)
        this.#emitLocation()
    }

    destroy() {
        this.#observer.disconnect()
        this.doc?.destroy()
        this.el.remove()
    }

    // ---- layout & rendering ------------------------------------------------

    // Default zoom: the page's full width, without going past DEFAULT_MAX_SCALE.
    #fitScale() {
        const cs = getComputedStyle(this.el)
        const room = this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        const scale = room / (this.#pages[0]?.width || room)
        return clamp(scale, 0.3, DEFAULT_MAX_SCALE)
    }

    // Pages far from the screen give their canvas memory back.
    #release(p) {
        if (!p || (!p.rendered && !p.el.firstChild)) return
        p.rendered = 0
        p.task?.cancel()
        for (const c of p.el.querySelectorAll('canvas')) c.width = c.height = 0
        p.el.replaceChildren()
    }

    #layout() {
        this.#observer.disconnect()
        for (const p of this.#pages) {
            p.el.style.width = `${p.width * this.#scale}px`
            p.el.style.height = `${p.height * this.#scale}px`
            p.el.style.marginBottom = `${PAGE_GAP}px`
            p.rendered = 0
            this.#observer.observe(p.el)
        }
    }

    async #render(p) {
        const scale = this.#scale
        if (!p || p.rendered === scale) return
        p.rendered = scale
        p.task?.cancel()

        const page = await this.doc.getPage(p.index + 1)
        if (p.rendered !== scale) return
        const viewport = page.getViewport({ scale })
        const ratio = Math.min(
            window.devicePixelRatio || 1,
            Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)))

        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`

        const textDiv = document.createElement('div')
        textDiv.className = 'textLayer'
        p.el.style.setProperty('--scale-factor', scale)
        p.el.style.setProperty('--total-scale-factor', scale)

        p.task = page.render({
            canvasContext: canvas.getContext('2d'),
            viewport,
            transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
        })
        try {
            await p.task.promise
        } catch (e) {
            if (e?.name !== 'RenderingCancelledException') console.error(e)
            return
        }
        if (p.rendered !== scale) return
        p.el.replaceChildren(canvas, textDiv)
        new pdfjs.TextLayer({
            textContentSource: page.streamTextContent(),
            container: textDiv,
            viewport,
        }).render().catch(() => {})
    }

    setScale(scale) {
        const { page, offset } = this.position()
        this.#scale = scale
        this.#layout()
        this.#scrollToPage(page, offset)
        this.#emit('change')
    }

    // ---- line detection ----------------------------------------------------

    // Lines in page coordinates at scale 1.
    async #loadLines(p) {
        if (p.lines) return p.lines
        p.linesPromise ??= (async () => {
            const page = await this.doc.getPage(p.index + 1)
            const viewport = page.getViewport({ scale: 1 })
            const content = await page.getTextContent()
            const rects = []
            for (const item of content.items) {
                if (!item.str?.trim()) continue
                const tx = pdfjs.Util.transform(viewport.transform, item.transform)
                const fontH = Math.hypot(tx[2], tx[3])
                if (!fontH || Math.abs(tx[1]) > 0.01 * fontH) continue // rotated text
                const style = content.styles[item.fontName] ?? {}
                const ascent = Math.min(1.1, Math.max(0.5, style.ascent || 0.8))
                const descent = Math.min(0, Math.max(-0.5, style.descent ?? -0.2))
                const top = tx[5] - fontH * ascent
                const bottom = tx[5] - fontH * descent
                const width = item.width * viewport.scale
                // pdf.js gives positions per text run, not per word: measure the
                // run with a similar font and scale it to the run's real width.
                measureCtx.font = `100px ${style.fontFamily || 'sans-serif'}`
                const at = i => measureCtx.measureText(item.str.slice(0, i)).width
                const total = at(item.str.length) || 1
                for (const m of item.str.matchAll(/\S+/g)) rects.push({
                    left: tx[4] + width * at(m.index) / total,
                    right: tx[4] + width * at(m.index + m[0].length) / total,
                    top,
                    bottom,
                })
            }
            p.lines = groupIntoLines(rects)
            return p.lines
        })()
        return p.linesPromise
    }

    // ---- table of contents --------------------------------------------------

    // The PDF outline (bookmarks), with each entry resolved to { page, top }.
    async getToc() {
        const outline = await this.doc.getOutline().catch(() => null)
        const resolve = async dest => {
            try {
                if (typeof dest === 'string') dest = await this.doc.getDestination(dest)
                if (!Array.isArray(dest)) return null
                const page = typeof dest[0] === 'object'
                    ? await this.doc.getPageIndex(dest[0])
                    : dest[0]
                const p = this.#pages[page]
                if (!p) return null
                // XYZ and FitH destinations also say how far down the page to go.
                const kind = dest[1]?.name
                const y = kind === 'XYZ' ? dest[3] : kind === 'FitH' || kind === 'FitBH' ? dest[2] : null
                const top = y == null ? null : p.viewport.convertToViewportPoint(0, y)[1]
                return { page, top }
            } catch {
                return null
            }
        }
        const walk = items => Promise.all((items ?? []).map(async item => ({
            label: item.title?.trim() || '—',
            target: await resolve(item.dest),
            children: await walk(item.items),
        })))
        return walk(outline)
    }

    goToTarget(target) {
        const p = this.#pages[target?.page]
        if (!p) return
        this.el.scrollTop = target.top == null
            ? p.el.offsetTop - PAGE_GAP / 2
            : p.el.offsetTop + Math.max(0, target.top) * this.#scale - 24
        // Start the guide at the section's first line, not at whatever is
        // visible in the small margin left above it.
        this.#startAt = target
        this.#emit('relocate')
    }

    // Last entry that starts above the top quarter of the screen.
    activeTocIndex(items) {
        const area = this.area()
        const y = area.top + area.height * 0.25
        const page = this.#pages.find(p => p.el.getBoundingClientRect().bottom >= y) ?? this.#pages.at(-1)
        const r = page.el.getBoundingClientRect()
        const here = page.index + (y - r.top) / r.height
        let active = -1
        items.forEach((item, i) => {
            const t = item.target
            if (t && t.page + (t.top ?? 0) / this.#pages[t.page].height <= here) active = i
        })
        return active
    }

    // ---- reader interface used by the guide --------------------------------

    area() {
        return this.el.getBoundingClientRect()
    }

    #currentPageIndex() {
        const area = this.area()
        const y = area.top + area.height * 0.3
        let best = 0
        for (const p of this.#pages) {
            if (p.el.getBoundingClientRect().top <= y) best = p.index
            else break
        }
        return best
    }

    async initialCursor() {
        const start = this.#startAt
        this.#startAt = null
        if (start?.top != null) {
            const lines = await this.#loadLines(this.#pages[start.page])
            const idx = lines.findIndex(l => l.bottom >= start.top)
            if (idx !== -1) return { page: start.page, line: idx }
        }
        const area = this.area()
        let i = this.#currentPageIndex()
        // The page that holds the top of the viewport might already be scrolled past.
        if (this.#pages[i].el.getBoundingClientRect().bottom < area.top + 20) i++
        for (; i < this.#pages.length; i++) {
            const p = this.#pages[i]
            const lines = await this.#loadLines(p)
            const r = p.el.getBoundingClientRect()
            const idx = lines.findIndex(l => r.top + l.top * this.#scale >= area.top)
            if (idx !== -1) return { page: i, line: idx }
            if (r.top > area.bottom) break
        }
        return null
    }

    // Word positions from the text content are estimates (pdf.js only knows
    // where each run of text starts and ends). Once the page is drawn, snap
    // each word to the ink found in the canvas pixels of its line.
    #inkWords(p, lineIdx) {
        const line = p.lines[lineIdx]
        const cached = p.inkWords?.get(lineIdx)
        if (cached) return cached
        const canvas = p.el.querySelector('canvas')
        if (!canvas) return line.words

        const k = canvas.width / p.width // canvas pixels per page unit
        const x0 = Math.max(0, Math.floor(line.left * k) - 4)
        const x1 = Math.min(canvas.width, Math.ceil(line.right * k) + 4)
        const y0 = Math.max(0, Math.floor(line.top * k))
        const y1 = Math.min(canvas.height, Math.ceil(line.bottom * k))
        const w = x1 - x0, h = y1 - y0
        if (w <= 0 || h <= 0) return line.words
        const data = canvas.getContext('2d').getImageData(x0, y0, w, h).data

        // Columns with at least one dark pixel.
        const inked = new Uint8Array(w)
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
            const i = (y * w + x) * 4
            if (data[i + 3] > 0 && 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 170) {
                inked[x] = 1
                break
            }
        }
        // Runs of ink separated by gaps wider than a letter gap ≈ words.
        const minGap = Math.max(2, 0.15 * (line.bottom - line.top) * k)
        const runs = []
        let start = -1, last = -Infinity
        for (let x = 0; x < w; x++) {
            if (!inked[x]) continue
            if (start < 0) start = x
            else if (x - last > minGap) runs.push([start, last]), start = x
            last = x
        }
        if (start >= 0) runs.push([start, last])
        const inPage = runs.map(([a, b]) => [(x0 + a) / k, (x0 + b + 1) / k])

        const words = line.words.map(word => {
            const inside = inPage.filter(([a, b]) => (a + b) / 2 >= word.left && (a + b) / 2 <= word.right)
            if (!inside.length) return word
            return { ...word, left: inside[0][0], right: inside.at(-1)[1] }
        })
        ;(p.inkWords ??= new Map()).set(lineIdx, words)
        return words
    }

    wordsOf(cursor) {
        const p = this.#pages[cursor?.page]
        const words = p?.lines?.[cursor.line] && this.#inkWords(p, cursor.line)
        if (!words) return []
        const r = p.el.getBoundingClientRect()
        const s = this.#scale
        return words.map(w => ({
            left: r.left + w.left * s,
            right: r.left + w.right * s,
            top: r.top + w.top * s,
            bottom: r.top + w.bottom * s,
        }))
    }

    bandRect(cursor, count) {
        const p = this.#pages[cursor?.page]
        const lines = p?.lines?.slice(cursor.line, cursor.line + count)
        if (!lines?.length) return null
        const r = p.el.getBoundingClientRect()
        const s = this.#scale
        return {
            top: r.top + Math.min(...lines.map(l => l.top)) * s,
            bottom: r.top + Math.max(...lines.map(l => l.bottom)) * s,
            left: r.left + Math.min(...lines.map(l => l.colLeft)) * s,
            right: r.left + Math.max(...lines.map(l => l.colRight)) * s,
            lineHeight: (lines[0].bottom - lines[0].top) * s,
        }
    }

    async move(cursor, delta, count) {
        let { page, line } = cursor
        line += delta
        while (true) {
            const lines = await this.#loadLines(this.#pages[page])
            if (line >= lines.length) {
                if (page === this.#pages.length - 1) return cursor
                line -= lines.length
                page++
            } else if (line < 0) {
                if (page === 0) { line = 0; break }
                page--
                line += (await this.#loadLines(this.#pages[page])).length
            } else break
        }
        if (!this.#pages[page].lines.length) return cursor
        const next = { page, line }
        this.reveal(next, count)
        return next
    }

    // Scroll so the band stays comfortably inside the viewport.
    reveal(cursor, count) {
        const band = this.bandRect(cursor, count)
        if (!band) return
        const area = this.area()
        const margin = Math.min(80, area.height * 0.15)
        if (band.top < area.top + margin || band.bottom > area.bottom - margin)
            this.el.scrollTop += band.top - (area.top + area.height * 0.3)
    }

    cursorAt(x, y) {
        for (const p of this.#pages) {
            const r = p.el.getBoundingClientRect()
            if (y < r.top - PAGE_GAP || y > r.bottom) continue
            if (!p.lines) {
                this.#loadLines(p).then(() => this.#emit('change'))
                return null
            }
            const s = this.#scale
            const idx = lineIndexAt(p.lines, (x - r.left) / s, (y - r.top) / s)
            return idx === -1 ? null : { page: p.index, line: idx }
        }
        return null
    }

    // Free mode: keep scrolling when the band reaches an edge.
    scrollBy(dy) {
        this.el.scrollBy(0, dy)
    }

    nextPage() {
        this.#scrollToPage(Math.min(this.#pages.length - 1, this.#currentPageIndex() + 1))
        this.#emit('relocate')
    }

    prevPage() {
        this.#scrollToPage(Math.max(0, this.#currentPageIndex() - 1))
        this.#emit('relocate')
    }

    zoom(direction) {
        const scale = direction
            ? Math.round(clamp(this.#scale + direction * 0.1, 0.3, 4) * 10) / 10
            : this.#fitScale()
        this.setScale(scale)
        setSetting('pdfScale', direction ? scale : null)
    }

    zoomName() {
        return 'Zoom'
    }

    zoomLabel() {
        return `${Math.round(this.#scale * 100)}%`
    }

    position() {
        const i = this.#currentPageIndex()
        const r = this.#pages[i].el.getBoundingClientRect()
        const offset = (this.area().top - r.top) / r.height
        return { page: i, offset: Math.max(0, offset) }
    }

    #scrollToPage(i, offset = 0) {
        const p = this.#pages[i]
        if (!p) return
        this.el.scrollTop = p.el.offsetTop + offset * p.el.offsetHeight - (offset ? 0 : PAGE_GAP / 2)
    }

    #emitLocation() {
        if (!this.#pages.length) return
        const i = this.#currentPageIndex()
        this.dispatchEvent(new CustomEvent('location', {
            detail: { label: `Página ${i + 1} / ${this.#pages.length}` },
        }))
    }

    #emit(type) {
        this.dispatchEvent(new Event(type))
    }
}
