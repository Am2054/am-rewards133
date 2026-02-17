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
        badge: 'https://cdn-icons-png.flaticon.com/512/633/633600.png'
    };
    self.registration.showNotification(notificationTitle, notificationOptions);
});

