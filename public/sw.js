const SHELL_CACHE = 'thor-track-shell-v1';
const DATA_CACHE = 'thor-track-data-v1';
const CACHE_NAMES = new Set([SHELL_CACHE, DATA_CACHE]);

function isCacheableUrl(url) {
  return (
    url.origin === self.location.origin &&
    !url.pathname.startsWith('/__debug') &&
    !url.pathname.startsWith('/signin-with-chatgpt') &&
    !url.pathname.startsWith('/signout-with-chatgpt')
  );
}

async function putResponse(cacheName, request, response) {
  if (!response.ok || response.type === 'opaque') return response;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch {
    // A full or blocked cache must never turn a successful network request into a failure.
  }
  return response;
}

async function seedAppShell() {
  const rootRequest = new Request('/', { cache: 'reload' });
  const rootResponse = await fetch(rootRequest);
  if (!rootResponse.ok) return;

  await putResponse(SHELL_CACHE, rootRequest, rootResponse);
  const html = await rootResponse.clone().text();
  const discoveredUrls = new Set();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], self.location.origin);
    if (isCacheableUrl(url) && url.pathname !== '/') discoveredUrls.add(url.href);
  }

  await Promise.allSettled(
    [...discoveredUrls].map(async (url) => {
      const request = new Request(url, { cache: 'reload' });
      const response = await fetch(request);
      await putResponse(SHELL_CACHE, request, response);
    }),
  );
}

function markAsOffline(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Thor-Track-Offline', '1');
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function networkFirst(request, cacheName, rootFallback = false, markCachedResponse = false) {
  try {
    const response = await fetch(request);
    return await putResponse(cacheName, request, response);
  } catch {
    const cached = await caches.match(request);
    if (cached) return markCachedResponse ? markAsOffline(cached) : cached;
    if (rootFallback) {
      const root = await caches.match('/');
      if (root) return root;
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return putResponse(SHELL_CACHE, request, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(seedAppShell().finally(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith('thor-track-') && !CACHE_NAMES.has(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!isCacheableUrl(url)) return;

  if (url.pathname === '/api/shipments') {
    event.respondWith(networkFirst(request, DATA_CACHE, false, true));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, true));
    return;
  }

  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname.startsWith('/assets/') ||
    /\.(?:css|gif|ico|jpe?g|js|png|svg|webp|woff2?)$/i.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});
