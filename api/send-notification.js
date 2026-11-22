// /api/send-notification.js — إشعار Push لطرف المحادثة الآخر (للمستخدمين المسجلين فقط)
import { getMessaging } from "firebase-admin/messaging";
import { verifyUser, adminDb, adminRtdb } from "../lib/verifyUser.js";

const SITE = process.env.SITE_URL || "https://am-property.vercel.app";
const clip = (v, n) => String(v ?? "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1) لازم مستخدم مسجل دخول
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });

  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = null; }
  }
  const { receiverId, body, roomId } = data || {};
  if (!receiverId || !body || !roomId) {
    return res.status(400).json({ error: "receiverId و body و roomId مطلوبين" });
  }

  try {
    const rdb = adminRtdb();

    // 2) المرسل والمستلم لازم يكونوا الطرفين في نفس غرفة المحادثة
    const room = (await rdb.ref(`chatRooms/${clip(roomId, 200)}`).once("value")).val();
    const p = room?.participants || {};
    if (!room || p[user.uid] !== true || p[receiverId] !== true || receiverId === user.uid) {
      return res.status(403).json({ error: "غير مسموح" });
    }

    // 3) توكن المستلم
    const token = (await rdb.ref(`users_tokens/${receiverId}`).once("value")).val()?.token;
    if (typeof token !== "string" || token.length < 10) {
      return res.status(200).json({ success: false, reason: "no_token" });
    }

    // 4) اسم المرسل من قاعدة البيانات (لا نصدق الاسم القادم من المتصفح)
    const snap = await adminDb().collection("users").doc(user.uid).get();
    const name = clip(snap.exists ? snap.data().name : "", 40) || "طرف آخر";

    const payload = {
      notification: {
        title: `💬 رسالة جديدة من ${name}`,
        body: clip(body, 150),
      },
      data: {
        url: `${SITE}/chat.html?roomId=${encodeURIComponent(clip(roomId, 200))}`,
        senderName: name,
      },
      android: { priority: "high", notification: { tag: "am-chat-msg" } },
      webpush: { headers: { Urgency: "high" }, notification: { tag: "am-chat-msg" } },
      token,
    };

    try {
      const id = await getMessaging().send(payload);
      return res.status(200).json({ success: true, messageId: id });
    } catch (err) {
      // التوكن قديم أو ملغي: نحذفه حتى لا نحاول عليه مرة أخرى
      if (err.code === "messaging/registration-token-not-registered" || err.code === "messaging/invalid-registration-token") {
        await rdb.ref(`users_tokens/${receiverId}`).remove();
        return res.status(200).json({ success: false, reason: "stale_token" });
      }
      throw err;
    }
  } catch (err) {
    console.error("Notification Sender Error:", err);
    return res.status(500).json({ error: "فشل إرسال الإشعار" });
  }
}
