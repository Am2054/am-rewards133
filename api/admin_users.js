// /api/admin_users.js - موديول إدارة مستخدمي منصة العقارات بالخلفية
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, points, status, lastId, searchQuery, sortBy } = req.body;

  // --- [1] نظام تسجيل الدخول الموحد لمدير المستخدمين ---
  if (action === 'admin_login') {
    let isValid = false;
    let role = "";
    
    // التحقق من كلمة المرور الخاصة بمشرف المستخدمين
    if (module === 'users' && password === process.env.ADMIN_PASSWORD1) { 
      isValid = true; 
      role = "users_admin"; 
    }

    if (isValid) {
      const token = jwt.sign({ role, module }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- [2] التحقق من التوكن للمضي في العمليات ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // التحقق من أن الدور المصرح به هو مدير مستخدمين فقط
    if (decoded.role !== 'users_admin' || decoded.module !== 'users') {
      return res.status(403).json({ error: "Forbidden" });
    }

    // --- [3] موديول إدارة مستخدمي العقارات ---
    if (module === 'users') {
      if (action === 'get_users') {
        let sortField = sortBy === 'points' ? 'points' : 'lastLogin';
        let queryRef = db.collection('users').orderBy(sortField, 'desc').limit(10);

        if (searchQuery) {
          queryRef = db.collection('users')
            .where('email', '>=', searchQuery.toLowerCase())
            .where('email', '<=', searchQuery.toLowerCase() + '\uf8ff')
            .limit(10);
        } else if (lastId) {
          const lastSnapshot = await db.collection('users').doc(lastId).get();
          if (lastSnapshot.exists) queryRef = queryRef.startAfter(lastSnapshot);
        }

        const snap = await queryRef.get();
        const users = snap.docs.map(d => {
          const uData = d.data();
          return {
            id: d.id,
            ...uData,
            // معالجة مرنة لدعم كلا الحالتين
            status: uData.isBanned ? 'banned' : 'active',
            lastLoginText: uData.lastLoginDate?.toDate?.().toLocaleString('ar-EG') || 'غير متاح'
          };
        });

        const countSnap = await db.collection('users').count().get();
        return res.status(200).json({ users, total: countSnap.data().count });
      }

      // تعديل رصيد محفظة أو نقاط العضو
      if (action === 'edit_points') {
        await db.collection('users').doc(uid).update({ 
          points: Number(points), 
          updatedAt: FieldValue.serverTimestamp() 
        });
        return res.status(200).json({ success: true });
      }

      // تفعيل حظر أو فك حظر حساب العضو
      if (action === 'toggle_ban') {
        const isBannedValue = (status === 'banned');
        await db.collection('users').doc(uid).update({ 
          isBanned: isBannedValue,
          status: status, // متوافق مع الحالتين
          bannedAt: isBannedValue ? FieldValue.serverTimestamp() : null 
        });
        return res.status(200).json({ success: true });
      }
    }

  } catch (e) { 
    return res.status(401).json({ error: "Session Expired" }); 
  }
}
