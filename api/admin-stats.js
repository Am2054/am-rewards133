import { db } from "../../lib/firebaseAdmin";

// تعريف المتغيرات خارج الـ Handler لضمان بقائها في ذاكرة السيرفر (Cold Start Cache)
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30 ثانية

export default async function handler(req, res) {
  // 1. التحقق من الـ Cache أولاً
  const currentTime = Date.now();
  if (cachedStats && (currentTime - lastFetchTime < CACHE_DURATION)) {
    console.log("Serving from Cache 🚀");
    return res.status(200).json(cachedStats);
  }

  try {
    console.log("Fetching fresh data from Firestore... 🔥");
    
    // جلب البيانات من Firestore (نفس استعلامات الحقول الدقيقة)
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

    // حساب بيانات المستخدمين (points, totalReferralEarnings)
    usersSnap.forEach(doc => {
      const data = doc.data();
      stats.currentPoints += (Number(data.points) || 0);
      stats.totalRefEarnings += (Number(data.totalReferralEarnings) || 0);
      if (data.referredBy) stats.totalRefCount++;
    });

    // حساب النقاط الموزعة (tasks pointsEarned + reward transactions)
    tasksSnap.forEach(doc => {
      stats.totalDistributedPoints += (Number(doc.data().pointsEarned) || 0);
    });
    transSnap.forEach(doc => {
      stats.totalDistributedPoints += (Number(doc.data().amount) || 0);
    });

    // حساب السحوبات (حقل net كما في الصورة)
    withdrawalsSnap.forEach(doc => {
      const d = doc.data();
      if (d.status === "pending") stats.pendingWithdrawals++;
      if (d.status === "completed") {
        stats.totalPaidNet += (Number(d.net) || 0);
        if (d.processedAt) {
          const processDate = d.processedAt.toDate().toDateString();
          if (processDate === today) stats.todayPaidCount++;
        }
      }
    });

    // 2. تحديث الـ Cache
    cachedStats = stats;
    lastFetchTime = currentTime;

    res.status(200).json(stats);

  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
