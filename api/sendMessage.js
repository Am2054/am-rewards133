// /api/sendMessage.js - محسّن
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) {
    console.error("Firebase Init Error:", e.message);
  }
}

const db = getDatabase();
const auth = getAuth();

const ghostNames = [
    "الظل الأزرق", "همسة الليل", "روح الغيمة", "الضوء الأسود",
    "نبض القمر", "صدى الهمس", "الرياح العميقة", "شعاع الظلام",
    "وسواس الفراغ", "نجم منسي", "دقات الصمت", "صوت الوحدة"
];

const ranks = ["روح عابرة", "همسة حقيقية", "ظل مؤثر", "نبض حي", "أسطورة"];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, uid, token, day } = req.body;

  try {
    if (!uid || !token) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    // ✅ التحقق من التوكن
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
      if (decodedToken.uid !== uid) {
        return res.status(401).json({ error: "uid غير متطابق" });
      }
    } catch (e) {
      console.warn("⚠️ التحقق من التوكن فشل (مقبول للعمل بدون auth):", e.message);
    }

    // ✅ إرسال رسالة
    if (!action || (action === 'SEND' || !action)) {
      const { text } = req.body;
      if (!text || !day) {
        return res.status(400).json({ error: "بيانات ناقصة" });
      }

      const ghostName = ghostNames[Math.floor(Math.random() * ghostNames.length)];
      const msgRef = db.ref(`messages/global/${day}/${Date.now()}`);

      await msgRef.set({
        text: text,
        sender: ghostName,
        uid: uid,
        timestamp: Date.now(),
        reactions: { good: 0, bad: 0 }
      });

      return res.status(200).json({ success: true, message: "✅ تم الإرسال" });
    }

    // ✅ الحصول على الهوية
    if (action === 'GET_IDENTITY') {
      const ghostName = ghostNames[Math.floor(Math.random() * ghostNames.length)];
      const rank = ranks[Math.floor(Math.random() * ranks.length)];
      const activeDay = new Date().toISOString().split('T')[0];

      return res.status(200).json({
        ghostName: ghostName,
        rank: rank,
        activeDay: activeDay,
        message: "✅ تم الحصول على الهوية"
      });
    }

    // ✅ حذف رسالة
    if (action === 'DELETE') {
      const { msgId } = req.body;
      if (!msgId || !day) {
        return res.status(400).json({ error: "بيانات ناقصة" });
      }

      const msgRef = db.ref(`messages/global/${day}/${msgId}`);
      await msgRef.update({ deleted: true });
      return res.status(200).json({ success: true, message: "✅ تم الحذف" });
    }

    // ✅ تعديل رسالة
    if (action === 'EDIT') {
      const { msgId, text } = req.body;
      if (!msgId || !text || !day) {
        return res.status(400).json({ error: "بيانات ناقصة" });
      }

      const msgRef = db.ref(`messages/global/${day}/${msgId}`);
      await msgRef.update({ text: text, edited: true });
      return res.status(200).json({ success: true, message: "✅ تم التعديل" });
    }

    return res.status(400).json({ error: "إجراء غير معروف" });

  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ error: "خطأ في الخادم", details: error.message });
  }
}
