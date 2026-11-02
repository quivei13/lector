// EPUB / MOBI / AZW3 / FB2 / CBZ reader built on foliate-js (paginated).
// Lines are measured inside the book's iframe with Range.getClientRects()
// and converted to the coordinates of the main page.
//
// Cursor shape: { idx } — index into the lines of the visible page.

import '../vendor/foliate-js/view.js'
import { groupIntoLines, lineIndexAt } from '../guide/lineDetector.js'
import { settings, setSetting, clamp, THEMES, DEFAULTS } from '../settings.js'

const bookCSS = ({ theme }) => {
    const t = THEMES[theme]
    return `
    html {
        color-scheme: ${theme === 'dark' ? 'dark' : 'light'};
        touch-action: manipulation;
    }
    html, body {
        background: ${t.pageBg} !important;
        color: ${t.text} !important;
    }
    ${theme === 'light' ? '' : `body * { color: inherit !important; }`}
    ${theme === 'dark' ? 'a:link { color: #8ab4f8 !important; }' : ''}
    p, li, blockquote, dd {
        line-height: 1.55;
        text-align: justify;
        hyphens: auto;
    }
    pre { white-space: pre-wrap !important; }
    `
}

// Many books fix their font sizes in px, so scaling the root font size does
// nothing. Instead, remember each element's original size (and line height)
// and set a scaled copy inline.
const baseSizes = new WeakMap()

function scaleFonts(doc, factor) {
    const win = doc.defaultView
    if (!doc.body || !win) return
    const els = [doc.body, ...doc.body.querySelectorAll('*')]
        .filter(el => el instanceof win.HTMLElement)
    // Measure everything first: reading styles between writes is slow.
    for (const el of els) {
        if (baseSizes.has(el)) continue
        const cs = win.getComputedStyle(el)
        baseSizes.set(el, {
            fontSize: parseFloat(cs.fontSize),
            lineHeight: cs.lineHeight.endsWith('px') ? parseFloat(cs.lineHeight) : null,
        })
    }
    for (const el of els) {
        const base = baseSizes.get(el)
        if (factor === 1) {
            el.style.removeProperty('font-size')
            el.style.removeProperty('line-height')
            continue
        }
        el.style.setProperty('font-size', `${base.fontSize * factor}px`, 'important')
        if (base.lineHeight) el.style.setProperty('line-height', `${base.lineHeight * factor}px`, 'important')
    }
}

