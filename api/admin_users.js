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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, points, status, lastId, searchQuery, sortBy, withdrawalId, reason, refundPoints } = req.body;

  // --- [1] نظام تسجيل الدخول الموحد ---
  if (action === 'admin_login') {
    let isValid = false;
    let role = "";
    
    // التحقق من كلمة السر حسب الموديول
    if (module === 'users' && password === process.env.ADMIN_PASSWORD1) { isValid = true; role = "users_admin"; }
    if (module === 'withdraw' && password === process.env.ADMIN_PASSWORD3) { isValid = true; role = "finance_admin"; }

    if (isValid) {
      const token = jwt.sign({ role, module }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- [2] التحقق من التوكن لجميع العمليات ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // --- [3] موديول إدارة المستخدمين (Users Module) ---
    if (module === 'users') {
      if (action === 'get_users') {
        let sortField = sortBy === 'points' ? 'points' : 'lastLogin';
        let query = db.collection('users').orderBy(sortField, 'desc').limit(10);

        if (searchQuery) {
          query = db.collection('users').where('email', '>=', searchQuery).where('email', '<=', searchQuery + '\uf8ff').limit(10);
        } else if (lastId) {
          const lastSnapshot = await db.collection('users').doc(lastId).get();
          if (lastSnapshot.exists) query = query.startAfter(lastSnapshot);
        }

        const snap = await query.get();
        const users = snap.docs.map(d => ({
          id: d.id, ...d.data(),
          lastLoginText: d.data().lastLogin?.toDate?.().toLocaleString('ar-EG') || 'غير متاح'
        }));
        const countSnap = await db.collection('users').count().get();
        return res.status(200).json({ users, total: countSnap.data().count });
      }

      if (action === 'edit_points') {
        await db.collection('users').doc(uid).update({ points: Number(points), updatedAt: FieldValue.serverTimestamp() });
        return res.status(200).json({ success: true });
      }

      if (action === 'toggle_ban') {
        await db.collection('users').doc(uid).update({ status, bannedAt: status === 'banned' ? FieldValue.serverTimestamp() : null });
        return res.status(200).json({ success: true });
      }
    }

    // --- [4] موديول إدارة السحوبات (Withdraw Module) ---
    if (module === 'withdraw') {
      if (action === 'get_withdrawals') {
        const snap = await db.collection('withdrawals').orderBy('date', 'desc').limit(50).get();
        const withdrawals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const uids = [...new Set(withdrawals.map(w => w.userId))];
        const usersMap = {};
        if (uids.length > 0) {
          const uSnap = await db.collection('users').where('__name__', 'in', uids.slice(0, 30)).get();
          uSnap.forEach(u => { usersMap[u.id] = u.data().name });
        }
        return res.status(200).json({ withdrawals, usersMap });
      }

      if (action === 'approve_withdrawal') {
        const wDoc = await db.collection('withdrawals').doc(withdrawalId).get();
        if (!wDoc.exists) return res.status(404).json({ error: "Not Found" });
        const wData = wDoc.data();
        const batch = db.batch();
        batch.update(db.collection('withdrawals').doc(withdrawalId), { status: 'completed', processedAt: FieldValue.serverTimestamp() });
        batch.update(db.collection('users').doc(wData.userId), { withdrawn: FieldValue.increment(Number(wData.amount)) });
        if (wData.bonusPendingFor) {
          const comm = Number(wData.amount) * 0.10;
          batch.update(db.collection('users').doc(wData.bonusPendingFor), {
            totalReferralEarnings: FieldValue.increment(comm),
            completedReferralsCount: FieldValue.increment(1),
            points: FieldValue.increment(Number(wData.bonusPointsAmount || 0))
          });
        }
        await batch.commit();
        return res.status(200).json({ success: true });
      }

      if (action === 'reject_withdrawal') {
        const wDoc = await db.collection('withdrawals').doc(withdrawalId).get();
        const wData = wDoc.data();
        const batch = db.batch();
        batch.update(db.collection('withdrawals').doc(withdrawalId), { status: 'rejected', rejectionReason: reason, processedAt: FieldValue.serverTimestamp() });
        if (refundPoints) {
          batch.update(db.collection('users').doc(wData.userId), { points: FieldValue.increment(Number(wData.pointsUsed || wData.pts)) });
        }
        await batch.commit();
        return res.status(200).json({ success: true });
      }
    }

  } catch (e) { return res.status(401).json({ error: "Session Expired" }); }
}
