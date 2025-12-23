import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";

// ================= Rate Limit =================
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 دقائق
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "LIMIT_REACHED",
    message: "محاولات كثيرة، انتظر 10 دقائق"
  }
});

// ================= Firebase Init =================
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key =
    serviceAccount.private_key.replace(/\\n/g, "\n");

  initializeApp({
    credential: cert(serviceAccount)
  });
}

const auth = getAuth();
const db = getFirestore();

// ================= Handler =================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ code: "METHOD_NOT_ALLOWED" });
  }

  const { idToken, deviceId } = req.body;

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "";

  if (!idToken || !deviceId) {
    return res.status(400).json({
      code: "MISSING_DATA",
      message: "بيانات غير مكتملة"
    });
  }

  try {
    // ---------- Rate limit ----------
    await new Promise((resolve, reject) => {
      loginLimiter(req, res, () => {
        if (res.headersSent) reject({ code: "LIMIT_REACHED" });
        else resolve();
      });
    });

    // ---------- Verify Token ----------
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      if (
        err.code === "auth/id-token-expired" ||
        err.code === "auth/invalid-id-token" ||
        err.code === "auth/argument-error"
      ) {
        return res.status(401).json({
          code: "SESSION_EXPIRED",
          message: "انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى"
        });
      }

      throw err;
    }

    const uid = decoded.uid;

    // ---------- User profile ----------
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(403).json({
        code: "NO_PROFILE",
        message: "لا يوجد حساب مرتبط"
      });
    }

    const user = userSnap.data();

    if (user.isBanned) {
      return res.status(403).json({
        code: "BANNED",
        message: "تم حظر الحساب"
      });
    }

    // ---------- Device Check ----------
    const deviceQuery = await db
      .collection("userDevices")
      .where("uid", "==", uid)
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (deviceQuery.empty) {
      return res.status(403).json({
        code: "NEW_DEVICE",
        message: "هذا الجهاز غير مصرح له"
      });
    }

    // ---------- Update user ----------
    await userRef.update({
      lastLogin: FieldValue.serverTimestamp(),
      lastIp: ip
    });

    // ---------- Logs ----------
    await db.collection("loginLogs").add({
      uid,
      deviceId,
      ip,
      createdAt: FieldValue.serverTimestamp()
    });

    // ---------- Success ----------
    return res.status(200).json({
      success: true,
      uid
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);

    if (err?.code === "LIMIT_REACHED") {
      return res.status(429).json(err);
    }

    return res.status(500).json({
      code: "SERVER_ERROR",
      message: "خطأ داخلي"
    });
  }
    }
