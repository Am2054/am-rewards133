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
        serviceAccount.private_key = serviceAccount.private_key.replace(/\n/g, '\n');
      }
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) {
    console.error("Firebase Init Error:", error.message);
  }
}

const db = getFirestore();
const requestTracker = new Map();

let statsCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 60 * 1000; 

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, fingerprint } = req.body;
  const clientFingerprint = req.headers['x-fingerprint'] || fingerprint;

  const userIp = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
  const key = clientFingerprint || userIp;

  const now = Date.now();

  // الـ Rate Limit موقوف حالياً بناءً على طلبك السابق للاختبار
  /*
  if (requestTracker.has(key)) {
    const last = requestTracker.get(key);
    if (now - last < 2000) { 
      return res.status(429).json({ error: "Too many requests" });
    }
  }
  requestTracker.set(key, now);
  */

  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD2) {
      const token = jwt.sign({ role: 'ref_admin', device: clientFingerprint.slice(0, 20) }, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 43200 }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  try {
    // ✅ تم إلغاء التحقق من الـ fingerprint تماماً هنا
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (action === 'get_referrals_stats') {  
      if (statsCache && (now - lastCacheTime < CACHE_DURATION)) {  
        return res.status(200).json({ ...statsCache, fromCache: true });  
      }  

      const referredUsersSnap = await db.collection('users').where('referredBy', '!=', null).get();  
      const referredUsers = referredUsersSnap.docs.map(d => ({ id: d.id, ...d.data() }));  
      const referredUserIds = referredUsers.map(u => u.id);  

      const referrerIds = [...new Set(referredUsers.map(u => u.referredBy))];  
      let allReferrers = [];  
      if (referrerIds.length > 0) {  
          for (let i = 0; i < referrerIds.length; i += 30) {  
              const chunk = referrerIds.slice(i, i + 30);  
              const rSnap = await db.collection('users').where('__name__', 'in', chunk).get();  
              allReferrers.push(...rSnap.docs.map(d => ({ id: d.id, ...d.data() })));  
          }  
      }  

      let allWithdrawals = [];  
      if (referredUserIds.length > 0) {  
          for (let i = 0; i < referredUserIds.length; i += 30) {  
              const uChunk = referredUserIds.slice(i, i + 30);  
              const wSnap = await db.collection('withdrawals')  
                .where('userId', 'in', uChunk)  
                .where('status', '==', 'completed')  
                .orderBy('createdAt', 'asc')  
                .get();  
              allWithdrawals.push(...wSnap.docs.map(d => d.data()));  
          }  
      }  

      const referrersMap = {};  
      let totalSystemCommission = 0;  

      referredUsers.forEach(user => {  
          const bossId = user.referredBy;  
          const hisWithdrawals = allWithdrawals.filter(w => w.userId === user.id);  
          let commFromHim = 0;  
          hisWithdrawals.slice(0, 10).forEach(w => { commFromHim += (Number(w.amount) * 0.10); });  

          if (!referrersMap[bossId]) {  
              const bossData = allReferrers.find(r => r.id === bossId);  
              referrersMap[bossId] = {  
                  name: bossData?.name || "User " + bossId.slice(0,5),  
                  email: bossData?.email || "-",  
                  friends: [],  
                  totalComm: 0  
              };  
          }  
          referrersMap[bossId].friends.push({ name: user.name, email: user.email, withdrawalsCount: hisWithdrawals.length, commGenerated: commFromHim });  
          referrersMap[bossId].totalComm += commFromHim;  
          totalSystemCommission += commFromHim;  
      });  

      const leaderboard = Object.entries(referrersMap).sort((a, b) => b[1].totalComm - a[1].totalComm).map(([id, data]) => ({ id, ...data }));  
      const finalResponse = { leaderboard, totalConversions: referredUsers.length, totalSystemCommission, recentLogs: referredUsers.slice(-15).reverse() };  

      statsCache = finalResponse;  
      lastCacheTime = now;  
      return res.status(200).json(finalResponse);  
    }
  } catch (error) {
    return res.status(401).json({ error: "Session Expired" });
  }
}
