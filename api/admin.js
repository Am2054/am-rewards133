import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

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
  } catch (error) { console.error("Firebase Error:", error.message); }
}

const db = getFirestore();
const requestTracker = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, uid, points, status, lastId, searchQuery } = req.body;

  // --- 1. تسجيل الدخول ---
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD1) {
      const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- 2. فحص التوكن ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    jwt.verify(token, process.env.JWT_SECRET);

    if (action === 'get_users') {
      let query = db.collection('users').orderBy('lastLogin', 'desc').limit(20);

      if (searchQuery) {
        // بحث مرن بالايميل
        query = db.collection('users')
          .where('email', '>=', searchQuery)
          .where('email', '<=', searchQuery + '\uf8ff')
          .limit(15);
      } else if (lastId) {
        const lastSnapshot = await db.collection('users').doc(lastId).get();
        if (lastSnapshot.exists) query = query.startAfter(lastSnapshot);
      }

      const snap = await query.get();
      const users = snap.docs.map(d => ({
        id: d.id,
        ...d.data(),
        lastLoginText: d.data().lastLogin?.toDate?.().toLocaleString('ar-EG') || 'غير متاح'
      }));

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

  } catch (e) { return res.status(401).json({ error: "Invalid Session" }); }
}
