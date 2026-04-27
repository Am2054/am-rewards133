// firebase-messaging-sw.js - نظام الإشعارات التراكمي المحسّن
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging.js');

const firebaseConfig = {
    apiKey: "AIzaSyBfOJPkWbmcJ6s29bDNysr-H0Kx-Js3Gy0",
    authDomain: "am--rewards.firebaseapp.com",
    databaseURL: "https://am--rewards-default-rtdb.firebaseio.com",
    projectId: "am--rewards",
    storageBucket: "am--rewards.firebasestorage.app",
    messagingSenderId: "744783579735",
    appId: "1:744783579735:web:45e00de9998893bbc9b112"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ✅ متغيرات النظام التراكمي
const NOTIFICATION_GROUP_KEY = 'ghost_chat_group';
const NOTIFICATION_TIMEOUT = 5000; // 5 ثوانٍ
let notificationQueue = [];
let notificationTimer = null;
let lastNotificationCount = 0;

// ✅ دالة لإظهار إشعار تراكمي
async function showGroupedNotification() {
    if (notificationQueue.length === 0) return;

    console.log(`📦 إظهار إشعار تراكمي: ${notificationQueue.length} رسالة`);

    let title, body, badgeText;

    if (notificationQueue.length === 1) {
        const notification = notificationQueue[0];
        title = notification.title;
        body = notification.body;
        badgeText = '💬';
    } else {
        const senders = [...new Set(notificationQueue.map(n => n.sender))];
        title = `💬 ${senders.length} أشباح يتحدثون`;
        
        if (senders.length === 2) {
            body = `${senders[0]} و ${senders[1]}: ${notificationQueue.length} رسالة جديدة`;
        } else if (senders.length > 2) {
            body = `${senders.slice(0, 2).join(' و ')} و ${senders.length - 2} آخرون: ${notificationQueue.length} رسالة جديدة`;
        } else {
            body = `${senders[0]}: ${notificationQueue.length} رسالة جديدة`;
        }
        
        badgeText = `${notificationQueue.length}`;
    }

    const notificationOptions = {
        body: body,
        icon: '👻',
        badge: badgeText,
        tag: NOTIFICATION_GROUP_KEY,
        renotify: true,
        requireInteraction: notificationQueue.length > 1,
        data: {
            messageCount: notificationQueue.length,
            senders: [...new Set(notificationQueue.map(n => n.sender))].join(','),
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'open',
                title: '🔓 فتح الشات',
                icon: '👻'
            },
            {
                action: 'close',
                title: '✕ إغلاق',
                icon: '❌'
            }
        ]
    };

    try {
        await self.registration.showNotification(title, notificationOptions);
        lastNotificationCount = notificationQueue.length;
    } catch (err) {
        console.error('❌ خطأ في عرض الإشعار:', err);
    }
}

// ✅ إضافة إشعار للطابور
function queueNotification(payload) {
    const isDuplicate = notificationQueue.some(n => 
        n.sender === payload.notification?.title && 
        n.body === payload.notification?.body
    );

    if (isDuplicate) {
        console.log('🔇 إشعار مكرر - تم التجاهل');
        return;
    }

    notificationQueue.push({
        title: payload.notification?.title || 'شات الأشباح',
        body: payload.notification?.body || 'رسالة جديدة',
        sender: payload.notification?.title || 'روح غامضة',
        timestamp: Date.now(),
        data: payload.data || {}
    });

    console.log(`✅ تمت إضافة رسالة للطابور (${notificationQueue.length} رسائل)`);

    if (notificationTimer) {
        clearTimeout(notificationTimer);
    }

    notificationTimer = setTimeout(() => {
        showGroupedNotification();
        notificationQueue = [];
        notificationTimer = null;
    }, NOTIFICATION_TIMEOUT);
}

// ✅ معالج الإشعارات في الخلفية
messaging.onBackgroundMessage((payload) => {
    console.log('🔔 إشعار خلفية:', payload);
    queueNotification(payload);
});

// ✅ معالج النقر على الإشعار
self.addEventListener('notificationclick', (event) => {
    console.log('✅ تم النقر على الإشعار:', event.action);
    
    if (event.action === 'close') {
        event.notification.close();
        return;
    }

    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (let client of clientList) {
                if (client.url.includes('ghost-chat') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('https://am-rewards.vercel.app/ghost-chat.html');
            }
        })
    );
});

// ✅ إغلاق الإشعار
self.addEventListener('notificationclose', (event) => {
    console.log('❌ تم إغلاق الإشعار');
    if (event.notification.tag === NOTIFICATION_GROUP_KEY) {
        notificationQueue = [];
        if (notificationTimer) {
            clearTimeout(notificationTimer);
            notificationTimer = null;
        }
    }
});

// ✅ التثبيت
self.addEventListener('install', (event) => {
    console.log('📦 تثبيت Service Worker');
    self.skipWaiting();
});

// ✅ التفعيل والتنظيف
self.addEventListener('activate', (event) => {
    console.log('🚀 تفعيل Service Worker');
    
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            for (const cacheName of cacheNames) {
                await caches.delete(cacheName);
            }
        })()
    );
    
    self.clients.claim();
});

// ✅ معالج الرسائل من الصفحة
self.addEventListener('message', (event) => {
    console.log('📨 رسالة من الصفحة:', event.data);
    
    if (event.data.type === 'CLEAR_NOTIFICATIONS') {
        notificationQueue = [];
        if (notificationTimer) {
            clearTimeout(notificationTimer);
            notificationTimer = null;
        }
        console.log('🗑️ تم تنظيف طابور الإشعارات');
    }
    
    if (event.data.type === 'FORCE_SHOW_NOTIFICATIONS') {
        if (notificationTimer) {
            clearTimeout(notificationTimer);
            notificationTimer = null;
        }
        showGroupedNotification();
        notificationQueue = [];
    }
});
