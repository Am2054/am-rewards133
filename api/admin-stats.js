import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// --- 1. تهيئة Firebase Admin (باستخدام الكود الخاص بك) ---
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

// --- 2. إعدادات الـ Cache (خارج الـ handler) ---
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 ثانية

export default async function handler(req, res) {
  // التحقق من البصمة الأمنية (اختياري ولكن مفضل)
  const fingerprint = req.headers['x-fingerprint'];
  if (!fingerprint) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // أ) فحص الـ Cache أولاً
  const currentTime = Date.now();
  if (cachedStats && (currentTime - lastFetchTime < CACHE_DURATION)) {
    console.log("Serving from Server-Side Cache 🚀");
    return res.status(200).json(cachedStats);
  }

  try {
    console.log("Fetching fresh data from Firestore... 🔥");

    // ب) جلب البيانات من المجموعات (Collections)
    const [usersSnap, withdrawalsSnap, tasksSnap, supportSnap, transSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("withdrawals").get(),
      db.collection("tasksCompleted").where("status", "==", "done").get(),
      db.collection("support_tickets").where("status", "==", "pending").get(),
      db.collection("points_transactions").where("type", "==", "reward").get()
    ]);

    let stats = {
      totalUsers: usersSnap.size,
      currentPoints: 0,
      totalRefEarnings: 0,
      totalRefCount: 0,
      totalDistributedPoints: 0,
      pendingWithdrawals: 0,
      totalPaidNet: 0,
      todayPaidCount: 0,
      openSupportTickets: supportSnap.size
    };

    const today = new Date().toDateString();

    // ج) معالجة بيانات المستخدمين
    usersSnap.forEach(doc => {
      const data = doc.data();
      stats.currentPoints += (Number(data.points) || 0);
      stats.totalRefEarnings += (Number(data.totalReferralEarnings) || 0);
      if (data.referredBy) stats.totalRefCount++;
    });

    // د) حساب النقاط الموزعة (مهام + مكافآت)
    tasksSnap.forEach(doc => {
      stats.totalDistributedPoints += (Number(doc.data().pointsEarned) || 0);
    });
    transSnap.forEach(doc => {
      stats.totalDistributedPoints += (Number(doc.data().amount) || 0);
    });

    // هـ) حساب السحوبات (الصافي Net)
    withdrawalsSnap.forEach(doc => {
      const d = doc.data();
      if (d.status === "pending") stats.pendingWithdrawals++;
      if (d.status === "completed") {
        stats.totalPaidNet += (Number(d.net) || 0);
        
        // التحقق من تاريخ اليوم
        if (d.processedAt) {
          const processDate = d.processedAt.toDate().toDateString();
          if (processDate === today) stats.todayPaidCount++;
        }
      }
    });

    // و) تحديث الـ Cache قبل الإرسال
    cachedStats = stats;
    lastFetchTime = currentTime;

    return res.status(200).json(stats);

  } catch (error) {
    console.error("Aggregation Error Details:", error);
    return res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
}
