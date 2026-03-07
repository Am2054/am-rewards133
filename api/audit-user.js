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
  const { query } = req.query; 
  if (!query) return res.status(400).json({ error: "Query required" });

  try {
    let userDoc = await db.collection("users").doc(query).get();
    if (!userDoc.exists) {
      const emailQuery = await db.collection("users").where("email", "==", query).limit(1).get();
      if (emailQuery.empty) return res.status(404).json({ error: "User not found" });
      userDoc = emailQuery.docs[0];
    }
    const uid = userDoc.id;
    const userData = userDoc.data();

    if (req.method === "POST") {
      const { action, amount, status } = req.body;
      if (action === "updatePoints") {
        await db.collection("users").doc(uid).update({ points: Number(amount) });
        return res.status(200).json({ success: true });
      }
      if (action === "updateStatus") {
        await db.collection("users").doc(uid).update({ accountStatus: status });
        return res.status(200).json({ success: true });
      }
    }

    const [withdrawals, tasks, referrals, devices, rewards, tickets] = await Promise.all([
      db.collection("withdrawals").where("userId", "==", uid).get(),
      db.collection("tasksCompleted").where("userId", "==", uid).get(),
      db.collection("users").where("referredBy", "==", uid).get(),
      db.collection("userDevices").where("uid", "==", uid).limit(1).get(),
      db.collection("points_transactions").where("uid", "==", uid).where("type", "==", "reward").get(),
      db.collection("support_tickets").where("uid", "==", uid).get()
    ]);

    const tasksAnalysis = {};
    tasks.forEach(doc => {
      const d = doc.data();
      const type = d.taskType || "other";
      if (!tasksAnalysis[type]) tasksAnalysis[type] = { count: 0, points: 0, details: [] };
      tasksAnalysis[type].count++;
      tasksAnalysis[type].points += (Number(d.pointsEarned) || 0);
      // استخدام حقل date للمهام بناءً على الصورة
      tasksAnalysis[type].details.push({ 
        ...d, 
        id: doc.id, 
        date: d.date?.toDate() || null 
      });
    });

    const referralsAnalysis = [];
    referrals.forEach(doc => {
      const d = doc.data();
      const completedWithdrawals = Number(d.completedReferralsCount) || 0;
      referralsAnalysis.push({
        uid: doc.id,
        name: d.name || "N/A",
        email: d.email,
        earnedFromHim: (Number(d.referralPoints) || 0),
        withdrawalsDone: completedWithdrawals,
        withdrawalsLeft: Math.max(0, 10 - completedWithdrawals)
      });
    });

    const withdrawalsList = [];
    withdrawals.forEach(doc => {
      const d = doc.data();
      // استخدام حقل date للسحوبات بناءً على الصورة
      withdrawalsList.push({ 
        ...d, 
        id: doc.id, 
        timestamp: d.date?.toDate() || null 
      });
    });

    const ticketsList = [];
    tickets.forEach(doc => {
      const d = doc.data();
      // استخدام حقل timestamp للتذاكر بناءً على الصورة
      ticketsList.push({ 
        ...d, 
        id: doc.id, 
        timestamp: d.timestamp?.toDate() || null 
      });
    });

    let deviceId = "غير مسجل";
    if (!devices.empty) {
      deviceId = devices.docs[0].data().deviceId || "N/A";
    }

    return res.status(200).json({
      profile: { 
        uid, 
        ...userData, 
        deviceId, 
        accountStatus: userData.accountStatus || "active",
        lastLogin: userData.lastLogin?.toDate() || null // جلب وقت الدخول
      },
      tasksGrouped: tasksAnalysis,
      referrals: referralsAnalysis,
      withdrawals: withdrawalsList,
      tickets: ticketsList,
      stats: {
        totalPaidNet: withdrawalsList.filter(w => w.status === "completed").reduce((sum, w) => sum + (Number(w.net) || 0), 0),
        totalTasksPoints: Object.values(tasksAnalysis).reduce((sum, t) => sum + t.points, 0)
      }
    });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
