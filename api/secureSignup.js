// api/secureSignup.js

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ⛔ لازم يكون موجود في Vercel باسم FIREBASE_ADMIN_KEY
const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;

if (!serviceAccountJson) {
  console.error("❌ ERROR: FIREBASE_ADMIN_KEY is missing in Vercel env!");
}

let app;
if (!getApps().length) {
  try {
    app = initializeApp({
      credential: cert(JSON.parse(serviceAccountJson)),
    });
  } catch (err) {
    console.error("🔥 Admin Init Error:", err);
  }
} else {
  app = getApps()[0];
}

const db = getFirestore(app);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { email, deviceId, ip } = req.body;

    if (!email || !deviceId || !ip) {
      return res.status(400).json({
        approved: false,
        reason: "Missing some required fields",
      });
    }

    // ✅ Check by IP
    const ipCheck = await db
      .collection("userDevices")
      .where("ip", "==", ip)
      .get();

    if (!ipCheck.empty) {
      return res.status(403).json({
        approved: false,
        reason: "هذا الـ IP مستخدم بالفعل.",
      });
    }

    // ✅ Check by device ID
    const deviceCheck = await db
      .collection("userDevices")
      .where("deviceId", "==", deviceId)
      .get();

    if (!deviceCheck.empty) {
      return res.status(403).json({
        approved: false,
        reason: "هذا الجهاز مسجل بالفعل.",
      });
    }

    // 🌟 Save new data
    await db.collection("userDevices").add({
      email,
      deviceId,
      ip,
      createdAt: FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ approved: true });
  } catch (err) {
    console.error("Signup Error:", err);
    return res
      .status(500)
      .json({ approved: false, reason: "Server error occurred." });
  }
}
