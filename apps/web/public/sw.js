// PixChats Service Worker — фоновые и системные уведомления для телефонов (Android / iOS PWA) и ПК браузеров

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'PIXCHATS_SHOW_NOTIFICATION') return;

  const title = data.title || 'PixChats';
  const options = {
    body: data.body || '',
    icon: data.icon || './logo/icon.png',
    badge: data.icon || './logo/icon.png',
    tag: data.tag || 'pixchats-' + Date.now(),
    renotify: true,
    silent: Boolean(data.silent),
    vibrate: data.silent ? undefined : [220, 100, 220],
    data: {
      url: data.url || '/chats/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'PixChats', body: event.data ? event.data.text() : 'Новое сообщение' };
  }

  const title = payload.title || 'PixChats';
  const options = {
    body: payload.body || 'У вас новое уведомление в PixChats',
    icon: payload.icon || './logo/icon.png',
    badge: payload.icon || './logo/icon.png',
    tag: payload.tag || 'pixchats-push-' + Date.now(),
    renotify: true,
    vibrate: [220, 100, 220],
    data: {
      url: payload.url || '/chats/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/chats/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          try {
            client.postMessage({ type: 'PIXCHATS_NOTIFICATION_CLICK', url: targetUrl });
          } catch {}
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
