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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, withdrawalId, reason, refundPoints } = req.body;

  // 1. تسجيل الدخول
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD3) {
      const token = jwt.sign({ role: 'finance_admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 28800 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // 2. التحقق من التوكن
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    jwt.verify(token, process.env.JWT_SECRET);

    // جلب طلبات السحب
    if (action === 'get_withdrawals') {
      const snap = await db.collection('withdrawals').orderBy('date', 'desc').limit(50).get();
      const withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      // جلب أسماء المستخدمين لربطها بالطلبات
      const uids = [...new Set(withdrawals.map(w => w.userId))];
      const usersMap = {};
      if (uids.length > 0) {
        const uSnap = await db.collection('users').where('__name__', 'in', uids.slice(0, 30)).get();
        uSnap.forEach(u => { usersMap[u.id] = u.data().name });
      }

      return res.status(200).json({ withdrawals, usersMap });
    }

    // اعتماد الدفع (Complete)
    if (action === 'approve_withdrawal') {
      const wDoc = await db.collection('withdrawals').doc(withdrawalId).get();
      if (!wDoc.exists) return res.status(404).json({ error: "Not Found" });
      const wData = wDoc.data();

      const batch = db.batch();
      batch.update(db.collection('withdrawals').doc(withdrawalId), { 
        status: 'completed', 
        processedAt: FieldValue.serverTimestamp() 
      });
      batch.update(db.collection('users').doc(wData.userId), { 
        withdrawn: FieldValue.increment(Number(wData.amount)) 
      });

      // التعامل مع عمولة الإحالة (Referral Bonus)
      if (wData.bonusPendingFor) {
        const comm = Number(wData.amount) * 0.10;
        const refUser = db.collection('users').doc(wData.bonusPendingFor);
        batch.update(refUser, {
          totalReferralEarnings: FieldValue.increment(comm),
          completedReferralsCount: FieldValue.increment(1),
          points: FieldValue.increment(Number(wData.bonusPointsAmount || 0))
        });
      }

      await batch.commit();
      return res.status(200).json({ success: true });
    }

    // رفض الطلب (Reject)
    if (action === 'reject_withdrawal') {
      const wDoc = await db.collection('withdrawals').doc(withdrawalId).get();
      const wData = wDoc.data();

      const batch = db.batch();
      batch.update(db.collection('withdrawals').doc(withdrawalId), { 
        status: 'rejected', 
        rejectionReason: reason, 
        processedAt: FieldValue.serverTimestamp() 
      });

      if (refundPoints) {
        batch.update(db.collection('users').doc(wData.userId), { 
          points: FieldValue.increment(Number(wData.pointsUsed || wData.pts)) 
        });
      }

      await batch.commit();
      return res.status(200).json({ success: true });
    }

  } catch (e) { return res.status(401).json({ error: "Session Expired" }); }
}
