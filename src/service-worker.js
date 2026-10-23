/*
  Service worker: guarda la aplicación para usarla sin conexión.
  No se sirve tal cual: vite.config.ts lo copia al build como sw.js reemplazando la versión
  y la lista de archivos, así cada versión nueva usa una caché propia y borra la anterior.
*/

const CACHE = 'debug8086-__VERSION__';
/** La página y todos los archivos del build (con hash en el nombre: no cambian nunca). */
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // La página va primero a la red, para recibir versiones nuevas; sin conexión, la guardada
    event.respondWith(fetch(request).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
