/* 边下边存用的 Service Worker（作用域 /stream-saver/），见 src/lib/stream-saver.ts */
/* eslint-disable no-restricted-globals */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// 下载地址 → [ReadableStream | null, 请求数据, MessagePort]
var downloads = new Map();

self.addEventListener('message', function (event) {
  var data = event.data;
  if (data === 'ping' || !data || typeof data !== 'object' || !data.pathname)
    return;

  var port = event.ports[0];
  if (!port) return;
  var url = self.registration.scope + data.pathname;
  var entry = [null, data, port];

  if (data.transferringReadable) {
    port.onmessage = function (evt) {
      if (evt.data && evt.data.readableStream) {
        port.onmessage = null;
        entry[0] = evt.data.readableStream;
      }
    };
  } else {
    entry[0] = new ReadableStream({
      start: function (controller) {
        port.onmessage = function (evt) {
          if (evt.data === 'end') return controller.close();
          if (evt.data === 'abort')
            return controller.error(new Error('Aborted'));
          controller.enqueue(evt.data);
        };
      },
      cancel: function () {
        port.postMessage({ abort: true });
      },
    });
  }

  downloads.set(url, entry);
  port.postMessage({ download: url });
});

self.addEventListener('fetch', function (event) {
  var entry = downloads.get(event.request.url);
  if (!entry) return;
  downloads.delete(event.request.url);

  var stream = entry[0];
  var data = entry[1];
  var port = entry[2];
  if (!stream) {
    event.respondWith(new Response('stream not ready', { status: 500 }));
    return;
  }

  var headers = new Headers({
    'Content-Type': 'application/octet-stream; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'",
    'X-Content-Type-Options': 'nosniff',
  });
  var incoming = new Headers(data.headers || {});
  if (incoming.has('Content-Disposition')) {
    headers.set('Content-Disposition', incoming.get('Content-Disposition'));
  }
  if (incoming.has('Content-Length')) {
    headers.set('Content-Length', incoming.get('Content-Length'));
  }

  // 浏览器取消下载时通知页面
  var reader = stream.getReader();
  var body = new ReadableStream({
    pull: function (controller) {
      return reader.read().then(function (result) {
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      });
    },
    cancel: function (reason) {
      try {
        port.postMessage({ abort: true });
      } catch (e) {
        /* ignore */
      }
      return reader.cancel(reason);
    },
  });

  event.respondWith(new Response(body, { headers: headers }));
});
