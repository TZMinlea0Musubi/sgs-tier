/* 三国杀 DIY 梯度榜 · 离线缓存 service worker
 * 缓存名随版本号走（12.9 由 publish_pages.py 从 rules.json 注入），
 * 每次发布都会换名 → 浏览器重新安装 → 重新预缓存全部卡图，用户不会拿到旧内容。
 *
 * 策略：
 *  - install：先把「壳」(index.html / cards-data.js / cards-docs.js / asset-manifest.json)
 *    预缓存，再后台拉 asset-manifest.json 把全部卡图一张张 cache.add（单张失败不影响其余）。
 *    skipWaiting 让新 SW 立刻生效，预载马上开始。
 *  - activate：删掉旧版本缓存，clients.claim 接管已打开的页面。
 *  - fetch：
 *      页面 / 数据 / 清单 / sw.js → 网络优先，离线回退缓存（联网拿最新，断网仍有旧内容）；
 *      导航请求离线则回退 index.html（单页应用，没有真正的子 URL）；
 *      卡图等静态资源 → 缓存优先，缺失才走网络并后台补缓存（看过的图断网也能看）。
 */
const CACHE = 'sgs-12.9';
const SHELL = ['./', 'index.html', 'cards-data.js', 'cards-docs.js', 'asset-manifest.json'];

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL).catch(function () {});        // 壳：任意一项失败也不阻断
    // 后台预载全部卡图（用户要的“断网也能看已加载内容”）
    try {
      const res = await fetch('asset-manifest.json', { cache: 'no-cache' });
      const data = await res.json();
      const urls = Array.isArray(data) ? data : (data.urls || []);
      await Promise.all(urls.map(function (u) {
        return cache.add(u).catch(function () {});           // 单张失败忽略，不整批失败
      }));
    } catch (e) { /* 清单缺失则只缓存已访问过的图 */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      if (k !== CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 网络优先组：页面 / 数据 / 清单 / sw 自身
  const networkFirst = req.mode === 'navigate' ||
    /\/(index\.html|cards-data\.js|cards-docs\.js|asset-manifest\.json|sw\.js)$/.test(url.pathname);

  if (networkFirst) {
    event.respondWith((async function () {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req) ||
          (req.mode === 'navigate' ? caches.match('index.html') : null);
        return cached || Response.error();
      }
    })());
    return;
  }

  // 卡图等静态资源：缓存优先，缺失则网络并在后台存入
  event.respondWith((async function () {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return Response.error();
    }
  })());
});
