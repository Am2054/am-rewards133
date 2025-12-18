// api/secureSignup.js (التحقق الأمني)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 🌟 دالة التحقق من البريد
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// 🛠️ تهيئة Firebase Admin
if (!getApps().length && process.env.FIREBASE_ADMIN_KEY) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
  });
}
const db = getFirestore();

export default async function handler(req, res) {
  const ipAddress = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || 'N/A').trim();

  if (req.method !== "POST") return res.status(405).json({ approved: false, reason: "Method not allowed" });

  try {
    const { email, deviceId } = req.body;

    if (!email || !deviceId || !isValidEmail(email)) {
      return res.status(400).json({ approved: false, errorCode: "INVALID_DATA", reason: "بيانات غير صالحة" });
    }

    // 🚀 فحص متوازي (Parallel Check) في مجموعة users لضمان الدقة
    const [emailCheck, ipCheck, deviceCheck] = await Promise.all([
      db.collection("users").where("email", "==", email).limit(1).get(),
      db.collection("users").where("registeredIp", "==", ipAddress).limit(1).get(),
      db.collection("users").where("deviceId", "==", deviceId).limit(1).get()
    ]);

    // 🛑 الردود الأمنية
    if (!emailCheck.empty) return res.status(403).json({ approved: false, errorCode: "EMAIL_EXISTS", reason: "البريد مستخدم بالفعل" });
    if (!ipCheck.empty) return res.status(403).json({ approved: false, errorCode: "IP_USED", reason: "تم التسجيل من هذا العنوان مسبقاً" });
    if (!deviceCheck.empty) return res.status(403).json({ approved: false, errorCode: "DEVICE_USED", reason: "هذا الجهاز مسجل بالفعل" });

    // ✅ كل شيء تمام
    return res.status(200).json({ approved: true });

  } catch (err) {
    console.error(`🔥 Security Check Error:`, err.message);
    return res.status(500).json({ approved: false, reason: "خطأ فني في التحقق" });
  }
}
