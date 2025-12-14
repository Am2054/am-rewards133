import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// ======== تهيئة Firebase Admin ========
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: "am--rewards",
  });
}

const db = getFirestore();
const auth = getAuth();

// ======== إعدادات العمليات ========
const POINT_VALUE = 0.07;       // قيمة النقطة بالجنيه المصري
const MIN_WITHDRAWAL = 20;      // الحد الأدنى للسحب
const MAX_DAILY_AMOUNT = 200;   // الحد الأقصى اليومي للسحب
const MAX_OPS_PER_DAY = 2;      // الحد الأقصى لعدد العمليات اليومية
const NET_FEE = 0.10;           // رسوم 10% على كل سحب
const REFERRAL_BONUS_PERCENT = 0.10; // نسبة مكافأة الإحالة (10%)
const REFERRAL_BONUS_LIMIT = 10;     // الحد الأقصى لمكافآت الإحالة

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed." });
  }

  // ======== 1. التحقق من المصادقة ========
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ success: false, message: "Authorization token missing." });

  let userId;
  try {
    const decodedToken = await auth.verifyIdToken(token);
    userId = decodedToken.uid;
  } catch (err) {
    console.error("Firebase Auth Error:", err.message);
    return res.status(401).json({ success: false, message: "Invalid or expired authorization token." });
  }

  // ======== 2. التحقق من المدخلات ========
  const { amount, wallet } = req.body;
  if (!amount || !wallet) {
    return res.status(400).json({ success: false, message: "Missing amount or wallet data." });
  }
  if (amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ success: false, message: `Minimum withdrawal amount is ${MIN_WITHDRAWAL} EGP.` });
  }
  if (!/^\d{11}$/.test(wallet)) {
    return res.status(400).json({ success: false, message: "Invalid wallet number. Must be 11 digits." });
  }

  try {
    await db.runTransaction(async (tr) => {
      // ======== 3. جلب بيانات المستخدم ========
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      if (!userSnap.exists) throw new Error("User not found.");

      const userData = userSnap.data();
      const currentPoints = userData.points || 0;
      const pointsNeeded = Math.ceil(amount / POINT_VALUE);

      if (currentPoints < pointsNeeded) {
        throw new Error("resource-exhausted: Insufficient points for this withdrawal.");
      }

      // ======== 4. التحقق من الحد اليومي وعدد العمليات ========
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startOfDay.setUTCHours(0, 0, 0, 0);

      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay)
        .where("status", "in", ["pending", "completed"])
        .get();

      let todayAmount = 0;
      let todayOps = 0;
      todaySnap.forEach(doc => {
        todayOps++;
        todayAmount += doc.data().amount || 0;
      });

      if (todayOps >= MAX_OPS_PER_DAY) {
        throw new Error(`limit-reached: Maximum daily withdrawal operations reached (${MAX_OPS_PER_DAY}).`);
      }
      if ((todayAmount + amount) > MAX_DAILY_AMOUNT) {
        throw new Error(`limit-reached: Daily withdrawal limit exceeded (${MAX_DAILY_AMOUNT} EGP).`);
      }

      // ======== 5. خصم النقاط وإنشاء وثيقة السحب ========
      tr.update(userRef, { points: FieldValue.increment(-pointsNeeded) });

      const withdrawalRef = db.collection("withdrawals").doc();
      const withdrawalData = {
        userId,
        amount,
        net: amount * (1 - NET_FEE),
        pointsUsed: pointsNeeded,
        wallet,
        status: "pending",
        date: FieldValue.serverTimestamp(),
      };

      // ======== 6. مكافأة الإحالة ========
      const { referredByUID, referralBonusesCount = 0 } = userData;
      if (referredByUID && referralBonusesCount < REFERRAL_BONUS_LIMIT) {
        const referrerRef = db.collection("users").doc(referredByUID);
        const bonusPoints = Math.ceil((amount * REFERRAL_BONUS_PERCENT) / POINT_VALUE);

        tr.update(referrerRef, {
          points: FieldValue.increment(bonusPoints),
          referralBonusesCount: FieldValue.increment(1),
        });

        withdrawalData.referralPointsAwarded = bonusPoints;
        withdrawalData.referralStatus = `Paid ${bonusPoints} pts to referrer`;
      }

      tr.set(withdrawalRef, withdrawalData);
    });

    return res.status(200).json({ success: true, message: "✅ تم إرسال طلب السحب بنجاح. سيتم مراجعته خلال 24 ساعة." });

  } catch (err) {
    console.error("Withdrawal Error:", err);
    return res.status(400).json({ success: false, message: err.message || "Internal Server Error" });
  }
}
