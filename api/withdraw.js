import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// ** تأكد من تهيئة مفاتيح Firebase Admin Key بشكل صحيح في Vercel Environment Variables **
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: "am--rewards",
  });
}

const db = getFirestore();
const auth = getAuth();

// ⚙️ إعدادات السحب
const POINT_VALUE = 0.07;
const MIN_WITHDRAW = 20;
const MAX_DAILY = 200;
const MAX_OPS = 2;
const REFERRAL_BONUS_LIMIT = 10;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }

  // تسجيل IP و User-Agent لأمان إضافي
  const userIP = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "unknown";

  try {
    const { amount, wallet } = req.body;
    const token = req.headers.authorization?.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }

    // ✅ التحقق من المستخدم
    const decoded = await auth.verifyIdToken(token);
    const userId = decoded.uid;
    const amt = parseFloat(amount);

    // التحقق من صحة البيانات
    if (isNaN(amt) || !wallet || wallet.length !== 11 || !/^\d{11}$/.test(wallet)) {
        return res.status(400).json({ success: false, message: "Invalid data format or missing required fields." });
    }
    if (amt < MIN_WITHDRAW) {
      return res.status(400).json({ success: false, message: `Amount below minimum (${MIN_WITHDRAW} EGP)` });
    }

    // 🕛 حساب عمليات اليوم (UTC)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0); 

    const todaySnap = await db.collection("withdrawals")
      .where("userId", "==", userId)
      .where("date", ">=", startOfDay)
      .where("status", "in", ["pending", "completed"])
      .get();

    let ops = 0;
    let total = 0;

    todaySnap.forEach(d => {
        ops++;
        total += d.data().amount;
    });
    
    // ** تطبيق الحدود (رمي خطأ 403 منطقي) **
    if (ops >= MAX_OPS) {
      throw new Error(`resource-exhausted: Daily operations limit reached (${MAX_OPS}).`);
    }

    if (total + amt > MAX_DAILY) {
      const remaining = MAX_DAILY - total;
      throw new Error(`resource-exhausted: Daily amount limit exceeded. Remaining is ${remaining.toFixed(2)} EGP.`);
    }
    
    // 🔒 معاملة آمنة
    await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(userId);
      const snap = await tr.get(userRef);

      if (!snap.exists) throw new Error("User data not found");

      const userData = snap.data();
      const points = userData.points || 0;
      const neededPts = Math.ceil(amt / POINT_VALUE);

      if (points < neededPts) throw new Error("Not enough points");

      const isReferralEligible = (userData.referralBonusesCount || 0) < REFERRAL_BONUS_LIMIT;

      tr.update(userRef, {
        points: FieldValue.increment(-neededPts),
        lastWithdraw: FieldValue.serverTimestamp(),
      });

      tr.set(db.collection("withdrawals").doc(), {
        userId,
        amount: amt,
        wallet,
        method: "vodafone",
        fee: amt * 0.1,
        net: amt * 0.9,
        points: neededPts,
        status: "pending",
        date: FieldValue.serverTimestamp(),
        
        referredByUID: userData.referredByUID || null,
        isReferralEligible: isReferralEligible,
        isReferralPaid: false,
        
        ip: userIP,
        ua: userAgent
      });
    });

    return res.status(200).json({ success: true, message: "Withdrawal request submitted. Review in progress." });

  } catch (err) {
    console.error("Withdraw Error:", err.message);
    let message = "Server error. Try again later.";
    let statusCode = 500; 

    // ** التمييز بين Status Codes **
    if (err.message.includes("resource-exhausted") || err.message.includes("points") || err.message.includes("data not found")) {
        statusCode = 403; // ممنوع/انتهاك منطق التطبيق
        message = err.message.split(':').pop().trim();
    }
    
    return res.status(statusCode).json({ success: false, message });
  }
}
