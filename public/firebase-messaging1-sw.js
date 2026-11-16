importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBfOJPkWbmcJ6s29bDNysr-H0Kx-Js3Gy0",
    authDomain: "am--rewards.firebaseapp.com",
    databaseURL: "https://am--rewards-default-rtdb.firebaseio.com",
    projectId: "am--rewards",
    storageBucket: "am--rewards.firebasestorage.app",
    messagingSenderId: "744783579735",
    appId: "1:744783579735:web:45e00de9998893bbc9b112"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title || 'شات الأشباح 👻';
    const options = {
        body: payload.notification?.body || 'رسالة جديدة',
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        tag: 'ghost-chat-msg',
        renotify: true,
        vibrate: [200, 100, 200],
        data: payload.data || {}
    };
    return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || 'https://am-property.vercel.app/ghost-chat.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes('am-property.vercel.app') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
