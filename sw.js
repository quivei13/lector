// Offline support. tools/build_pwa.py fills in the file list and the version;
// in development the list stays empty and files are cached as they are used.
const VERSION = 'dev'
const PRECACHE = [/*FILES*/]
const CACHE = `lector-${VERSION}`

self.addEventListener('install', e => {
    self.skipWaiting()
    e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const key of await caches.keys())
            if (key.startsWith('lector-') && key !== CACHE) await caches.delete(key)
        await self.clients.claim()
    })())
})

// Network first, so a new version shows up as soon as there is a connection;
// the saved copy answers when offline or when the network is too slow.
const respond = async request => {
    const cache = await caches.open(CACHE)
    const network = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone())
        return response
    })
    const cached = await cache.match(request, { ignoreSearch: true })
        ?? (request.mode === 'navigate' ? await cache.match('index.html') : undefined)
    if (!cached) return network
    const slow = new Promise(resolve => setTimeout(() => resolve(cached), 2500))
    return Promise.race([network.catch(() => cached), slow])
}

self.addEventListener('fetch', e => {
    const url = new URL(e.request.url)
    if (e.request.method !== 'GET' || url.origin !== location.origin) return
    if (url.pathname.includes('/.samples/')) return
    e.respondWith(respond(e.request))
})
