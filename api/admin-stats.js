import { db } from "../../lib/firebaseAdmin"; // تأكد من إعداد Firebase Admin SDK

export default async function handler(req, res) {
  // 1. تأمين الـ API ببصمة الجهاز (إضافي)
  const clientFingerprint = req.headers['x-fingerprint'];
  if (!clientFingerprint) {
    return res.status(401).json({ message: "Unauthorized Access" });
  }

  try {
    // جلب كل الكولكشن المطلوبة بالتوازي لسرعة التنفيذ
    const [usersSnap, withdrawalsSnap, tasksSnap, supportSnap, transSnap] = await Promise.all([
      db.collection("users").get(),
      db.collection("withdrawals").get(),
      db.collection("tasksCompleted").get(),
      db.collection("support_tickets").where("status", "==", "pending").get(),
      db.collection("points_transactions").where("type", "==", "reward").get()
    ]);

    let stats = {
      totalUsers: usersSnap.size,
      currentPoints: 0,           // مجموع نقاط المستخدمين الحالية
      totalRefEarnings: 0,        // مجموع أرباح الإحالات
      totalRefCount: 0,           // عدد المستخدمين الذين جاؤوا عبر إحالة
      totalDistributedPoints: 0,  // إجمالي النقاط الموزعة (مهام + هدايا)
      pendingWithdrawals: 0,      // السحوبات المعلقة
      totalPaidNet: 0,            // صافي المبالغ المدفوعة (حقل net)
      todayPaidCount: 0,          // عدد عمليات اليوم
      openSupportTickets: supportSnap.size
    };

    const today = new Date().toDateString();

    // 2. معالجة بيانات المستخدمين
    usersSnap.forEach(doc => {
      const data = doc.data();
      stats.currentPoints += (Number(data.points) || 0);
      stats.totalRefEarnings += (Number(data.totalReferralEarnings) || 0);
      if (data.referredBy) stats.totalRefCount++;
    });

    // 3. حساب النقاط الموزعة من المهام (حقل pointsEarned)
    tasksSnap.forEach(doc => {
      const data = doc.data();
      if (data.status === "done") {
        stats.totalDistributedPoints += (Number(data.pointsEarned) || 0);
      }
    });

    // 4. إضافة نقاط الهدايا/المكافآت اليدوية (من كولكشن الترانزاكشن)
    transSnap.forEach(doc => {
      stats.totalDistributedPoints += (Number(doc.data().amount) || 0);
    });

    // 5. حساب بيانات السحوبات (حقل net وحقل status)
    withdrawalsSnap.forEach(doc => {
      const d = doc.data();
      if (d.status === "pending") {
        stats.pendingWithdrawals++;
      }
      if (d.status === "completed") {
        // نستخدم حقل net كما في الصورة لأنه الصافي الحقيقي
        stats.totalPaidNet += (Number(d.net) || 0);
        
        // التحقق مما إذا كانت العملية تمت اليوم
        if (d.processedAt) {
          const processDate = d.processedAt.toDate().toDateString();
          if (processDate === today) stats.todayPaidCount++;
        }
      }
    });

    // إرسال البيانات النهائية
    res.status(200).json(stats);

  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
