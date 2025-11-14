// api/secureSignup.js - نسخة محسّنة تعمل على Vercel بدون أخطاء

import { initializeApp, getApps, getApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// 🔐 الحصول على مفتاح الخدمة من متغيرات البيئة (ضروري)
const serviceAccountKey = process.env.FIREBASE_ADMIN_KEY; // 💡 تم التعديل ليناسب الاسم الذي تستخدمه في Vercel
const projectId = process.env.FIREBASE_PROJECT_ID || "am--rewards"; // غيّرها لو عندك اسم مشروع مختلف

// ✅ التهيئة لمرة واحدة فقط
let app;
let db;

try {
    if (!getApps().length) {
        if (!serviceAccountKey) {
            // نرفع خطأ إذا لم يتم العثور على المفتاح
            throw new Error("❌ FIREBASE_ADMIN_KEY variable is missing.");
        }
        app = initializeApp({
            credential: cert(JSON.parse(serviceAccountKey)),
            projectId: projectId,
        });
        console.log("✅ Firebase Admin initialized successfully");
    } else {
        app = getApp();
    }
    // تهيئة قاعدة البيانات خارج الـ if/else
    db = getFirestore(app);
} catch (error) {
    console.error("❌ FATAL CONFIGURATION ERROR:", error.message);
    // إرجاع دالة تقوم بإظهار الخطأ 500 فوراً
    // هذا يضمن عدم محاولة تشغيل الكود إذا فشلت التهيئة
    const configErrorReason = "SERVER CONFIG ERROR: Check FIREBASE_ADMIN_KEY format/value.";
    
    export default async function handler(req, res) {
        return res.status(500).json({ approved: false, reason: configErrorReason });
    }
    // يجب أن تتوقف هنا!
    throw new Error(configErrorReason); 
}

// -----------------------------------------------------------
// ⬇️ الدالة الرئيسية (تعمل فقط إذا نجحت التهيئة) ⬇️
// -----------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ approved: false, reason: "Method not allowed" });
  }

  try {
    const { email, deviceId, ip } = req.body;

    if (!email || !deviceId || !ip) {
      return res.status(400).json({ approved: false, reason: "بيانات ناقصة." });
    }

    // 🕵️‍♂️ فحص الجهاز والعنوان IP لمنع التكرار
    const dupIp = await db.collection("userDevices").where("ip", "==", ip).get();
    const dupDevice = await db.collection("userDevices").where("deviceId", "==", deviceId).get();

    if (!dupIp.empty) {
      return res.status(403).json({ approved: false, reason: "هذا الجهاز مسجل بالفعل باستخدام نفس IP." });
    }

    if (!dupDevice.empty) {
      return res.status(403).json({ approved: false, reason: "هذا الجهاز مسجل بالفعل." });
    }

    // ✅ تسجيل الجهاز
    await db.collection("userDevices").add({
      email,
      ip,
      deviceId,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ approved: true });
  } catch (err) {
    console.error("🔥 Signup error:", err);
    return res.status(500).json({ approved: false, reason: "خطأ في السيرفر. حاول لاحقًا." });
  }
}
