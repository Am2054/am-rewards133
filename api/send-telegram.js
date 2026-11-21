// /api/send-telegram.js — إشعارات تليجرام (للمستخدمين المسجلين فقط)
import { notify } from "../lib/notifications.js";
import { verifyUser, adminDb } from "../lib/verifyUser.js";

// الأنواع المسموح للمستخدم العادي بإطلاقها من المتصفح.
// new_user و admin_login غير موجودين هنا لأنهم يُرسلون من السيرفر فقط.
const TYPES = {
  new_property: "newProperty",
  edit_property: "editProperty",
  new_ticket: "newTicket",
  new_message: "newMessage",
  report: "report",
  delete_account: "deleteAccount",
};

const clip = (v, n = 500) => String(v ?? "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const user = await verifyUser(req);
  if (!user) {
    return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const { type, data } = body || {};

  const fn = TYPES[type];
  if (!fn || !notify[fn]) {
    return res.status(400).json({ error: "نوع الإشعار غير معروف" });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "Unknown";

  try {
    let payload;

    if (type === "new_property" || type === "edit_property") {
      // لا نصدّق البيانات القادمة من المتصفح: نقرأ العقار من قاعدة البيانات ونتأكد أنه ملك المستخدم
      const id = clip(data?.propertyId, 100);
      if (!id) return res.status(400).json({ error: "propertyId مطلوب" });

      const snap = await adminDb().collection("properties").doc(id).get();
      if (!snap.exists || snap.data().ownerId !== user.uid) {
        return res.status(403).json({ error: "غير مسموح" });
      }
      const p = snap.data();
      payload = {
        title: clip(p.title, 150),
        type: clip(p.propertyType, 30),
        price: Number(p.price) || 0,
        owner: clip(p.ownerName, 80),
        propertyId: id,
      };
    } else {
      // باقي الأنواع: نقص النصوص ونضيف هوية المرسل من التوكن
      payload = {};
      for (const [k, v] of Object.entries(data || {}).slice(0, 20)) {
        payload[k] = typeof v === "number" ? v : clip(v);
      }
      payload.userId = user.uid;
    }

    await notify[fn]({ ...payload, ip });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Telegram API Route Error:", err);
    return res.status(500).json({ success: false, error: "فشل إرسال الإشعار" });
  }
}
