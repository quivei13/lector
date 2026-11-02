// Two-way binding between the toolbar controls and the settings.

import { settings, setSetting, onSettingChange } from '../settings.js'

const $ = id => document.getElementById(id)
const pct = x => `${Math.round(x * 100)}%`

// [element id, setting key, input → value, value → input, output id, value → label]
const bindings = [
    ['guide-enabled', 'guideEnabled', el => el.checked, (el, v) => el.checked = v],
    ['hl-opacity', 'highlightOpacity', el => el.value / 100, (el, v) => el.value = Math.round(v * 100), 'hl-value', pct],
    ['dim-opacity', 'dimOpacity', el => el.value / 100, (el, v) => el.value = Math.round(v * 100), 'dim-value', pct],
    ['lines', 'linesPerBand', el => +el.value, (el, v) => el.value = v, 'lines-value', String],
    ['mode', 'mode', el => el.value, (el, v) => el.value = v],
    ['follow-mouse', 'followMouse', el => el.checked, (el, v) => el.checked = v],
    ['word-mode', 'wordMode', el => el.checked, (el, v) => el.checked = v],
    ['tint-color', 'tintColor', el => el.value, (el, v) => el.value = v],
    ['tint-strength', 'tintStrength', el => el.value / 100, (el, v) => el.value = Math.round(v * 100), 'tint-value', pct],
    ['theme', 'theme', el => el.value, (el, v) => el.value = v],
]

export function setupToolbar({ getReader, openFile, toggleHelp }) {
    for (const [id, key, read, write, outId, label] of bindings) {
        const el = $(id)
        const sync = () => {
            write(el, settings[key])
            if (outId) $(outId).textContent = label(settings[key])
        }
        sync()
        el.addEventListener('input', () => setSetting(key, read(el)))
        onSettingChange(k => k === key && sync())
    }

    // Free mode has no lines or words to step through; word mode shows a single word.
    const syncLinesState = () => {
        $('lines').disabled = settings.mode === 'free' || settings.wordMode
        $('word-mode').disabled = settings.mode === 'free'
    }
    syncLinesState()
    onSettingChange(k => (k === 'mode' || k === 'wordMode') && syncLinesState())

    $('open-btn').addEventListener('click', openFile)
    $('welcome-open').addEventListener('click', openFile)
    $('help-btn').addEventListener('click', toggleHelp)

    // Hide the guide options bar to leave more room for the text.
    const syncOptions = () => {
        const open = settings.optionsOpen
        document.body.classList.toggle('options-hidden', !open)
        $('options-btn').setAttribute('aria-expanded', open)
        $('options-btn').querySelector('.chevron').textContent = open ? '▴' : '▾'
    }
    syncOptions()
    onSettingChange(k => k === 'optionsOpen' && syncOptions())
    $('options-btn').addEventListener('click', () => setSetting('optionsOpen', !settings.optionsOpen))
    $('prev-btn').addEventListener('click', () => getReader()?.prevPage())
    $('next-btn').addEventListener('click', () => getReader()?.nextPage())

    const zoom = dir => {
        const reader = getReader()
        if (!reader) return
        reader.zoom(dir)
        updateZoom()
    }
    $('zoom-in').addEventListener('click', () => zoom(1))
    $('zoom-out').addEventListener('click', () => zoom(-1))
    $('zoom-label').addEventListener('click', () => zoom(0))

    const updateZoom = () => {
        $('zoom-label').textContent = getReader()?.zoomLabel() ?? ''
        $('zoom-name').textContent = getReader()?.zoomName() ?? ''
    }
    onSettingChange(k => (k === 'fontSize' || k === 'pdfScale') && updateZoom())

    // Buttons keep focus after a click; give the keyboard back to the reader
    // so arrow keys move the guide instead of the focused control.
    document.querySelectorAll('.bar button').forEach(b =>
        b.addEventListener('click', () => b.blur()))
    document.querySelectorAll('.bar input[type="range"], .bar input[type="checkbox"]').forEach(el =>
        el.addEventListener('pointerup', () => setTimeout(() => el.blur())))
    document.querySelectorAll('.bar select').forEach(el =>
        el.addEventListener('change', () => el.blur()))

    return {
        setTitle: t => $('doc-title').textContent = t,
        setLocation: t => $('page-label').textContent = t,
        updateZoom,
    }
}
