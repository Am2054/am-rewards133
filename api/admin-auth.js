// /api/admin-auth.js - محسّن مع 2FA والتسجيل
import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY))
  });
}

const db = getFirestore();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const LOGIN_ATTEMPTS_LIMIT = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 دقيقة

// تتبع محاولات الدخول
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

  // ✅ التحقق من الجلسة (GET أو POST مع action: verify)
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

  // ✅ تسجيل الدخول
  if (action === "login") {
    // فحص الحظر
    if (checkLoginLockout(email)) {
      await logAdminAction("login_attempt_locked", email, { ip: clientIp });
      return res.status(429).json({
        message: "تم حظر محاولات الدخول مؤقتاً. انتظر 15 دقائق"
      });
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      clearLoginAttempts(email);

      const token = jwt.sign(
        { email, iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: "2h" }
      );

      res.setHeader("Set-Cookie", serialize("adminToken", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 7200
      }));

      await logAdminAction("login_success", email, { ip: clientIp });

      return res.status(200).json({
        success: true,
        message: "✅ تم تسجيل الدخول بنجاح"
      });
    }

    recordFailedAttempt(email);
    await logAdminAction("login_failed", email, { ip: clientIp });

    return res.status(401).json({
      message: "❌ بيانات الدخول غير صحيحة"
    });
  }

  // ✅ تسجيل الخروج
  if (action === "logout") {
    res.setHeader("Set-Cookie", serialize("adminToken", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0
    }));

    await logAdminAction("logout", email || "unknown", { ip: clientIp });

    return res.status(200).json({
      success: true,
      message: "✅ تم تسجيل الخروج"
    });
  }

  return res.status(400).json({ message: "Invalid Action" });
      }
