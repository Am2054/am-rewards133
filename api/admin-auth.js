// /api/admin-auth.js - معالج التحقق الإداري المطور (بدون 2FA - اعتماد كامل على الكوكيز الآمنة)
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
        serviceAccount.private_key = serviceAccount.private_key.replace(/\n/g, '\n');
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
  // تفعيل التوثيق المشترك الآمن مع الكوكيز عبر الخادم (Credentials)
  res.setHeader("Access-Control-Allow-Origin", "https://am-rewards.vercel.app");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown_ip";

  // ✅ 1. التحقق من صحة وصلاحية الجلسة الحالية
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

  const { action, email, password } = req.body;

  // ✅ 2. معالجة تسجيل الدخول المباشر وإصدار الكوكيز والتوكن
  if (action === "login") {
    if (!email || !password) {
      return res.status(400).json({ message: "❌ يرجى إدخال كافة البيانات المطلوبة" });
    }

    if (checkLoginLockout(email)) {  
      await logAdminAction("login_attempt_locked", email, { ip: clientIp });  
      return res.status(429).json({  
        message: "تم حظر محاولات الدخول مؤقتاً لحماية الحساب. يرجى الانتظار 15 دقيقة."  
      });  
    }  

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {  
      clearLoginAttempts(email);

      const token = jwt.sign(
        {
          email,
          iat: Math.floor(Date.now() / 1000)
        },
        JWT_SECRET,
        {
          expiresIn: "2h"
        }
      );

      res.setHeader(
        "Set-Cookie",
        serialize("adminToken", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 7200
        })
      );

      await logAdminAction("login_success", email, {
        ip: clientIp
      });

      return res.status(200).json({
        success: true,
        message: "تم تسجيل الدخول بنجاح"
      });
    }  

    recordFailedAttempt(email);  
    await logAdminAction("login_failed", email, { ip: clientIp });  

    return res.status(401).json({  
      message: "❌ بيانات الدخول غير صحيحة"  
    });
  }

  // ✅ 3. تسجيل الخروج وإبطال الكوكيز فوراً
  if (action === "logout") {
    res.setHeader("Set-Cookie", serialize("adminToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0
    }));

    await logAdminAction("logout", email || "unknown", { ip: clientIp });  

    return res.status(200).json({  
      success: true,  
      message: "✅ تم تسجيل الخروج بنجاح"  
    });
  }

  return res.status(400).json({ message: "Invalid Action" });
}
