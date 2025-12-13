// api/secureSignup.js

import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;
const projectId = "am--rewards";

let app;
let db;

// ----------------------------------
// 🔐 Firebase Admin Init
// ----------------------------------
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
      reason: "Server configuration error",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      approved: false,
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
        reason: "Missing email or deviceId",
      });
    }

    const ipCheck = await db
      .collection("userDevices")
      .where("ip", "==", ip)
      .limit(1)
      .get();

    if (!ipCheck.empty) {
      return res.status(403).json({
        approved: false,
        reason: "هذا العنوان مستخدم بالفعل",
      });
    }

    const deviceCheck = await db
      .collection("userDevices")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (!deviceCheck.empty) {
      return res.status(403).json({
        approved: false,
        reason: "هذا الجهاز مسجل بالفعل",
      });
    }

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
      reason: "Server error occurred",
    });
  }
                                      }
