// تصحيح الحرف الأول ليكون صغير
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

// التحقق من وصول الرسائل في الخلفية
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png',
        // التعديل لضمان التوافق ومنع التكرار:
        tag: 'ghost-chat-msg', 
        renotify: true,
        // إضافة بيانات إضافية لاستخدامها عند الضغط (استلام الرابط من السيرفر)
        data: {
            url: payload.data && payload.data.url ? payload.data.url : '/' 
        }
    };
    self.registration.showNotification(notificationTitle, notificationOptions);
});

// --- التعديلات الجديدة لحل مشاكلك ---

// 1. جعل الإشعار يفتح الموقع عند الضغط عليه
self.addEventListener('notificationclick', function(event) {
    event.notification.close(); // إغلاق الإشعار فور الضغط

    // الرابط الذي سيتم فتحه (استخراج الرابط المرسل من السيرفر أو الافتراضي)
    const targetUrl = event.notification.data.url;
    const urlToOpen = new URL(targetUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
            // التحقق إذا كان الموقع مفتوحاً في أي تبويب حالياً
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                // إذا كان الرابط مفتوحاً، نركز عليه فقط
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus(); 
                }
            }
            // إذا كان مغلقاً، نفتح نافذة جديدة بالرابط المحدد
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

// 2. تفعيل التحديث الفوري للـ Service Worker لضمان عمل التغييرات
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
