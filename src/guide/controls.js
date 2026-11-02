// Keyboard and mouse control of the reading guide. Listeners are attached to
// the main document and to every book iframe document the reader loads.

import { settings, setSetting, onSettingChange, clamp } from '../settings.js'

const isTyping = el => el?.closest?.('input, select, textarea, [contenteditable="true"]')

const step = (key, delta, min, max) =>
    setSetting(key, Math.round(clamp(settings[key] + delta, min, max) * 100) / 100)

export function setupControls({ guide, getReader, actions }) {
    const onKey = e => {
        // Ctrl/⌘ + / − / 0 change the book's text size instead of the page zoom.
        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
            const dir = { '+': 1, '=': 1, '-': -1, '_': -1, '0': 0 }[e.key]
                ?? { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0 }[e.code]
            const reader = getReader()
            if (dir === undefined || !reader) return
            e.preventDefault()
            reader.zoom(dir)
            return
        }
        if (e.altKey) return
        if (e.key === 'Escape') return actions.closePanels()
        if (isTyping(e.target) && e.target.type !== 'checkbox') return
        // Inside the table of contents the keys keep their usual meaning
        // (Tab, Enter, arrows to scroll), except for the panel's own toggle.
        if (e.target.closest?.('#toc') && e.key !== 'i' && e.key !== 'I') return
        const reader = getReader()

        const handled = (() => {
            switch (e.key) {
                case '?': actions.toggleHelp(); return true
                case 'i': case 'I': if (!reader) return false; actions.toggleToc(); return true
                case 'o': case 'O': actions.openFile(); return true
            }
            if (!reader) return false
            switch (e.key) {
                case 'ArrowDown': case 'j': case 'J':
                    if (!settings.guideEnabled) return false
                    guide.move(e.shiftKey ? 5 : 1); return true
                case 'ArrowUp': case 'k': case 'K':
                    if (!settings.guideEnabled) return false
                    guide.move(e.shiftKey ? -5 : -1); return true
                case 'ArrowRight': case 'PageDown': case ' ':
                    reader.nextPage(); return true
                case 'ArrowLeft': case 'PageUp':
                    reader.prevPage(); return true
                case '+': case '=':
                    if (settings.wordMode && settings.mode === 'snap') return true
                    if (settings.mode === 'free') step('freeHeight', 8, 16, 400)
                    else step('linesPerBand', 1, 1, 6)
                    return true
                case '-': case '_':
                    if (settings.wordMode && settings.mode === 'snap') return true
                    if (settings.mode === 'free') step('freeHeight', -8, 16, 400)
                    else step('linesPerBand', -1, 1, 6)
                    return true
                case '[': step('dimOpacity', -0.05, 0, 1); return true
                case ']': step('dimOpacity', 0.05, 0, 1); return true
                case '{': step('highlightOpacity', -0.05, 0, 1); return true
                case '}': step('highlightOpacity', 0.05, 0, 1); return true
                case 'g': case 'G': setSetting('guideEnabled', !settings.guideEnabled); return true
                case 'm': case 'M': setSetting('mode', settings.mode === 'snap' ? 'free' : 'snap'); return true
                case 'f': case 'F': setSetting('followMouse', !settings.followMouse); return true
                case 'w': case 'W': setSetting('wordMode', !settings.wordMode); return true
            }
            return false
        })()
        if (handled) e.preventDefault()
    }

    const inArea = (x, y) => {
        const a = getReader()?.area()
        return a && x >= a.left && x <= a.right && y >= a.top && y <= a.bottom
    }

    let moveFrame = 0
    const onPointerMove = (x, y) => {
        if (!settings.guideEnabled || !settings.followMouse || guide.dragging) return
        cancelAnimationFrame(moveFrame)
        moveFrame = requestAnimationFrame(() => inArea(x, y) && guide.pointAt(x, y))
    }

    const onClick = (x, y) => {
        if (settings.guideEnabled && inArea(x, y)) guide.pointAt(x, y)
    }

    // Alt (Option on macOS) + wheel moves the guide line by line;
    // a plain wheel keeps scrolling the document as usual.
    const onWheel = e => {
        if (!e.altKey || !settings.guideEnabled || !getReader()) return
        e.preventDefault()
        if (Math.abs(e.deltaY) > 2) guide.move(e.deltaY > 0 ? 1 : -1)
    }

    const listen = (target, map = (x, y) => ({ x, y })) => {
        target.addEventListener('keydown', onKey)
        // Touch: a quick tap places the guide. A finger sliding over the text
        // is scrolling or turning the page, so it never moves the guide.
        let tap = null
        target.addEventListener('pointerdown', e => {
            tap = e.pointerType === 'touch' ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null
        })
        target.addEventListener('pointercancel', () => tap = null)
        target.addEventListener('pointerup', e => {
            const t = tap
            tap = null
            if (!t || t.id !== e.pointerId || e.timeStamp - t.t > 500) return
            if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) return
            if (e.target.closest?.('a, button, input, select, label, .toc-backdrop, #toc, .bars')) return
            const p = map(e.clientX, e.clientY)
            onClick(p.x, p.y)
        })
        target.addEventListener('pointermove', e => {
            if (e.pointerType === 'touch') return
            if (e.target.closest?.('#toc, .toc-backdrop')) return
            const p = map(e.clientX, e.clientY)
            onPointerMove(p.x, p.y)
        })
        target.addEventListener('click', e => {
            if (e.target.closest?.('a, button, input, select, label, .toc-backdrop')) return
            const p = map(e.clientX, e.clientY)
            onClick(p.x, p.y)
        })
        target.addEventListener('wheel', onWheel, { passive: false })
    }

    listen(document)

    document.getElementById('touch-prev').addEventListener('click', () => guide.move(-1))
    document.getElementById('touch-next').addEventListener('click', () => guide.move(1))
    const syncGuideOff = () => document.body.classList.toggle('guide-off', !settings.guideEnabled)
    syncGuideOff()
    onSettingChange(k => k === 'guideEnabled' && syncGuideOff())

    return { listen }
}
