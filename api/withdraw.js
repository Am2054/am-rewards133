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
const POINT_VALUE = 0.07;
const MIN_WITHDRAWAL = 20;
const MAX_DAILY_AMOUNT = 200;
const MAX_OPS_PER_DAY = 2;
const NET_FEE = 0.10;
const REFERRAL_BONUS_PERCENT = 0.10;
// 🚨 لم يعد هذا الحد يستخدم هنا، سيتم تطبيقه في دالة معالجة الدفع (الإدارية)
// const REFERRAL_BONUS_LIMIT = 10; 

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

  // ======== 2. البيانات الأمنية المضافة ========
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown Agent';

  // ======== 3. التحقق من المدخلات وتحويل المبلغ (تعديل رقم 1) ========
  const { amount: rawAmount, wallet } = req.body;
  const amount = Number(rawAmount); // 🚨 التحويل الإلزامي
  
  if (isNaN(amount) || !wallet) { // التحقق من NaN هنا
    return res.status(400).json({ success: false, message: "Missing or Invalid amount/wallet data." });
  }
  if (amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ success: false, message: `Minimum withdrawal amount is ${MIN_WITHDRAWAL} EGP.` });
  }
  if (!/^\d{11}$/.test(wallet)) {
    return res.status(400).json({ success: false, message: "Invalid wallet number. Must be 11 digits." });
  }

  try {
    await db.runTransaction(async (tr) => {
      // ======== 4. جلب بيانات المستخدم ========
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      if (!userSnap.exists) throw new Error("User not found.");

      const userData = userSnap.data();
      const currentPoints = userData.points || 0;
      const pointsNeeded = Math.ceil(amount / POINT_VALUE);

      if (currentPoints < pointsNeeded) {
        throw new Error("resource-exhausted: Insufficient points for this withdrawal.");
      }

      // ======== 5. التحقق من الحد اليومي وعدد العمليات (باستخدام UTC) ========
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay)
        .where("status", "in", ["pending", "completed"])
        .get();

      let todayAmount = 0;
      let todayOps = 0;
      let hasPendingRequest = false; 

      todaySnap.forEach(doc => {
        const data = doc.data();
        todayOps++;
        todayAmount += data.amount || 0;
        
        if (data.status === "pending") {
            hasPendingRequest = true;
        }
      });

      if (hasPendingRequest) {
          throw new Error(`limit-reached: You already have a pending withdrawal request. Please wait until it's processed.`);
      }

      if (todayOps >= MAX_OPS_PER_DAY) {
        throw new Error(`limit-reached: Maximum daily withdrawal operations reached (${MAX_OPS_PER_DAY}).`);
      }
      if ((todayAmount + amount) > MAX_DAILY_AMOUNT) {
        throw new Error(`limit-reached: Daily withdrawal limit exceeded (${MAX_DAILY_AMOUNT} EGP).`);
      }

      // ======== 6. خصم النقاط وإنشاء وثيقة السحب ========
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
        // بيانات الأمان
        ip: userIp,
        userAgent: userAgent,
      };

      // ======== 7. مكافأة الإحالة (تسجيل البيانات فقط - تعديل رقم 2) ========
      const { referredByUID } = userData;
      if (referredByUID) {
        // يتم تسجيل الداعي فقط.
        // **منطق منح النقاط وزيادة referralBonusesCount تم نقله إلى دالة الإدارة عند إكمال الدفع**
        withdrawalData.referredByUID = referredByUID;
        withdrawalData.referralBonusPercent = REFERRAL_BONUS_PERCENT;
        withdrawalData.referralPointsCalculated = Math.ceil((amount * REFERRAL_BONUS_PERCENT) / POINT_VALUE);
      }
      // 🚨 تم حذف: tr.update(referrerRef, { points: FieldValue.increment(bonusPoints), referralBonusesCount: FieldValue.increment(1), });
      
      tr.set(withdrawalRef, withdrawalData);
    });

    return res.status(200).json({ success: true, message: "✅ تم إرسال طلب السحب بنجاح. سيتم مراجعته خلال 24 ساعة." });

  } catch (err) {
    console.error("Withdrawal Error:", err);
    return res.status(400).json({ success: false, message: err.message || "Internal Server Error" });
  }
}
