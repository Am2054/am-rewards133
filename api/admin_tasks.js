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

// نظام الـ Cache الخاص بالإحالات
let statsCache = null;
let lastCacheTime = 0;
const CACHE_DURATION = 60 * 1000; 

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, filter, customStart } = req.body;
  const now = Date.now();

  // --- [1] نظام تسجيل الدخول الموحد ---
  if (action === 'admin_login') {
    let isValid = false;
    let tokenName = "taskToken"; // افتراضي للمهام

    if (module === 'tasks' && password === process.env.ADMIN_PASSWORD4) {
        isValid = true;
    } 
    else if (module === 'referrals' && password === process.env.ADMIN_PASSWORD2) {
        isValid = true;
        tokenName = "refToken"; // توكن منفصل للإحالات
    }

    if (isValid) {
      const token = jwt.sign({ role: 'admin', module }, process.env.JWT_SECRET, { expiresIn: '12h' });
      res.setHeader('Set-Cookie', serialize(tokenName, token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- [2] التحقق من التوكنات ---
  const cookies = parse(req.headers.cookie || "");
  const taskToken = cookies.taskToken;
  const refToken = cookies.refToken;

  try {
    // --- [3] موديول المهام (Tasks Module) ---
    if (module === 'tasks') {
      if (!taskToken) return res.status(401).json({ error: "No Task Token" });
      jwt.verify(taskToken, process.env.JWT_SECRET);

      if (action === 'get_analytics') {
        let query = db.collection('lastLinks'); // الكولكشن الجديد
        let start;
        const nowDate = new Date();

        if (filter === 'today') start = new Date(nowDate.setHours(0,0,0,0));
        else if (filter === '7days') start = new Date(nowDate.getTime() - 7*24*60*60*1000);
        else if (filter === '30days') start = new Date(nowDate.getTime() - 30*24*60*60*1000);
        
        // التعديل لاستخدام completedAt بدلاً من date
        if (start && filter !== 'all') query = query.where('completedAt', '>=', start);

        const snap = await query.get();
        const taskCounts = {};
        let totalTasks = 0, todayCount = 0;
        const todayStr = new Date().toDateString();

        snap.forEach(doc => {
          const d = doc.data();
          totalTasks++;
          
          // استخدام linkId بدلاً من taskId
          const type = d.linkId !== undefined ? `رابط ${d.linkId}` : 'غير معروف';
          taskCounts[type] = (taskCounts[type] || 0) + 1;
          
          // استخدام completedAt للتحقق من تاريخ اليوم
          const dDate = d.completedAt?.toDate ? d.completedAt.toDate() : null;
          if (dDate && dDate.toDateString() === todayStr) todayCount++;
        });

        const topTasks = Object.entries(taskCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
        return res.status(200).json({ totalTasks, todayCount, uniqueTypes: Object.keys(taskCounts).length, topTasks });
      }
    }

    // --- [4] موديول الإحالات (Referrals Module) ---
    if (module === 'referrals') {
      if (!refToken) return res.status(401).json({ error: "No Ref Token" });
      jwt.verify(refToken, process.env.JWT_SECRET);

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
            const wSnap = await db.collection('withdrawals').where('userId', 'in', uChunk).where('status', '==', 'completed').get();
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
              name: bossData?.name || "مستخدم " + bossId.slice(0,5),
              email: bossData?.email || "-",
              friends: [], totalComm: 0
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
    }

  } catch (e) { return res.status(401).json({ error: "Session Expired" }); }
}
