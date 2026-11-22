// /lib/verifyUser.js — تهيئة Firebase Admin والتحقق من هوية المستخدم في مسارات الـ API
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database";

if (!getApps().length) {
  try {
    const rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
      }
      initializeApp({
        credential: cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://am--rewards-default-rtdb.firebaseio.com",
      });
    }
  } catch (error) {
    console.error("Firebase Init Error:", error.message);
  }
}

export const adminDb = () => getFirestore();
export const adminRtdb = () => getDatabase();

// يرجع بيانات المستخدم (uid ...) لو التوكن صحيح، وإلا null
export async function verifyUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return await getAuth().verifyIdToken(token);
  } catch {
    return null;
  }
}
