import { settings, onSettingChange, loadPosition, savePosition, THEMES } from './settings.js'
import { ReadingGuide } from './guide/readingGuide.js'
import { setupControls } from './guide/controls.js'
import { setupToolbar } from './ui/toolbar.js'
import { setupToc } from './ui/toc.js'

const $ = id => document.getElementById(id)
const area = $('reader-area')
const fileInput = $('file-input')
const help = $('help')

let reader = null
let currentFile = null
const getReader = () => reader

const guide = new ReadingGuide($('guide-layer'))

const openFile = () => fileInput.click()
const toggleHelp = () => help.open ? help.close() : help.showModal()
const closeHelp = () => help.open && help.close()

const toolbar = setupToolbar({ getReader, openFile, toggleHelp })
const toc = setupToc()
const controls = setupControls({
    guide,
    getReader,
    actions: {
        openFile,
        toggleHelp,
        toggleToc: toc.toggle,
        closePanels: () => { closeHelp(); toc.close() },
    },
})

// ---- theme -----------------------------------------------------------------

const applyTheme = () => {
    const t = THEMES[settings.theme]
    document.documentElement.dataset.theme = settings.theme
    document.documentElement.style.setProperty('--page-bg', t.pageBg)
    document.documentElement.style.setProperty('--pdf-filter', t.pdfFilter)
}
applyTheme()

onSettingChange(key => {
    if (key === 'theme') applyTheme()
    if ((key === 'theme' || key === 'fontSize') && reader?.kind === 'book') reader.applyStyles()
    guide.render()
})

// ---- opening files -----------------------------------------------------------

const isPDF = async file => {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return true
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    return String.fromCharCode(...head) === '%PDF-'
}

async function open(file) {
    if (!file) return
    savePositionNow()
    reader?.destroy()
    reader = null
    guide.detach()
    toc.setReader(null)

    $('welcome').hidden = true
    $('loading').hidden = false
    document.body.classList.remove('has-doc')

    try {
        const pdf = await isPDF(file)
        const { PdfReader } = pdf ? await import('./readers/pdfReader.js') : {}
        const { BookReader } = pdf ? {} : await import('./readers/bookReader.js')
        const next = pdf ? new PdfReader(area) : new BookReader(area)

        next.addEventListener('location', e => {
            toolbar.setLocation(e.detail.label)
            savePositionSoon()
        })
        next.addEventListener('doc', e => controls.listen(e.detail.doc, e.detail.map))

        currentFile = file
        await next.open(file, loadPosition(file))
        reader = next
        document.body.classList.add('has-doc')
        toolbar.setTitle(next.view?.book?.metadata?.title
            ? formatTitle(next.view.book.metadata.title) : file.name)
        toolbar.updateZoom()
        guide.attach(reader)
        toc.setReader(reader)
    } catch (e) {
        console.error(e)
        area.querySelector('.pdf-viewer, foliate-view')?.remove()
        $('welcome').hidden = false
        currentFile = null
        alert(`No se pudo abrir “${file.name}”.\n\n${e?.message ?? e}\n\n`
            + 'Los archivos con DRM no se pueden abrir.')
    } finally {
        $('loading').hidden = true
    }
}

const formatTitle = t => typeof t === 'string' ? t : Object.values(t)[0] ?? ''

fileInput.addEventListener('change', () => {
    open(fileInput.files[0])
    fileInput.value = ''
})

// ?url=<dirección> opens a file served from the same site (handy for testing).
const urlParam = new URLSearchParams(location.search).get('url')
if (urlParam) {
    fetch(urlParam)
        .then(r => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(blob => open(new File([blob], decodeURIComponent(urlParam.split('/').pop()), { type: blob.type })))
        .catch(e => alert(`No se pudo descargar ${urlParam}: ${e.message}`))
}

// iOS greys out files whose type it does not recognise (.mobi, .azw3...) when
// the picker is given a filter; the type is checked after choosing anyway.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
if (isIOS) fileInput.removeAttribute('accept')

// Offline support and installation on the phone's Home Screen.
if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Sin modo sin conexión:', e))

// ---- drag & drop -------------------------------------------------------------

let dragDepth = 0
window.addEventListener('dragenter', e => {
    if (!e.dataTransfer?.types.includes('Files')) return
    dragDepth++
    $('drop-overlay').hidden = false
})
window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) dragDepth = 0, $('drop-overlay').hidden = true
})
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => {
    e.preventDefault()
    dragDepth = 0
    $('drop-overlay').hidden = true
    open(e.dataTransfer?.files?.[0])
})

// ---- reading position ----------------------------------------------------------

let saveTimer
const savePositionNow = () => {
    if (reader && currentFile) savePosition(currentFile, reader.position())
}
const savePositionSoon = () => {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(savePositionNow, 800)
}
window.addEventListener('pagehide', savePositionNow)
