import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, password, uid, points, status, lastId, searchQuery } = req.body;
  const clientFingerprint = req.headers['x-fingerprint'];

  // --- 2. تسجيل الدخول باستخدام المتغير الجديد ADMIN_PASSWORD1 ---
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD1) {
      const token = jwt.sign({ admin: true, device: clientFingerprint }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', 
        httpOnly: true, 
        secure: true, 
        sameSite: 'strict',
        maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "كلمة المرور غير صحيحة" });
  }

  // --- 3. فحص الأمان (JWT & Fingerprint) للعمليات الإدارية ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;

  if (!token || !clientFingerprint) {
    return res.status(401).json({ error: "Access Denied: Missing Credentials" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.device !== clientFingerprint) {
      return res.status(403).json({ error: "Security Mismatch: Unknown Device" });
    }

    // --- 4. تنفيذ العمليات (Actions) مع توفير القراءات ---
    
    // أ. جلب المستخدمين مع التقسيم (Pagination) والبحث (Search)
    if (action === 'get_users') {
      let query = db.collection('users').orderBy('lastLogin', 'desc').limit(20);

      if (searchQuery) {
        // بحث محدود لتقليل استهلاك القراءات
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

      // جلب العدد الإجمالي (قراءة واحدة إضافية فقط)
      const countSnap = await db.collection('users').count().get();
      return res.status(200).json({ users, total: countSnap.data().count });
    }

    // ب. تعديل النقاط
    if (action === 'edit_points') {
      await db.collection('users').doc(uid).update({ 
        points: Number(points),
        lastUpdatedBy: 'ADMIN_SERVER',
        updatedAt: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ success: true, message: "Points updated via server" });
    }

    // ج. حظر أو فك حظر المستخدم
    if (action === 'toggle_ban') {
      await db.collection('users').doc(uid).update({ 
        status: status, 
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
