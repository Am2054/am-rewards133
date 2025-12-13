// api/secureSignup.js

import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// دالة مساعدة للتحقق من تنسيق البريد الإلكتروني
const isValidEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// ... (بقية كود التهيئة remain unchanged)
const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;
const projectId = "am--rewards";

let app;
let db;

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
  console.error("🔥 Firebase Init Failed:", err.message);
  db = null;
}

// ----------------------------------
// 🚀 API Handler
// ----------------------------------
export default async function handler(req, res) {
  if (!db) {
    return res.status(500).json({
      approved: false,
      errorCode: "SERVER_CONFIG_ERROR", // إضافة كود الخطأ
      reason: "Server configuration error",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      approved: false,
      errorCode: "METHOD_NOT_ALLOWED",
      reason: "Method Not Allowed",
    });
  }

  try {
    const { email, deviceId } = req.body;

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;

    if (!email || !deviceId) {
      return res.status(400).json({
        approved: false,
        errorCode: "MISSING_FIELDS",
        reason: "Missing email or deviceId",
      });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({
            approved: false,
            errorCode: "INVALID_EMAIL_FORMAT",
            reason: "Invalid email format",
        });
    }
    
    // 1. 🛑 التحقق من البريد الإلكتروني (هل تم استخدامه بالفعل؟)
    const emailCheck = await db
        .collection("userDevices")
        .where("email", "==", email)
        .limit(1)
        .get();
        
    if (!emailCheck.empty) {
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

    return res.status(200).json({ approved: true });
  } catch (err) {
    console.error("🔥 Signup Error:", err);
    return res.status(500).json({
      approved: false,
      errorCode: "UNEXPECTED_SERVER_ERROR",
      reason: "Server error occurred",
    });
  }
}
