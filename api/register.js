// /api/register.js — تسجيل المستخدمين (منصة AM للعقارات)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { notify } from "../lib/notifications.js";

if (!getApps().length) {
  try {
    const rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) {
    console.error("Firebase Init Error:", error.message);
  }
}

const db = getFirestore();
const auth = getAuth();

// حد المحاولات لكل IP (شبكات المحمول في مصر تشارك نفس الـ IP بين مستخدمين كتير، فالحد واسع)
const RATE_MAX = 10;
const RATE_WINDOW = 60 * 60 * 1000;

async function allowAttempt(ip) {
  const ref = db.collection("rateLimits").doc(ip.replace(/[^a-zA-Z0-9]/g, "_"));
  const now = Date.now();
  return db.runTransaction(async (tr) => {
    const snap = await tr.get(ref);
    const d = snap.exists ? snap.data() : null;
    const fresh = !d || now - d.lastAttempt >= RATE_WINDOW;
    if (!fresh && d.count >= RATE_MAX) return false;
    tr.set(ref, { count: fresh ? 1 : d.count + 1, lastAttempt: now });
    return true;
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مسموح بها" });
  }

  const { email, password, confirmPassword, name, phone } = req.body || {};
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";

  try {
    // 1) التحقق من المدخلات
    if (!email || !password || !phone || !name) {
      return res.status(400).json({ error: "برجاء ملء جميع الحقول المطلوبة" });
    }
    const cleanName = String(name).trim();
    const cleanPhone = String(phone).trim();
    const cleanEmail = String(email).trim().toLowerCase();

    if (cleanName.length < 3) {
      return res.status(400).json({ error: "يجب أن يتكون الاسم من 3 أحرف على الأقل" });
    }
    if (!/^01[0125]\d{8}$/.test(cleanPhone)) {
      return res.status(400).json({ error: "رقم الهاتف غير صحيح، يجب أن يكون رقماً مصرياً من 11 رقماً" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "كلمة المرور يجب ألا تقل عن 8 أحرف" });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "كلمات المرور غير متطابقة" });
    }

    // 2) حد المحاولات
    if (!(await allowAttempt(ip))) {
      return res.status(429).json({ error: "محاولات تسجيل كثيرة، يرجى المحاولة مرة أخرى بعد ساعة" });
    }

    // 3) منع تكرار الهاتف أو البريد
    const [phoneSnap, emailSnap] = await Promise.all([
      db.collection("users").where("phone", "==", cleanPhone).limit(1).get(),
      db.collection("users").where("email", "==", cleanEmail).limit(1).get(),
    ]);
    if (!phoneSnap.empty) {
      return res.status(400).json({ error: "رقم الهاتف هذا مسجل بحساب آخر بالفعل" });
    }
    if (!emailSnap.empty) {
      return res.status(400).json({ error: "البريد الإلكتروني هذا مسجل بحساب آخر بالفعل" });
    }

    // 4) إنشاء حساب Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.createUser({ email: cleanEmail, password, displayName: cleanName });
    } catch (authError) {
      if (authError.code === "auth/email-already-exists") {
        return res.status(400).json({ error: "البريد الإلكتروني هذا مسجل بحساب آخر بالفعل" });
      }
      throw authError;
    }
    const uid = userRecord.uid;

    // 5) حفظ بيانات المستخدم، مع حذف حساب Auth لو فشل الحفظ
    try {
      await db.collection("users").doc(uid).set({
        uid,
        email: cleanEmail,
        name: cleanName,
        phone: cleanPhone,
        isBanned: false,
        createdAt: FieldValue.serverTimestamp(),
        lastLogin: FieldValue.serverTimestamp(),
      });
    } catch (dbError) {
      console.error("[ROLLBACK] Firestore write failed:", dbError.message);
      try {
        await auth.deleteUser(uid);
      } catch (delError) {
        console.error("Failed to delete orphaned Auth user:", delError.message);
      }
      throw dbError;
    }

    // 6) إشعار تليجرام للمسؤول (لا يعطّل التسجيل لو فشل)
    try {
      await notify.newUser({ name: cleanName, email: cleanEmail, phone: cleanPhone, uid, ip });
    } catch (notifError) {
      console.error("[TELEGRAM WARNING]", notifError.message);
    }

    return res.status(200).json({ success: true, message: "تم إنشاء الحساب بنجاح" });
  } catch (err) {
    console.error("[ERROR] Signup error:", err.message);
    return res.status(500).json({ error: "حدث خطأ غير متوقع أثناء التسجيل، يرجى المحاولة لاحقاً" });
  }
}
