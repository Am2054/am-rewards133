import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";

// تهيئة Firebase Admin بنفس طريقتك الناجحة
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY; // بنقرأ المفتاح من إعدادات فيرسل
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: "https://am--rewards-default-rtdb.firebaseio.com"
      });
    }
  } catch (error) {
    console.error("Firebase Init Error:", error.message);
  }
}

const db = getDatabase();
const auth = getAuth();

export default async function handler(req, res) {
  // إعدادات الـ CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { text, sender, uid, token } = req.body;

    // 1. التحقق من التوكين (الأمان)
    const decodedToken = await auth.verifyIdToken(token);
    if (decodedToken.uid !== uid) throw new Error("Unauthorized");

    // 2. نظام الـ Rate Limit (3 ثواني)
    const now = Date.now();
    const lastMsgRef = db.ref(`lastMessage/${uid}`);
    const lastSnap = await lastMsgRef.once("value");
    if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
      return res.status(429).json({ error: "اهدأ قليلاً يا شبح.." });
    }

    // 3. تنظيف النص (الأرقام والروابط)
    const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");

    // 4. كتابة الرسالة في Realtime Database
    const msgRef = db.ref('messages/global').push();
    
    // التعديل هنا: استخدام ServerValue لضمان توقيت موحد للكل (بيساعد في استقرار العداد والترتيب)
    await msgRef.set({
      uid,
      sender,
      text: cleanText,
      timestamp: admin.database.ServerValue.TIMESTAMP, 
      isConfession: text.startsWith('#'),
      isSecret: text.includes('سر')
    });

    // تحديث وقت آخر رسالة
    await lastMsgRef.set(now);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
