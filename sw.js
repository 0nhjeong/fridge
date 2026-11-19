/* 냉털집사 - Service Worker
 * 코드를 수정해서 다시 배포할 때는 CACHE 이름의 숫자를 올리고, js/app.js의 APP_VERSION도 같은 숫자로 맞춰 주세요.
 *
 * 동작 방식: 인터넷이 되면 항상 서버의 최신 파일을 쓰고(network-first),
 *           인터넷이 안 되거나 4초 넘게 느리면 저장해 둔 파일로 실행해요(오프라인 지원).
 */
const CACHE = 'fridge-pwa-v6';
const FONT_CACHE = 'fridge-fonts-v1'; // Pretendard 웹폰트(외부 CDN) — 한 번 받으면 오프라인에서도 사용
const FONT_HOST = 'cdn.jsdelivr.net';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/recipes.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];
const TIMEOUT_MS = 4000;

self.addEventListener('install', (e) => {
  // cache: 'reload' → 브라우저 HTTP 캐시(깃허브 10분 캐시)를 건너뛰고 서버에서 새로 받음
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 폰트(버전이 고정된 주소라 바뀌지 않음): 저장본 먼저, 없으면 받아서 저장
  if (url.hostname === FONT_HOST && url.pathname.includes('/pretendard')) {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }
      catch (err) { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (url.origin !== self.location.origin) return; // 만개의레시피 등 외부 링크는 건드리지 않음

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // no-cache → 서버에 '바뀌었나요?'를 매번 확인 (안 바뀌었으면 짧은 304 응답이라 빠름)
    const net = fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res && res.ok) cache.put(url.href, res.clone());
      return res;
    });
    const timeout = new Promise((r) => setTimeout(() => r(null), TIMEOUT_MS));
    let res = await Promise.race([net.catch(() => null), timeout]);
    if (res) return res;

    const cached = (await cache.match(url.href, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await cache.match(new URL('./index.html', self.registration.scope).href) : null);
    if (cached) {
      e.waitUntil(net.catch(() => {})); // 느린 네트워크면 뒤에서 마저 받아 다음 실행 때 반영
      return cached;
    }
    res = await net.catch(() => null);
    return res || new Response('오프라인 상태입니다.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
