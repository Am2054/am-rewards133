import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";

// ---------------- Rate Limit ----------------
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { code: "LIMIT_REACHED", message: "محاولات كثيرة، انتظر 10 دقائق" }
});

// ---------------- Firebase Init ----------------
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const db = getFirestore();

// ---------------- Handler ----------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { idToken, deviceId } = req.body;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "";

  if (!idToken || !deviceId) {
    return res.status(400).json({ code: "MISSING_DATA" });
  }

  try {
    // Rate limit
    await new Promise((resolve, reject) => {
      loginLimiter(req, res, () => {
        if (res.headersSent) reject("LIMIT");
        else resolve();
      });
    });

    // Verify Firebase Token
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(403).json({ code: "NO_PROFILE" });
    }

    const user = userSnap.data();

    if (user.isBanned) {
      return res.status(403).json({ code: "BANNED", message: "تم حظر الحساب" });
    }

    // Device Check
    const deviceSnap = await db
      .collection("userDevices")
      .where("uid", "==", uid)
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (deviceSnap.empty) {
      return res.status(403).json({
        code: "NEW_DEVICE",
        message: "هذا الجهاز غير مصرح له"
      });
    }

    // Update login info
    await userRef.update({
      lastLogin: FieldValue.serverTimestamp(),
      lastIp: ip
    });

    await db.collection("loginLogs").add({
      uid,
      deviceId,
      ip,
      createdAt: FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      success: true,
      uid
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({
      code: "SERVER_ERROR",
      message: "خطأ داخلي"
    });
  }
}
