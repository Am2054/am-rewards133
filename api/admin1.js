import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

// --- 1. تهيئة Firebase Admin (بدون حذف حرف) ---
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

// نظام تتبع الطلبات لمنع الإغراق (Rate Limiting)
const requestTracker = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, password, fingerprint } = req.body;
  const clientFingerprint = req.headers['x-fingerprint'] || fingerprint;
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // --- حماية Rate Limit ---
  const now = Date.now();
  if (requestTracker.has(userIp)) {
    if (now - requestTracker.get(userIp) < 1000) { // طلب واحد في الثانية كحد أقصى
      return res.status(429).json({ error: "Too many requests" });
    }
  }
  requestTracker.set(userIp, now);

  // --- 2. تسجيل الدخول بكلمة السر الثانية ADMIN_PASSWORD2 ---
  if (action === 'admin_login') {
    if (password === process.env.ADMIN_PASSWORD2) {
      const token = jwt.sign(
        { role: 'referral_admin', device: clientFingerprint }, 
        process.env.JWT_SECRET, 
        { expiresIn: '12h' }
      );
      
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 43200 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized Access" });
  }

  // --- 3. التحقق من التوكن والبصمة (Security Layer) ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.device !== clientFingerprint) {
      return res.status(403).json({ error: "Security Mismatch" });
    }

    // --- 4. جلب وتحليل بيانات الإحالات (Server-Side Logic) ---
    if (action === 'get_referrals_stats') {
      
      // جلب المستخدمين الذين قاموا بالإحالة أو تم إحالتهم (Optimization)
      const usersSnap = await db.collection('users').get();
      const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // جلب السحبات المكتملة فقط لحساب العمولات
      const withdrawalsSnap = await db.collection('withdrawals')
        .where('status', '==', 'completed')
        .get();
      const allWithdrawals = withdrawalsSnap.docs.map(d => d.data());

      const referrersMap = {};
      let totalSystemCommission = 0;
      let totalConversions = 0;

      allUsers.forEach(user => {
        if (user.referredBy) {
          totalConversions++;
          const bossId = user.referredBy;
          
          // فلترة سحبات هذا المستخدم المحال
          const hisWithdrawals = allWithdrawals.filter(w => w.userId === user.id);
          
          let commFromHim = 0;
          // حساب العمولة (أول 10 سحبات فقط)
          hisWithdrawals.slice(0, 10).forEach(w => {
            commFromHim += (Number(w.amount) * 0.10);
          });

          if (!referrersMap[bossId]) {
            const bossData = allUsers.find(u => u.id === bossId);
            referrersMap[bossId] = {
              name: bossData?.name || "Unknown User",
              email: bossData?.email || "-",
              friends: [],
              totalComm: 0
            };
          }

          referrersMap[bossId].friends.push({
            name: user.name,
            email: user.email,
            withdrawalsCount: hisWithdrawals.length,
            commGenerated: commFromHim
          });
          
          referrersMap[bossId].totalComm += commFromHim;
          totalSystemCommission += commFromHim;
        }
      });

      // تحويل الخريطة إلى مصفوفة مرتبة للأوائل
      const leaderboard = Object.entries(referrersMap)
        .sort((a, b) => b[1].totalComm - a[1].totalComm)
        .map(([id, data]) => ({ id, ...data }));

      // إرسال البيانات النهائية الجاهزة للعرض
      return res.status(200).json({
        leaderboard,
        totalConversions,
        totalSystemCommission,
        recentLogs: allUsers.filter(u => u.referredBy).slice(-15).reverse()
      });
    }

  } catch (error) {
    return res.status(401).json({ error: "Session Expired" });
  }
}
