// /api/check-ban.js - فحص حالة الحساب
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// تهيئة Firebase Admin
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
    console.error("Firebase Init Error:", error.message); 
  }
}

const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  const { uid } = req.query;

  if (!uid) {
    return res.status(400).json({ error: "UID مطلوب" });
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();

    if (!snap.exists()) {
      return res.status(404).json({ banned: false });
    }

    const data = snap.data();

    return res.status(200).json({
      banned: data.isBanned || false,
      reason: data.banReason || null
    });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: "Server error" });
  }
      }
