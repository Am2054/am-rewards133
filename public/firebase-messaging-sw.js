importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

console.log('🔧 Service Worker loaded');

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

console.log('✅ Firebase initialized in Service Worker');

// ✅ استقبال الإشعارات في الخلفية
messaging.onBackgroundMessage((payload) => {
    console.log('📬 Background message received:', payload);
    
    const notificationTitle = payload.notification?.title || 'شات الأشباح';
    const notificationOptions = {
        body: payload.notification?.body || 'رسالة جديدة',
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        tag: 'ghost-chat-msg',
        renotify: true,  // ✅ تراكمية
        requireInteraction: false,
        silent: false,
        priority: 'high',
        vibrate: [200, 100, 200],
        data: payload.data || {}
    };

    console.log('📢 Showing notification:', notificationTitle);
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// ✅ معالجة الضغط على الإشعار
self.addEventListener('notificationclick', function(event) {
    console.log('🖱️ Notification clicked');
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || 'https://am-rewards.vercel.app/ghost-chat.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            // البحث عن نافذة مفتوحة
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('am-rewards.vercel.app') && 'focus' in client) {
                    console.log('🔍 Found existing window, focusing');
                    return client.focus();
                }
            }
            // فتح نافذة جديدة
            if (clients.openWindow) {
                console.log('📂 Opening new window');
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

console.log('✅ Service Worker ready');
