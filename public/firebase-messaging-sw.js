// /firebase-messaging-sw.js — إشعارات الرسائل في الخلفية (يوضع في جذر الموقع)
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

// تحديث فوري للـ Service Worker عند نشر نسخة جديدة
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const ICON = "/icon-192.png"; // ضع أيقونة الموقع (192×192) في هذا المسار، وإن لم تكن موجودة يظهر الإشعار بدونها
const CHAT_PATH = "/chat.html";

// مهم: معالج النقر يُسجَّل قبل firebase.messaging()، وإلا يستولي معالج Firebase الافتراضي
// على الحدث ولا يفتح شيئاً (لأن الرسالة بدون fcmOptions.link).
self.addEventListener("notificationclick", (event) => {
  event.stopImmediatePropagation();
  event.notification.close();

  // نأخذ roomId فقط من الرابط ونبني الرابط على نفس نطاق الموقع (لا نفتح أي نطاق آخر)
  const data = event.notification.data || {};
  const raw = data.url || (data.FCM_MSG && data.FCM_MSG.data && data.FCM_MSG.data.url) || "";
  let roomId = "";
  try { roomId = new URL(raw, self.location.origin).searchParams.get("roomId") || ""; } catch (e) { /* تجاهل */ }
  const target = new URL(CHAT_PATH + (roomId ? "?roomId=" + encodeURIComponent(roomId) : ""), self.location.origin).href;

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) {
      if (new URL(c.url).pathname.endsWith(CHAT_PATH)) {
        // صفحة الشات مفتوحة: نفتح الغرفة المطلوبة بداخلها بدون إعادة تحميل
        if (roomId) c.postMessage({ type: "open-room", roomId });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

firebase.initializeApp({
  apiKey: "AIzaSyBfOJPkWbmcJ6s29bDNysr-H0Kx-Js3Gy0",
  authDomain: "am--rewards.firebaseapp.com",
  databaseURL: "https://am--rewards-default-rtdb.firebaseio.com",
  projectId: "am--rewards",
  storageBucket: "am--rewards.firebasestorage.app",
  messagingSenderId: "744783579735",
  appId: "1:744783579735:web:45e00de9998893bbc9b112",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // لو الرسالة فيها notification فـ Firebase يعرضها تلقائياً، وعرضها هنا مرة ثانية يكرر الإشعار
  if (payload.notification) return;

  const d = payload.data || {};
  return self.registration.showNotification(d.title || "رسالة جديدة", {
    body: d.body || "لديك رسالة غير مقروءة",
    icon: ICON,
    badge: ICON,
    tag: "am-chat-msg",
    renotify: true,
    vibrate: [200, 100, 200],
    dir: "rtl",
    lang: "ar",
    data: d,
  });
});
