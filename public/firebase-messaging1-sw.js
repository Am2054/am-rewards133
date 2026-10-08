// firebase-messaging-sw.js - النسخة المانعة لتكرار الإشعارات
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

// 📬 استقبال الإشعارات في الخلفية مع منع التكرار
messaging.onBackgroundMessage((payload) => {
    // 🛑 سر منع التكرار: إذا قام أندرويد بعرض الإشعار تلقائياً عبر payload.notification، نمنع الـ Service Worker من عرضه مرة ثانية
    if (payload.notification) {
        return; 
    }

    const title = payload.data?.title || 'شات الأشباح 👻';
    const options = {
        body: payload.data?.body || 'لديك همسة جديدة في الظلام..',
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        tag: 'ghost-chat-latest', // يستبدل الإشعار القديم ولا يراكم تكراراً
        renotify: true,
        data: payload.data || {}
    };

    return self.registration.showNotification(title, options);
});

// 🖱️ فتح التطبيق عند النقر
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/ghost-chat.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if ('focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