// A text range's box spans the glyphs' advance widths, which leaves some blank
// space after the last letter. Trim a word's box to the ink actually drawn,
// measured with the word's own font on a canvas of the book's document (so
// the book's embedded fonts are used).
function inkMeter(doc) {
    const win = doc.defaultView
    const ctx = doc.createElement('canvas').getContext('2d')
    const styles = new Map()
    const transforms = {
        uppercase: t => t.toUpperCase(),
        lowercase: t => t.toLowerCase(),
        capitalize: t => t.charAt(0).toUpperCase() + t.slice(1),
    }
    return (rect, text, el, scale) => {
        if (!el) return
        let st = styles.get(el)
        if (!st) {
            const cs = win.getComputedStyle(el)
            st = {
                font: `${cs.fontStyle} ${cs.fontVariantCaps === 'small-caps' ? 'small-caps' : ''} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
                letterSpacing: cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing,
                transform: transforms[cs.textTransform],
                rtl: cs.direction === 'rtl',
            }
            styles.set(el, st)
        }
        if (st.rtl) return
        ctx.font = st.font
        ctx.letterSpacing = st.letterSpacing
        const m = ctx.measureText(st.transform ? st.transform(text) : text)
        // If the measurement does not match the laid-out word (an automatic
        // hyphen, unusual font features...), keep the browser's box.
        const width = rect.right - rect.left
        if (!m.width || Math.abs(m.width * scale - width) > width * 0.15) return
        const left = rect.left - m.actualBoundingBoxLeft * scale
        const right = rect.left + m.actualBoundingBoxRight * scale
        if (right - left > 0.5) {
            rect.left = left
            rect.right = right
        }
    }
}

export class BookReader extends EventTarget {
    kind = 'book'
    #lines = []
    #navigating = false
    #resizeObserver

    constructor(container) {
        super()
        this.view = document.createElement('foliate-view')
        this.view.className = 'book-view'
        container.append(this.view)
        this.#resizeObserver = new ResizeObserver(() => this.#refreshSoon())
        this.#resizeObserver.observe(this.view)
    }

    async open(file, pos) {
        await this.view.open(file)
        const r = this.view.renderer
        r.setAttribute('flow', 'paginated')
        r.setAttribute('margin', '48px')
        r.setAttribute('gap', '6%')
        r.setAttribute('max-inline-size', '680px')
        r.setAttribute('max-column-count', '2')
        this.applyStyles()

        this.view.addEventListener('load', e => this.#onLoad(e.detail))
        this.view.addEventListener('relocate', e => this.#onRelocate(e.detail))
        await this.view.init({ lastLocation: pos?.cfi, showTextStart: !pos?.cfi })
        this.#computeLines()
    }

    destroy() {
        this.#resizeObserver.disconnect()
        this.view.close?.()
        this.view.remove()
    }

    applyStyles() {
        for (const { doc } of this.view.renderer?.getContents?.() ?? [])
            if (doc) scaleFonts(doc, settings.fontSize / 100)
        // Re-applying the styles also makes the paginator re-layout while
        // keeping the current reading position.
        this.view.renderer?.setStyles?.(bookCSS(settings))
        this.#refreshSoon()
    }

    #onLoad({ doc }) {
        scaleFonts(doc, settings.fontSize / 100)
        const map = (x, y) => {
            const frame = doc.defaultView?.frameElement
            if (!frame) return { x, y }
            const f = frame.getBoundingClientRect()
            const s = frame.offsetWidth ? f.width / frame.offsetWidth : 1
            return { x: f.left + x * s, y: f.top + y * s }
        }
        this.dispatchEvent(new CustomEvent('doc', { detail: { doc, map } }))
        doc.fonts?.ready.then(() => this.#refreshSoon())
    }

    #onRelocate(detail) {
        this.lastLocation = detail
        const pct = Math.round((detail.fraction ?? 0) * 100)
        const loc = detail.location
        const label = loc ? `Ubicación ${loc.current + 1} / ${loc.total} · ${pct}%` : `${pct}%`
        this.dispatchEvent(new CustomEvent('location', { detail: { label } }))
        if (this.#navigating) return
        this.#refreshSoon(true)
    }

    #refreshTimer
    #lateTimer
    #refreshSoon(relocated = false) {
        cancelAnimationFrame(this.#refreshTimer)
        // Two frames: let the paginator finish laying out the new page first.
        this.#refreshTimer = requestAnimationFrame(() => requestAnimationFrame(() => {
            this.#computeLines()
            this.dispatchEvent(new Event(relocated ? 'relocate' : 'change'))
        }))
    }

    #computeLines() {
        const bounds = this.view.getBoundingClientRect()
        const rects = []
        for (const { doc } of this.view.renderer?.getContents?.() ?? []) {
            const frame = doc?.defaultView?.frameElement
            if (!frame || !doc.body) continue
            const f = frame.getBoundingClientRect()
            const s = frame.offsetWidth ? f.width / frame.offsetWidth : 1
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
                acceptNode: n => n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
            })
            const range = doc.createRange()
            const visibleRects = () => [...range.getClientRects()]
                .map(r => ({
                    left: f.left + r.left * s,
                    right: f.left + r.right * s,
                    top: f.top + r.top * s,
                    bottom: f.top + r.bottom * s,
                }))
                .filter(r => {
                    const cx = (r.left + r.right) / 2
                    const cy = (r.top + r.bottom) / 2
                    return cx > bounds.left && cx < bounds.right && cy > bounds.top && cy < bounds.bottom
                })
            const ink = inkMeter(doc)
            for (let node; (node = walker.nextNode());) {
                // Cheap check on the whole node first; only visible nodes are
                // measured word by word.
                range.selectNodeContents(node)
                if (!visibleRects().length) continue
                for (const m of node.data.matchAll(/\S+/g)) {
                    range.setStart(node, m.index)
                    range.setEnd(node, m.index + m[0].length)
                    const word = visibleRects()
                    if (word.length === 1) ink(word[0], m[0], node.parentElement, s)
                    rects.push(...word)
                }
            }
        }
        this.#lines = groupIntoLines(rects)
    }

    // ---- table of contents --------------------------------------------------

    async getToc() {
        const walk = items => (items ?? []).map(item => ({
            label: item.label?.trim() || '—',
            target: item.href,
            children: walk(item.subitems),
        }))
        return walk(this.view.book.toc)
    }

    async goToTarget(href) {
        if (href) await this.view.goTo(href)
    }

    activeTocIndex(items) {
        const href = this.lastLocation?.tocItem?.href
        return href ? items.findIndex(item => item.target === href) : -1
    }

    // ---- reader interface used by the guide --------------------------------

    area() {
        return this.view.getBoundingClientRect()
    }

    async initialCursor() {
        return this.#lines.length ? { idx: 0 } : null
    }

    initialCursorFromEnd() {
        return this.#lines.length ? { idx: this.#lines.length - 1 } : null
    }

    wordsOf(cursor) {
        return this.#lines[cursor?.idx]?.words ?? []
    }

    bandRect(cursor, count) {
        const lines = this.#lines.slice(cursor?.idx, cursor?.idx + count)
        if (!lines.length) return null
        return {
            top: Math.min(...lines.map(l => l.top)),
            bottom: Math.max(...lines.map(l => l.bottom)),
            left: Math.min(...lines.map(l => l.colLeft)),
            right: Math.max(...lines.map(l => l.colRight)),
            lineHeight: lines[0].bottom - lines[0].top,
        }
    }

    async move(cursor, delta) {
        const idx = (cursor?.idx ?? 0) + delta
        if (idx >= 0 && idx < this.#lines.length) return { idx }
        const before = this.lastLocation?.cfi
        await this.#turn(idx < 0 ? 'prev' : 'next')
        if (this.lastLocation?.cfi === before) // first or last page of the book
            return { idx: Math.max(0, Math.min(this.#lines.length - 1, idx)) }
        return idx < 0 ? this.initialCursorFromEnd() ?? { idx: 0 } : { idx: 0 }
    }

    async #turn(dir) {
        this.#navigating = true
        try {
            await this.view[dir]()
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
            this.#computeLines()
        } finally {
            this.#navigating = false
        }
        // Safety net: late layout changes (images, fonts) can still move the text.
        clearTimeout(this.#lateTimer)
        this.#lateTimer = setTimeout(() => this.#refreshSoon(), 300)
    }

    reveal() {}

    cursorAt(x, y) {
        const idx = lineIndexAt(this.#lines, x, y)
        return idx === -1 ? null : { idx }
    }

    async scrollBy(dy) {
        await this.#turn(dy > 0 ? 'next' : 'prev')
        this.dispatchEvent(new Event('change'))
    }

    async nextPage() {
        await this.#turn('next')
        this.dispatchEvent(new Event('relocate'))
    }

    async prevPage() {
        await this.#turn('prev')
        this.dispatchEvent(new Event('relocate'))
    }

    zoom(direction) {
        setSetting('fontSize', direction
            ? clamp(settings.fontSize + direction * 10, 60, 300)
            : DEFAULTS.fontSize)
    }

    zoomName() {
        return 'Letra'
    }

    zoomLabel() {
        return `${settings.fontSize}%`
    }

    position() {
        return { cfi: this.lastLocation?.cfi }
    }
}
