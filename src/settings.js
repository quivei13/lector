// User preferences, persisted in localStorage. Every storage access is guarded:
// private windows or blocked site data must never break the reader.

const KEY = 'lector-guia:settings'

export const THEMES = {
    light: { pageBg: '#ffffff', text: '#1b1b1b', pdfFilter: 'none' },
    sepia: { pageBg: '#f4ecd8', text: '#4a3b2a', pdfFilter: 'sepia(0.45) brightness(0.97)' },
    dark: { pageBg: '#1f1f1f', text: '#dcdcdc', pdfFilter: 'invert(0.88) hue-rotate(180deg)' },
}

export const DEFAULTS = {
    guideEnabled: true,
    mode: 'snap',              // 'snap' (ajustar a línea) | 'free' (franja libre)
    highlightOpacity: 1,       // opacidad del texto dentro de la franja (0–1)
    dimOpacity: 0.35,          // opacidad del texto fuera de la franja (0–1)
    linesPerBand: 1,
    tintColor: '#ffd84d',
    tintStrength: 0.28,
    freeHeight: 44,            // alto de la franja en modo libre (px)
    followMouse: true,
    wordMode: false,           // la guía avanza palabra por palabra
    // barra de opciones de la guía visible (plegada de entrada en el teléfono)
    optionsOpen: !window.matchMedia('(max-width: 640px)').matches,
    theme: 'light',
    pdfScale: null,            // null = ajustar al ancho, hasta 130 %
    fontSize: 100,             // % para EPUB/MOBI
}

const read = (key, fallback) => {
    try {
        const raw = localStorage.getItem(key)
        return raw ? JSON.parse(raw) : fallback
    } catch {
        return fallback
    }
}

const write = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch { /* storage unavailable: keep working in memory */ }
}

const listeners = new Set()

export const settings = { ...DEFAULTS, ...read(KEY, {}) }

export const setSetting = (key, value) => {
    if (settings[key] === value) return
    settings[key] = value
    write(KEY, settings)
    for (const fn of listeners) fn(key, value)
}

export const onSettingChange = fn => listeners.add(fn)

// Last reading position per file (name + size identifies a file well enough).
const posKey = file => `lector-guia:pos:${file.name}:${file.size}`
export const loadPosition = file => read(posKey(file), null)
export const savePosition = (file, pos) => write(posKey(file), pos)

export const clamp = (x, min, max) => Math.min(max, Math.max(min, x))
