// api/secureSignup.js

import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// دالة مساعدة للتحقق من تنسيق البريد الإلكتروني
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;
const projectId = "am--rewards";

let app;
let db;

// ----------------------------------
// 🔐 Firebase Admin Init
// ----------------------------------
try {
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_ADMIN_KEY is missing");
  }

  if (!getApps().length) {
    app = initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
      projectId,
    });
    console.log("✅ Firebase Admin initialized");
  } else {
    app = getApp();
  }

  db = getFirestore(app);
} catch (err) {
  console.error("🔥 فشل تهيئة Firebase:", err.message);
  db = null;
}

// ----------------------------------
// 🚀 API Handler
// ----------------------------------
export default async function handler(req, res) {
  const logPrefix = `[IP: ${req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress}]`;

  if (!db) {
    console.error(`${logPrefix} ❌ فشل التشغيل: قاعدة البيانات غير مهيأة.`);
    return res.status(500).json({
      approved: false,
      errorCode: "SERVER_CONFIG_ERROR",
      reason: "خطأ في تهيئة الخادم",
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

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;
    
    // تحقق من البيانات الأساسية
    if (!email || !deviceId) {
      console.warn(`${logPrefix} ❌ رفض (400): بيانات مفقودة (البريد أو معرف الجهاز).`);
      return res.status(400).json({
        approved: false,
        errorCode: "MISSING_FIELDS",
        reason: "بيانات التسجيل مفقودة",
      });
    }

    // تحقق من تنسيق البريد الإلكتروني
    if (!isValidEmail(email)) {
        console.warn(`${logPrefix} ❌ رفض (400): تنسيق بريد غير صالح: ${email}`);
        return res.status(400).json({
            approved: false,
            errorCode: "INVALID_EMAIL_FORMAT",
            reason: "صيغة البريد الإلكتروني غير صحيحة",
        });
    }
    
    // 1. 🛑 التحقق من البريد الإلكتروني (هل تم استخدامه بالفعل؟)
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

    // 2. 🛑 التحقق من عنوان IP (هل تم استخدامه بالفعل؟)
    const ipCheck = await db
      .collection("userDevices")
      .where("ip", "==", ip)
      .limit(1)
      .get();

    if (!ipCheck.empty) {
      console.warn(`${logPrefix} ❌ رفض (403): عنوان IP مستخدم بالفعل: ${ip}`);
      return res.status(403).json({
        approved: false,
        errorCode: "IP_ALREADY_USED",
        reason: "هذا العنوان مستخدم بالفعل",
      });
    }

    // 3. 🛑 التحقق من معرف الجهاز (هل تم استخدامه بالفعل؟)
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

    // 4. ✅ التسجيل الناجح
    await db.collection("userDevices").add({
      email,
      deviceId,
      ip,
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`${logPrefix} ✅ نجاح التسجيل للبريد: ${email}`);
    return res.status(200).json({ approved: true });
  } catch (err) {
    // خطأ غير متوقع في الكود أو Firestore
    console.error(`${logPrefix} 🔥 خطأ داخلي غير متوقع:`, err.message);
    return res.status(500).json({
      approved: false,
      errorCode: "UNEXPECTED_SERVER_ERROR",
      reason: "حدث خطأ داخلي في الخادم",
    });
  }
}
