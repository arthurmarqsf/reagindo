const C = 'reagindo-v13';
const SONS = ['risada', 'plateia', 'aplausos', 'buzina', 'rufar', 'triste', 'grilo', 'explosao', 'campainha'].map((s) => 'sons/' + s + '.m4a');
const ASSETS = ['./', 'index.html', 'style.css', 'fixmp4.js', 'app.js', 'editor.js', 'prompter.js', 'extras.js', 'install.js', 'seg-worker.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', ...SONS];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))); self.clients.claim(); });
// rede primeiro (pega atualizações do GitHub), cache se estiver offline
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && r.status === 200) { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
