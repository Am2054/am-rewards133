// api/secureSignup.js - تم تحديثه ليستخدم Admin SDK بشكل صحيح

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// الحصول على مفتاح الخدمة من متغيرات البيئة (ضروري)
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const projectId = process.env.FIREBASE_PROJECT_ID || 'your-project-id'; // يفضل استخدام متغير بيئي لاسم المشروع

// التهيئة لمرة واحدة فقط
let app;
try {
  if (!initializeApp.apps.length) {
    app = initializeApp({
        credential: cert(JSON.parse(serviceAccountKey)), 
        projectId: projectId
    });
  } else {
    app = initializeApp.apps[0];
  }
} catch (error) {
  // يرجى التأكد من إعداد متغير البيئة FIREBASE_SERVICE_ACCOUNT_KEY
  console.error("Firebase Admin SDK Init Error:", error);
}

const db = getFirestore(app);

export default async function handler(req, res) {
  // ... (كود التحقق من نوع الطلب) ...

  try {
    const { email, deviceId, ip } = req.body;

    // ... (كود التحقق من البيانات الناقصة) ...

    // 🕵️‍♂️ البحث عن أي مستخدم بنفس IP أو الجهاز
    // يفضل استخدام معاملات (AND) لتقليل عدد القراءات، لكن هذا المنطق يعمل
    const dupQuery = await db.collection("userDevices")
      .where("ip", "==", ip)
      .get();

    const dupDeviceQuery = await db.collection("userDevices")
      .where("deviceId", "==", deviceId)
      .get();

    if (!dupQuery.empty) {
      return res.status(403).json({ approved: false, reason: "هذا الجهاز مسجل بالفعل باستخدام عنوان IP مشابه." });
    }
    
    if (!dupDeviceQuery.empty) {
        return res.status(403).json({ approved: false, reason: "هذا الجهاز مسجل بالفعل." });
    }

    // ✅ تخزين بيانات الجهاز والإيميل
    await db.collection("userDevices").add({
      email,
      ip,
      deviceId,
      createdAt: FieldValue.serverTimestamp() // يفضل توقيت الخادم
    });

    return res.status(200).json({ approved: true });
  } catch (err) {
    console.error("Signup error:", err);
    return res.status(500).json({ approved: false, reason: "خطأ في السيرفر. برجاء المحاولة لاحقاً." });
  }
}
