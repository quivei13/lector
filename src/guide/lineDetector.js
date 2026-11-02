// Turns loose text rectangles ({left, top, right, bottom}) into lines of text
// in reading order. Used by both the PDF and the EPUB/MOBI readers.
// The readers pass one rectangle per word, so each line also keeps its words
// (left to right) for the word-by-word guide.

const overlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)

const hGap = (a, b) => Math.max(a.left - b.right, b.left - a.right, 0)

export function groupIntoLines(rects) {
    const sorted = rects
        .filter(r => r.right - r.left > 0.5 && r.bottom - r.top > 0.5)
        .sort((a, b) => a.top - b.top || a.left - b.left)

    const lines = []
    for (const r of sorted) {
        const h = r.bottom - r.top
        // Compare against each line's smallest rect so that a drop cap or a big
        // inline image does not swallow the lines next to it.
        const line = lines.find(l => {
            const ref = l.ref
            const refH = ref.bottom - ref.top
            return overlap(r, ref) >= 0.5 * Math.min(h, refH)
                && hGap(r, l) < 1.5 * Math.max(h, refH)
        })
        if (line) {
            line.rects.push(r)
            line.left = Math.min(line.left, r.left)
            line.right = Math.max(line.right, r.right)
            if (h < line.ref.bottom - line.ref.top) line.ref = r
        } else {
            lines.push({ rects: [r], ref: r, left: r.left, right: r.right })
        }
    }

    for (const line of lines) {
        // Vertical extent: rects of a "normal" height only (ignores drop caps).
        const minH = line.ref.bottom - line.ref.top
        const normal = line.rects.filter(r => r.bottom - r.top <= 1.5 * minH)
        line.top = Math.min(...normal.map(r => r.top))
        line.bottom = Math.max(...normal.map(r => r.bottom))
        line.words = line.rects
            .sort((a, b) => a.left - b.left)
            .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }))
        delete line.rects
        delete line.ref
    }

    return orderByColumns(lines)
}

// Columns = union of the lines' horizontal ranges. Lines are read column by
// column, top to bottom. Lines much wider than the rest (titles across a
// two-column page) are left out of the union so they don't merge the columns.
function orderByColumns(lines) {
    if (!lines.length) return lines
    const widths = lines.map(l => l.right - l.left).sort((a, b) => a - b)
    const typical = widths[Math.floor(widths.length / 2)]
    const narrow = lines.filter(l => l.right - l.left <= typical * 1.6)

    const cols = []
    for (const l of [...narrow].sort((a, b) => a.left - b.left)) {
        const last = cols.at(-1)
        if (last && l.left <= last.right) last.right = Math.max(last.right, l.right)
        else cols.push({ left: l.left, right: l.right })
    }

    const colOf = l => {
        const center = (l.left + l.right) / 2
        let best = 0, bestDist = Infinity
        cols.forEach((c, i) => {
            const d = center < c.left ? c.left - center : center > c.right ? center - c.right : 0
            if (d < bestDist) best = i, bestDist = d
        })
        return best
    }

    for (const l of lines) {
        const wide = l.right - l.left > typical * 1.6
        const c = cols[colOf(l)]
        l.col = wide ? -1 : cols.indexOf(c)
        l.colLeft = wide ? l.left : Math.min(c.left, l.left)
        l.colRight = wide ? l.right : Math.max(c.right, l.right)
    }

    // Wide lines split the page into vertical segments; inside each segment
    // the columns are read one after the other.
    const wide = lines.filter(l => l.col === -1).sort((a, b) => a.top - b.top)
    const rest = lines.filter(l => l.col !== -1)
    const ordered = []
    let segStart = -Infinity
    for (const w of [...wide, null]) {
        const segEnd = w ? w.top : Infinity
        ordered.push(...rest
            .filter(l => l.top >= segStart && l.top < segEnd)
            .sort((a, b) => a.col - b.col || a.top - b.top))
        if (w) ordered.push(w)
        segStart = segEnd
    }
    return ordered
}

// Index of the line under (or closest to) a vertical/horizontal point.
export function lineIndexAt(lines, x, y) {
    let best = -1, bestDist = Infinity
    lines.forEach((l, i) => {
        const dy = y < l.top ? l.top - y : y > l.bottom ? y - l.bottom : 0
        const dx = x < l.colLeft ? l.colLeft - x : x > l.colRight ? x - l.colRight : 0
        const d = dy * 3 + dx
        if (d < bestDist) best = i, bestDist = d
    })
    return best
}
