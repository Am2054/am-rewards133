import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

// --- 1. تهيئة Firebase Admin ---
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

// نظام Rate Limit يدوي بسيط (ذاكرة السيرفر المؤقتة)
const requestTracker = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, uid, points, status, lastId, searchQuery } = req.body;
  const clientFingerprint = req.headers['x-fingerprint'];

  // --- Rate Limit Check ---
  const now = Date.now();
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  if (requestTracker.has(userIp)) {
    const lastRequest = requestTracker.get(userIp);
    if (now - lastRequest < 500) { // منع أكثر من طلبين في الثانية
      return res.status(429).json({ error: "Too many requests. Slow down!" });
    }
  }
  requestTracker.set(userIp, now);

  // --- 2. تسجيل الدخول باستخدام ADMIN_PASSWORD1 ---
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD1) {
      const token = jwt.sign({ admin: true, device: clientFingerprint }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- 3. فحص الأمان (JWT & Advanced Fingerprint) ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;

  if (!token || !clientFingerprint) return res.status(401).json({ error: "Credentials Missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.device !== clientFingerprint) {
      return res.status(403).json({ error: "Device Unrecognized" });
    }

    // --- 4. العمليات (Actions) ---
    
    if (action === 'get_users') {
      let query = db.collection('users').orderBy('lastLogin', 'desc').limit(20);

      if (searchQuery) {
        query = db.collection('users')
          .where('email', '>=', searchQuery)
          .where('email', '<=', searchQuery + '\uf8ff')
          .limit(10);
      } else if (lastId) {
        const lastSnapshot = await db.collection('users').doc(lastId).get();
        query = query.startAfter(lastSnapshot);
      }

      const snap = await query.get();
      const users = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          lastLoginText: data.lastLogin?.toDate?.().toLocaleString('ar-EG') || 'غير متاح'
        };
      });

      const countSnap = await db.collection('users').count().get();
      return res.status(200).json({ users, total: countSnap.data().count });
    }

    if (action === 'edit_points') {
      await db.collection('users').doc(uid).update({ 
        points: Number(points), 
        updatedAt: FieldValue.serverTimestamp() 
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'toggle_ban') {
      await db.collection('users').doc(uid).update({ 
        status: status, 
        bannedAt: status === 'banned' ? FieldValue.serverTimestamp() : null 
      });
      return res.status(200).json({ success: true });
    }

  } catch (error) {
    return res.status(401).json({ error: "Session Expired" });
  }
}
