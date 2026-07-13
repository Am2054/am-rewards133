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

// استقبال ومعالجة إشعارات المحادثة العقارية في الخلفية (Background Messaging)
messaging.onBackgroundMessage((payload) => {
    console.log('📬 Background message received:', payload);
    
    const notificationTitle = payload.notification?.title || payload.data?.title || 'رسالة عقارية جديدة';
    const notificationOptions = {
        body: payload.notification?.body || payload.data?.body || 'لديك رسالة غير مقروءة بخصوص العقار',
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        tag: 'am-chat-msg',
        renotify: true,
        requireInteraction: true,
        silent: false,
        vibrate: [200, 100, 200],
        data: payload.data || {}
    };

    console.log('📢 Showing background notification:', notificationTitle);
    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// معالجة توجيه المستخدم بدقة لصفحة chat.html عند النقر على الإشعار الوارد
self.addEventListener('notificationclick', function(event) {
    console.log('Notification clicked');
    event.notification.close();
    
    // تأمين الحصول على الرابط الديناميكي أو العودة للشات الافتراضي
    const urlToOpen = event.notification.data?.url || '/chat.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url.includes('chat.html') && 'focus' in client) {
                    console.log('🔍 Found existing chat window, focusing');
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                console.log('📂 Opening new chat window');
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

console.log('✅ Service Worker ready for AM Chat');
