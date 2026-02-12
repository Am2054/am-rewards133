import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase, ServerValue } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";

// التأكد من تشغيل Firebase Admin مرة واحدة فقط
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
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
  // إعدادات CORS للسماح بالطلبات من الفرونت آند
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { text, sender, uid, token } = req.body;
    
    // 1. التحقق من هوية المستخدم (Security Check)
    const decodedToken = await auth.verifyIdToken(token);
    if (decodedToken.uid !== uid) throw new Error("Unauthorized");

    // 2. نظام منع التكرار (Anti-Spam) بناءً على "الاسم"
    const now = Date.now();
    // تنظيف الاسم من الرموز المرفوضة في Firebase Keys
    const safeSenderName = sender.replace(/[.#$[\]]/g, "_");
    const lastMsgRef = db.ref(`lastMessage/${safeSenderName}`);
    const lastSnap = await lastMsgRef.once("value");

    if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
      return res.status(429).json({ error: "اهدأ قليلاً يا شبح.. انتظر 3 ثوانٍ" });
    }

    // 3. فلترة النص (حجب الأرقام)
    const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");

    // 4. تحديد نوع الرسالة (اعتراف أو سر) للتأثيرات البصرية
    const isConfession = text.includes('#اعتراف');
    const isSecret = text.includes('#سر') || text.includes('سر');

    // 5. حفظ الرسالة في قاعدة البيانات
    const msgRef = db.ref('messages/global').push();
    await msgRef.set({
      uid,       // الـ UID للحظر والرقابة الإدارية
      sender,    // الاسم اليومي للعرض
      text: cleanText,
      timestamp: ServerValue.TIMESTAMP, 
      isConfession: isConfession,
      isSecret: isSecret
    });

    // 6. تحديث وقت آخر رسالة لهذا الاسم
    await lastMsgRef.set(now);
    
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error("API Error:", error.message);
    return res.status(500).json({ error: error.message });
  }
}
