// firebase-messaging-sw.js - Service Worker المحسّن النهائي

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
    const notificationTitle = payload.notification.title;
    // ✨ عرض الرسالة كاملة مع معلومات المُرسل
    const notificationOptions = {
        body: payload.notification.body, // الرسالة كاملة
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://your-domain.com/badge-icon.png',
        tag: 'ghost-chat-msg',
        renotify: true,
        data: payload.data || {}, // ✨ بتتضمن المرسل والرسالة الكاملة
        requireInteraction: false,
        silent: false,
        priority: 'high',
        vibrate: [200, 100, 200]
    };
    
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    const urlToOpen = new URL(
        event.notification.data?.url || '/', 
        self.location.origin
    ).href;
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            // تحقق من النافذة الموجودة
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url.includes('am-rewards.vercel.app') && 'focus' in client) {
                    client.focus();
                    // أرسل رسالة للـ Frontend مع بيانات المرسل والرسالة
                    client.postMessage({
                        type: 'NOTIFICATION_CLICKED',
                        data: event.notification.data
                    });
                    return;
                }
            }
            // إذا ما في نافذة مفتوحة، افتح واحدة جديدة
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
