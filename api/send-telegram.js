// /api/send-telegram.js
import { notify } from "../lib/notifications.js";

export default async function handler(req, res) {
  // 1. تفعيل ترويسات CORS للسماح بالاتصال من الصفحات المحلية (Localhost) أو أي نطاق آخر
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 2. معالجة طلب OPTIONS (Preflight Request) الذي يرسله المتصفح تلقائياً للتأكد من الأمان
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    // تأمين قراءة محتوى الطلب (Body) سواء كان كائناً جاهزاً أو نصاً خاماً
    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.warn("Failed to parse body string as JSON:", e);
      }
    }

    const { type, data } = body || {};

    if (!type || !data) {
      return res.status(400).json({
        error: "Missing type or data parameters in request body."
      });
    }

    // 💡 قاموس التحويل الذكي لمطابقة مسميات الواجهة الأمامية بالخلفية
    const typeMapping = {
      "new_user": "newUser",
      "new_property": "newProperty",
      "new_ticket": "newTicket",
      "new_message": "newMessage",
      "report": "report"
    };

    const mappedType = typeMapping[type] || type;

    // التحقق من وجود الدالة المطلوبة في مركز الإشعارات بعد التحويل
    if (!notify[mappedType]) {
      return res.status(400).json({
        error: `Unknown notification type: ${type}`
      });
    }

    // التقاط الـ IP الخاص بالزائر تلقائياً وتمريره للرسالة
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "Unknown";
    const enhancedData = { ...data, ip };

    // تنفيذ الإشعار وإرساله إلى تليجرام باستخدام الاسم المطابق
    await notify[mappedType](enhancedData);

    return res.status(200).json({
      success: true
    });

  } catch (err) {
    console.error("Telegram API Route Error:", err);
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}
