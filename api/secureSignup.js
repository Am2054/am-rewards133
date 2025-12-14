// api/secureSignup.js (التحقق الأمني)

import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// 🌟 تم إصلاح التعبير النمطي
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ----------------------------------
// 🛠️ تهيئة Firebase Admin
// ----------------------------------
const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;
const projectId = "am--rewards";

let db;

try {
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_ADMIN_KEY is missing");
  }
  
  // التهيئة مرة واحدة فقط
  if (!getApps().length) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
    });
    // console.log("✅ Firebase Admin initialized");
  }

  db = getFirestore();
} catch (err) {
  console.error("🔥 فشل تهيئة Firebase:", err.message);
  db = null; // للتأكد من أن db غير صالحة إذا فشلت التهيئة
}

// ----------------------------------
// 🚀 API Handler
// ----------------------------------
export default async function handler(req, res) {
  // 💡 قراءة IP: تحسين بسيط للقراءة
  const ipAddress = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || 'N/A').trim();
  const logPrefix = `[IP: ${ipAddress}]`;

  if (!db) {
    console.error(`${logPrefix} ❌ فشل التشغيل: قاعدة البيانات غير مهيأة.`);
    return res.status(503).json({ // 503 Service Unavailable أفضل من 500 في هذه الحالة
      approved: false,
      errorCode: "SERVER_CONFIG_ERROR", 
      reason: "خطأ في تهيئة الخادم (يرجى مراجعة FIREBASE_ADMIN_KEY)",
    });
  }

  if (req.method !== "POST") {
    console.warn(`${logPrefix} ❌ رفض: طريقة الطلب غير مسموح بها (${req.method}).`);
    return res.status(405).json({
      approved: false,
      errorCode: "METHOD_NOT_ALLOWED",
      reason: "طريقة الطلب غير مدعومة",
    });
  }

  try {
    const { email, deviceId } = req.body;

    // 1. تحقق من البيانات الأساسية
    if (!email || !deviceId) {
      console.warn(`${logPrefix} ❌ رفض (400): بيانات مفقودة.`);
      return res.status(400).json({
        approved: false,
        errorCode: "MISSING_FIELDS",
        reason: "بيانات التسجيل مفقودة",
      });
    }

    // 2. تحقق من تنسيق البريد الإلكتروني
    if (!isValidEmail(email)) {
        console.warn(`${logPrefix} ❌ رفض (400): تنسيق بريد غير صالح: ${email}`);
        return res.status(400).json({
            approved: false,
            errorCode: "INVALID_EMAIL_FORMAT",
            reason: "صيغة البريد الإلكتروني غير صحيحة",
        });
    }
    
    // 3. 🛑 التحقق من البريد الإلكتروني (هل تم استخدامه بالفعل؟)
    const emailCheck = await db
        .collection("userDevices")
        .where("email", "==", email)
        .limit(1)
        .get();
        
    if (!emailCheck.empty) {
        console.warn(`${logPrefix} ❌ رفض (403): البريد مستخدم بالفعل: ${email}`);
        return res.status(403).json({
            approved: false,
            errorCode: "EMAIL_ALREADY_USED",
            reason: "هذا البريد مستخدم بالفعل",
        });
    }

    // 4. 🛑 التحقق من عنوان IP (هل تم استخدامه بالفعل؟)
    const ipCheck = await db
      .collection("userDevices")
      .where("ip", "==", ipAddress)
      .limit(1)
      .get();

    if (!ipCheck.empty) {
      console.warn(`${logPrefix} ❌ رفض (403): عنوان IP مستخدم بالفعل: ${ipAddress}`);
      return res.status(403).json({
        approved: false,
        errorCode: "IP_ALREADY_USED",
        reason: "هذا العنوان مستخدم بالفعل",
      });
    }

    // 5. 🛑 التحقق من معرف الجهاز (هل تم استخدامه بالفعل؟)
    const deviceCheck = await db
      .collection("userDevices")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (!deviceCheck.empty) {
      console.warn(`${logPrefix} ❌ رفض (403): معرف الجهاز مستخدم بالفعل: ${deviceId}`);
      return res.status(403).json({
        approved: false,
        errorCode: "DEVICE_ALREADY_USED",
        reason: "هذا الجهاز مسجل بالفعل",
      });
    }

    // 6. ✅ تم منح الموافقة
    console.log(`${logPrefix} ✅ تم منح موافقة التسجيل للبريد: ${email}`);
    return res.status(200).json({ approved: true });
    
  } catch (err) {
    console.error(`${logPrefix} 🔥 خطأ داخلي غير متوقع:`, err.message);
    return res.status(500).json({
      approved: false,
      errorCode: "UNEXPECTED_SERVER_ERROR",
      reason: "حدث خطأ داخلي في الخادم",
    });
  }
}
