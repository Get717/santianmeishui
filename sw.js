// 缓存版本
const CACHE_NAME = 'stm-v483';

// 需要缓存的静态文件
const URLS_TO_CACHE = [
  './index.html',
  './manifest.json',

  './css/call.css',
  './css/offline.css',
  './css/fate.css',
  './css/match.css',
  './css/htmlPreview.css',
  './css/moments.css',
  './css/group.css',
  './css/games.css',
  './css/simulatorGame.css',
  './css/search.css',
  './css/favorites.css',
  './css/underMode.css',
  './css/inlineOffline.css',
  './css/reading.css',
  './css/stickerSuggest.css',

  './js/regex.js',
  './js/call.js',
  './js/memory.js',
  './js/offline.js',
  './js/fate.js',
  './js/match.js',
  './js/worldbook.js',
  './js/htmlPreview.js',
  './js/moments.js',
  './js/group.js',
  './js/autoMessage.js',
  './js/stickerSuggest.js',
  './js/location.js',
  './js/desktop.js',
  './js/games.js',
  './js/simulatorGame.js',
  './js/favoriteStore.js',
  './js/search.js',
  './js/favorites.js',
  './js/underMode.js',
  './js/inlineOffline.js',
  './js/reading.js',

  './presets/humid-tides.txt',

  './assets/p/p01.dat',
  './assets/p/p02.dat',
  './assets/p/p03.dat',
  './assets/p/p04.dat',
  './assets/p/p05.dat',
  './assets/p/p06.dat',
  './assets/p/p07.dat'
];

// 安装时缓存静态文件
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// 请求处理
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 非 GET 请求不缓存，避免影响 API / 登录 / 上传等请求
  if (e.request.method !== 'GET') {
    return;
  }

  // 跳过后端 API 请求
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 页面导航走网络优先。
  // 这样 PWA 每次打开时会优先拿最新 index.html，
  // 避免一直吃旧缓存导致按钮/页面逻辑异常。
  if (e.request.mode === 'navigate' || e.request.destination === 'document') {
    e.respondWith(
      fetch(e.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put('./index.html', copy).catch(() => {});
        });
        return response;
      }).catch(() => {
        return caches.match('./index.html');
      })
    );
    return;
  }

  // 提示词资源走网络优先，缓存兜底。
  // 原因：
  // 1. 主文件请求 assets/p/*.dat 时会带 ?v=xxx；
  // 2. 预缓存里通常是不带 ?v 的路径；
  // 3. 离线时需要忽略 query 参数匹配缓存。
  if (url.pathname.includes('/assets/p/')) {
    e.respondWith(
      fetch(e.request).then((response) => {
        const copy = response.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, copy).catch(() => {});
        });

        return response;
      }).catch(() => {
        return caches.match(e.request, { ignoreSearch: true });
      })
    );
    return;
  }

  // 静态资源走缓存优先，没有再走网络
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, copy).catch(() => {});
        });
        return response;
      });
    })
  );
});
