// /api/admin-auth.js - معالج التحقق الإداري المطور مع تفعيل الـ 2FA الفعلي ونظام تراجع آمن
import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// تهيئة آمنة ومقاومة لمشاكل السطور الجديدة في مفاتيح الاستضافة السحابية
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { 
    console.error("Firebase Admin Init Error inside Admin Auth:", error.message); 
  }
}

const db = getFirestore();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const LOGIN_ATTEMPTS_LIMIT = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 دقيقة

// تتبع محاولات الدخول في الذاكرة المؤقتة (لمنع الهجمات السريعة)
const loginAttempts = {};

function recordFailedAttempt(email) {
  const now = Date.now();

  if (!loginAttempts[email]) {
    loginAttempts[email] = { count: 0, firstAttempt: now };
  }

  loginAttempts[email].count++;

  if (loginAttempts[email].count >= LOGIN_ATTEMPTS_LIMIT) {
    loginAttempts[email].lockedUntil = now + LOCKOUT_TIME;
  }

  return loginAttempts[email];
}

function checkLoginLockout(email) {
  const attempt = loginAttempts[email];
  if (attempt && attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
    return true;
  }
  return false;
}

function clearLoginAttempts(email) {
  delete loginAttempts[email];
}

async function logAdminAction(action, email, details = {}) {
  try {
    await db.collection("adminLogs").add({
      action,
      email,
      details,
      timestamp: FieldValue.serverTimestamp(),
      ip: details.ip || "unknown"
    });
  } catch (error) {
    console.error("Failed to log admin action:", error);
  }
}

export default async function handler(req, res) {
  // تفعيل الـ CORS بشكل آمن لتبادل طلبات لوحة التحكم
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown_ip";

  // ✅ 1. التحقق من صحة وصلاحية الجلسة الحالية (Verification Session)
  if (req.method === "GET" || (req.body && req.body.action === "verify")) {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies.adminToken;

    if (!token) {
      return res.status(401).json({ valid: false, message: "No token found" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      return res.status(200).json({
        valid: true,
        email: decoded.email,
        issuedAt: decoded.iat
      });
    } catch (error) {
      return res.status(401).json({ valid: false, message: "Invalid Session" });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { action, email, password, otp } = req.body;

  // ✅ 2. الخطوة الأولى من تسجيل الدخول: مطابقة البيانات الأساسية وتوليد الـ 2FA
  if (action === "login") {
    if (!email || !password) {
      return res.status(400).json({ message: "❌ يرجى إدخال كافة البيانات المطلوبة" });
    }

    // فحص حظر المحاولات المتكررة
    if (checkLoginLockout(email)) {
      await logAdminAction("login_attempt_locked", email, { ip: clientIp });
      return res.status(429).json({
        message: "تم حظر محاولات الدخول مؤقتاً لحماية الحساب. يرجى الانتظار 15 دقيقة."
      });
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      // توليد رمز تحقق ثنائي عشوائي (OTP) من 6 أرقام
      const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

      // حفظ الرمز مؤقتاً في Firestore ليكون صالحاً لمدة 5 دقائق فقط لضمان الأمان الفائق
      await db.collection("adminSettings").doc("2fa").set({
        otp: generatedOtp,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 دقائق صلاحية
        email: email,
        createdAt: FieldValue.serverTimestamp()
      });

      // طباعة الرمز في سجلات السيرفر لتتمكن من قراءته فوراً بداخل لوحة تحكم الاستضافة (Vercel logs)
      console.log(`[ADMIN 2FA SECURITY] OTP generated for ${email}: [ ${generatedOtp} ] (Expires in 5 mins)`);

      await logAdminAction("login_step1_success", email, { ip: clientIp });

      // إشعار الواجهة الأمامية بضرورة عرض حقل التحقق الثنائي وإدخال الرمز
      return res.status(200).json({
        success: true,
        requires2FA: true,
        message: "🔑 تم التحقق من البيانات بنجاح! يرجى إدخال رمز التحقق الثنائي (OTP) لمتابعة الدخول."
      });
    }

    recordFailedAttempt(email);
    await logAdminAction("login_failed", email, { ip: clientIp });

    return res.status(401).json({
      message: "❌ بيانات الدخول غير صحيحة"
    });
  }

  // ✅ 3. الخطوة الثانية: التحقق من رمز الـ 2FA وإصدار التوكن النهائي
  if (action === "verify_2fa") {
    if (!email || !otp) {
      return res.status(400).json({ message: "❌ رمز التحقق والبريد الإلكتروني مطلوبان" });
    }

    if (checkLoginLockout(email)) {
      return res.status(429).json({ message: "تم حظر محاولات الدخول مؤقتاً. انتظر 15 دقيقة." });
    }

    try {
      const otpDocRef = db.collection("adminSettings").doc("2fa");
      const otpSnap = await otpDocRef.get();

      if (!otpSnap.exists) {
        recordFailedAttempt(email);
        return res.status(401).json({ message: "❌ رمز التحقق غير صالح أو لم يتم توليده" });
      }

      const otpData = otpSnap.data();

      // التحقق من صحة الرمز والبريد وصلاحية الوقت (5 دقائق)
      if (otpData.email !== email || otpData.otp !== otp.trim() || Date.now() > otpData.expiresAt) {
        recordFailedAttempt(email);
        await logAdminAction("2fa_failed", email, { ip: clientIp, enteredOtp: otp });
        return res.status(401).json({ message: "❌ رمز التحقق الثنائي غير صحيح أو منتهي الصلاحية" });
      }

      // مطابقة ناجحة: نقوم فوراً بمسح الرمز من قاعدة البيانات لمنع إعادة استخدامه نهائياً
      await otpDocRef.delete();
      clearLoginAttempts(email);

      // توليد رمز الـ JWT لإثبات الجلسة للمشرف
      const token = jwt.sign(
        { email, iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: "2h" }
      );

      // حفظ الـ JWT في ملفات تعريف الارتباط الآمنة (Cookie) للمتصفح
      res.setHeader("Set-Cookie", serialize("adminToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 7200 // ساعتان
      }));

      await logAdminAction("login_success_2fa", email, { ip: clientIp });

      return res.status(200).json({
        success: true,
        message: "✅ تم تسجيل الدخول بنجاح كمسؤول"
      });

    } catch (err) {
      console.error("Error in 2FA verification:", err);
      return res.status(500).json({ message: "حدث خطأ غير متوقع أثناء معالجة التحقق الثنائي." });
    }
  }

  // ✅ 4. تسجيل الخروج وإلغاء صلاحية الجلسة والكوكيز
  if (action === "logout") {
    res.setHeader("Set-Cookie", serialize("adminToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0 // إلغاء فوري
    }));

    await logAdminAction("logout", email || "unknown", { ip: clientIp });

    return res.status(200).json({
      success: true,
      message: "✅ تم تسجيل الخروج بنجاح"
    });
  }

  return res.status(400).json({ message: "Invalid Action" });
}
