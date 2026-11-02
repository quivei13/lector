// Side panel with the document's table of contents (chapters / bookmarks).
// Readers provide getToc() → [{ label, target, children }], goToTarget(target)
// and activeTocIndex(flatItems).

const $ = id => document.getElementById(id)

export function setupToc() {
    const panel = $('toc')
    const list = $('toc-list')
    const backdrop = $('toc-backdrop')
    let reader = null
    let flat = []      // entries in reading order, parallel to `buttons`
    let buttons = []

    const build = items => {
        const ul = document.createElement('ul')
        for (const item of items) {
            const li = document.createElement('li')
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = item.label
            button.title = item.label
            if (item.target == null) button.disabled = true
            else button.addEventListener('click', () => go(item.target))
            flat.push(item)
            buttons.push(button)
            li.append(button)
            if (item.children.length) li.append(build(item.children))
            ul.append(li)
        }
        return ul
    }

    const go = async target => {
        close()
        await reader?.goToTarget(target)
    }

    const markActive = () => {
        const active = reader ? reader.activeTocIndex(flat) : -1
        buttons.forEach((b, i) => b.classList.toggle('active', i === active))
        return buttons[active]
    }

    const open = () => {
        if (!reader) return
        panel.hidden = false
        backdrop.hidden = false
        const active = markActive()
        active?.scrollIntoView({ block: 'center' })
        ;(active ?? panel.querySelector('button:not([disabled])') ?? $('toc-close')).focus({ preventScroll: true })
    }

    const close = () => {
        if (panel.hidden) return
        // Give the keyboard back to the reader so the arrows move the guide.
        if (panel.contains(document.activeElement)) document.activeElement.blur()
        panel.hidden = true
        backdrop.hidden = true
    }

    $('toc-btn').addEventListener('click', () => panel.hidden ? open() : close())
    $('toc-close').addEventListener('click', close)
    backdrop.addEventListener('click', close)

    return {
        async setReader(next) {
            reader = next
            flat = []
            buttons = []
            close()
            list.replaceChildren()
            if (!next) return
            const items = await next.getToc().catch(() => [])
            if (reader !== next) return // another file was opened meanwhile
            if (items.length) list.append(build(items))
            else {
                const p = document.createElement('p')
                p.className = 'muted toc-empty'
                p.textContent = 'Este documento no tiene índice.'
                list.append(p)
            }
        },
        toggle: () => panel.hidden ? open() : close(),
        close,
        isOpen: () => !panel.hidden,
    }
}
