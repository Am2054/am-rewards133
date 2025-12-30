import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const db = getFirestore();
const auth = getAuth();

// الإعدادات الثابتة
const POINT_VALUE = 0.07;
const MIN_WITHDRAWAL = 20;
const MAX_DAILY_AMOUNT = 200;
const MAX_OPS_PER_DAY = 2;
const NET_FEE = 0.10;
const REFERRAL_PERCENT = 0.10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "الطريقة غير مسموحة" });

  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ message: "غير مصرح لك بالدخول" });

  try {
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;
    const { amount: rawAmount, wallet } = req.body;
    const amount = Number(rawAmount);

    // 1. التحقق من صحة رقم فودافون كاش (يبدأ بـ 010 ومكون من 11 رقم)
    const isVodafone = /^010\d{8}$/.test(wallet);
    if (!isVodafone) throw new Error("يرجى إدخال رقم فودافون كاش صحيح يبدأ بـ 010.");

    await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      const userData = userSnap.data();

      // 2. حماية تكرار الطلب (Idempotency Check)
      const pendingCheck = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .limit(1).get();

      if (!pendingCheck.empty) throw new Error("لديك طلب سحب قيد الانتظار بالفعل.");

      // 3. التحقق من الحدود اليومية
      const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay)
        .get();

      let todayAmount = 0; let todayOps = 0;
      todaySnap.forEach(doc => {
        if (doc.data().status !== 'rejected') {
          todayOps++;
          todayAmount += doc.data().amount;
        }
      });

      if (todayOps >= MAX_OPS_PER_DAY) throw new Error(`وصلت للحد الأقصى اليومي (${MAX_OPS_PER_DAY} عمليات).`);
      if (todayAmount + amount > MAX_DAILY_AMOUNT) throw new Error(`المبلغ المتبقي المتاح لك اليوم هو ${(MAX_DAILY_AMOUNT - todayAmount).toFixed(2)} ج.م.`);
      if (amount < MIN_WITHDRAWAL) throw new Error(`الحد الأدنى للسحب هو ${MIN_WITHDRAWAL} ج.م.`);

      const pointsNeeded = Math.ceil(amount / POINT_VALUE);
      if (userData.points < pointsNeeded) throw new Error("نقاطك الحالية لا تكفي لإتمام السحب.");

      // 4. تجهيز بيانات الطلب
      const withdrawalRef = db.collection("withdrawals").doc();
      const withdrawalData = {
        userId,
        amount,
        wallet,
        net: amount * (1 - NET_FEE),
        pointsUsed: pointsNeeded,
        status: "pending",
        date: FieldValue.serverTimestamp(),
        referralRewardApplied: false
      };

      // تسجيل بيانات الإحالة بدون تنفيذها (انتظاراً للقبول)
      if (userData.referredBy && (userData.referralBonusesCount || 0) < 10) {
        withdrawalData.bonusPendingFor = userData.referredBy;
        withdrawalData.bonusPointsAmount = Math.ceil(pointsNeeded * REFERRAL_PERCENT);
      }

      // 5. خصم النقاط من المستخدم
      tr.update(userRef, { points: FieldValue.increment(-pointsNeeded) });
      tr.set(withdrawalRef, withdrawalData);
    });

    res.status(200).json({ success: true, message: "تم إرسال طلب السحب بنجاح وسيتم مراجعته خلال 24 ساعه." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}
