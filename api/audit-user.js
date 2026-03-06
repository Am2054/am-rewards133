import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { console.error("Firebase Init Error:", error.message); }
}

const db = getFirestore();

export default async function handler(req, res) {
  // تم حذف جزء التحقق من JWT_SECRET بناءً على طلبك

  const { query } = req.query; // Query للإشارة للمستخدم (UID أو Email)
  if (!query) return res.status(400).json({ error: "Query required" });

  try {
    // 1. البحث عن المستخدم (UID أو Email)
    let userDoc = await db.collection("users").doc(query).get();
    if (!userDoc.exists) {
      const emailQuery = await db.collection("users").where("email", "==", query).limit(1).get();
      if (emailQuery.empty) return res.status(404).json({ error: "User not found" });
      userDoc = emailQuery.docs[0];
    }
    const uid = userDoc.id;
    const userData = userDoc.data();

    // 2. معالجة الإجراءات الإدارية (عبر POST لضمان الأمان)
    if (req.method === "POST") {
      const { action, amount, status } = req.body; // استقبال البيانات من Body

      if (action === "updatePoints") {
        await db.collection("users").doc(uid).update({ points: Number(amount) });
        return res.status(200).json({ success: true, message: "تم تحديث النقاط" });
      }
      if (action === "updateStatus") {
        await db.collection("users").doc(uid).update({ accountStatus: status });
        return res.status(200).json({ success: true, message: "تم تغيير الحالة" });
      }
    }

    // 3. جلب التقارير الشاملة بالتوازي (GET)
    const [withdrawals, tasks, referrals, devices, rewards] = await Promise.all([
      db.collection("withdrawals").where("userId", "==", uid).get(),
      db.collection("tasksCompleted").where("userId", "==", uid).get(),
      db.collection("users").where("referredBy", "==", uid).get(),
      db.collection("userDevices").where("userId", "==", uid).limit(1).get(),
      db.collection("points_transactions").where("uid", "==", uid).where("type", "==", "reward").get()
    ]);

    // حساب إجمالي نقاط المهام (بناءً على حقل pointsEarned)
    let totalTasksPoints = 0;
    const tasksList = [];
    tasks.forEach(doc => {
      const d = doc.data();
      if (d.status === "done") { 
        totalTasksPoints += (Number(d.pointsEarned) || 0);
      }
      tasksList.push({ ...d, date: d.date?.toDate() || "N/A" });
    });

    // حساب إجمالي المكافآت (بناءً على حقل amount ونوع reward)
    let totalRewardsPoints = 0;
    rewards.forEach(doc => {
      totalRewardsPoints += (Number(doc.data().amount) || 0);
    });

    // جلب معرف الجهاز (DeviceId) - تم التصحيح لجلب القيمة من الداتا
    let deviceId = "غير مسجل";
    if (!devices.empty) {
      const dData = devices.docs[0].data();
      deviceId = dData.deviceId || devices.docs[0].id;
    }

    // حساب السحوبات (بناءً على حقل net)
    let totalPaidNet = 0;
    const withdrawalsList = [];
    withdrawals.forEach(doc => {
      const d = doc.data();
      if (d.status === "completed") totalPaidNet += (Number(d.net) || 0);
      withdrawalsList.push({ ...d, id: doc.id, date: d.timestamp?.toDate() || "N/A" });
    });

    const referralsList = [];
    referrals.forEach(doc => {
      const d = doc.data();
      referralsList.push({ name: d.name, email: d.email });
    });

    // إرسال الرد النهائي
    return res.status(200).json({
      profile: {
        uid,
        name: userData.name || "بدون اسم",
        email: userData.email,
        points: userData.points || 0,
        refEarnings: userData.totalReferralEarnings || 0,
        status: userData.accountStatus || "active",
        deviceId: deviceId, 
        lastIp: userData.lastIp || "N/A"
      },
      stats: { 
        totalPaidNet,
        totalTasksPoints, 
        totalRewardsPoints 
      },
      history: {
        tasksCount: tasks.size, 
        withdrawals: withdrawalsList,
        tasks: tasksList, 
        referrals: referralsList
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
