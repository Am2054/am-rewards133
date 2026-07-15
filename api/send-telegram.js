// api/send-telegram.js
import { notify } from "../lib/notifications.js";

export default async function handler(req, res) {
  // التأكد من أن الطلب المرسل هو POST فقط
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { type, data } = req.body;

    // التأكد من وجود البيانات الأساسية ونوع الإشعار
    if (!type || !data) {
      return res.status(400).json({ error: "Missing type or data parameters." });
    }

    // التحقق من أن نوع الإشعار مسجل برمجياً لدينا
    if (!notify[type]) {
      return res.status(400).json({ error: `Unknown notification type: ${type}` });
    }

    // التقاط الـ IP الخاص بالزائر تلقائياً لتسهيل المراقبة
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "Unknown";
    const enhancedData = { ...data, ip };

    // استدعاء الدالة المناسبة بناءً على النوع
    await notify[type](enhancedData);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
