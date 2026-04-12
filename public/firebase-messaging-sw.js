// استيراد المكتبات بنفس إصدارك
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// تهيئة Firebase بنفس بياناتك الأصلية بدون أي تغيير
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

// التحقق من وصول الرسائل في الخلفية (يدعم الشات والأسعار)
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        sound: '/notification.mp3', 
        // نستخدم tag مختلف بناءً على نوع الإشعار لمنع تداخل الإشعارات
        tag: payload.data && payload.data.type === 'price' ? 'price-alert' : 'ghost-chat-msg', 
        renotify: true,
        data: {
            // استلام الرابط من السيرفر سواء للشات أو لصفحة الأسعار
            url: payload.data && payload.data.url ? payload.data.url : '/' 
        }
    };
    
    if (payload.notification) {
       self.registration.showNotification(notificationTitle, notificationOptions);
    }
});

// --- معالجة الضغط على الإشعار (توجيه المستخدم للرابط الصحيح) ---
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); 

    const targetUrl = event.notification.data.url || '/';
    const urlToOpen = new URL(targetUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus(); 
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// تفعيل التحديث الفوري للـ Service Worker لضمان عمل التغييرات
self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// إضافة مستمع لحالات الخطأ لضمان استمرارية الخدمة
self.addEventListener('error', function(e) {
    console.error('Service Worker Error', e.message);
});
