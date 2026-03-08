import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import { parse } from "cookie";

// --- 1. تهيئة Firebase Admin (المنطق الخاص بك) ---
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
const firebaseAuth = getAuth(); // مسمى مختلف لتجنب التعارض مع الـ Logic

// --- 2. معالج الطلبات الرئيسي (API Handler) ---
export default async function handler(req, res) {
  // السماح بطلبات POST فقط
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // أ. فحص الأمان (JWT & Fingerprint)
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  const clientFingerprint = req.headers['x-fingerprint'];

  if (!token || !clientFingerprint) {
    return res.status(401).json({ error: "Access Denied: Missing Credentials" });
  }

  try {
    // ب. فحص التوكن
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // ج. مطابقة بصمة الجهاز (Fingerprint) لضمان عدم سرقة الجلسة
    if (decoded.device !== clientFingerprint) {
      return res.status(403).json({ error: "Security Mismatch: Unknown Device" });
    }

    // د. استخراج البيانات من الطلب
    const { uid, points, status, action } = req.body;
    if (!uid || !action) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const userRef = db.collection('users').doc(uid);

    // --- 3. تنفيذ العمليات (Actions) ---
    
    // تعديل النقاط
    if (action === 'edit_points') {
      await userRef.update({ 
        points: Number(points),
        lastUpdatedBy: 'ADMIN_SERVER',
        updatedAt: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ success: true, message: "Points updated via server" });
    }

    // حظر أو فك حظر المستخدم
    if (action === 'toggle_ban') {
      await userRef.update({ 
        status: status, // 'banned' or 'active'
        bannedAt: status === 'banned' ? FieldValue.serverTimestamp() : null 
      });
      return res.status(200).json({ success: true, message: `User status changed to ${status}` });
    }

    return res.status(400).json({ error: "Invalid Action Specified" });

  } catch (error) {
    console.error("Security/DB Error:", error.message);
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: "Invalid Session Token" });
    }
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
