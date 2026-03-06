import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// تهيئة Firebase Admin
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
  const { query, action, amount, status } = req.query;
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

    // 2. معالجة الإجراءات الإدارية (تعديل رصيد أو حظر)
    if (action === "updatePoints") {
      await db.collection("users").doc(uid).update({ points: Number(amount) });
      return res.status(200).json({ success: true });
    }
    if (action === "updateStatus") {
      await db.collection("users").doc(uid).update({ accountStatus: status });
      return res.status(200).json({ success: true });
    }

    // 3. جلب التقارير (سحوبات، مهام، إحالات)
    const [withdrawals, tasks, referrals] = await Promise.all([
      db.collection("withdrawals").where("userId", "==", uid).get(),
      db.collection("tasksCompleted").where("userId", "==", uid).get(),
      db.collection("users").where("referredBy", "==", uid).get()
    ]);

    let totalPaidNet = 0;
    const withdrawalsList = [];
    withdrawals.forEach(doc => {
      const d = doc.data();
      if (d.status === "completed") totalPaidNet += (Number(d.net) || 0);
      withdrawalsList.push({ ...d, id: doc.id, date: d.timestamp?.toDate() || "N/A" });
    });

    const tasksList = [];
    tasks.forEach(doc => {
      const d = doc.data();
      tasksList.push({ ...d, date: d.completedAt?.toDate() || "N/A" });
    });

    const referralsList = [];
    referrals.forEach(doc => {
      const d = doc.data();
      referralsList.push({ name: d.name, email: d.email });
    });

    return res.status(200).json({
      profile: {
        uid,
        name: userData.name || "بدون اسم",
        email: userData.email,
        points: userData.points || 0,
        refEarnings: userData.totalReferralEarnings || 0,
        status: userData.accountStatus || "active"
      },
      stats: { totalPaidNet },
      history: {
        withdrawals: withdrawalsList,
        tasks: tasksList,
        referrals: referralsList
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
