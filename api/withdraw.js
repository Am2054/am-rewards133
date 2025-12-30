import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

const POINT_VALUE = 0.07;
const MIN_WITHDRAWAL = 20;
const MAX_DAILY_AMOUNT = 200;
const MAX_OPS_PER_DAY = 2;
const NET_FEE = 0.10;
const REFERRAL_PERCENT = 0.10;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "الطريقة غير مسموحة" });

  // جلب بيانات الحماية والبيانات المرسلة
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown';

  // استخراج البيانات من الـ body (تأكد من إرسال userId من الفرونت إند)
  const { userId, amount: rawAmount, wallet } = req.body;
  const amount = Number(rawAmount);

  if (!userId) return res.status(400).json({ message: "معرف المستخدم مطلوب." });

  try {
    const isVodafone = /^010\d{8}$/.test(wallet);
    if (!isVodafone) throw new Error("يرجى إدخال رقم فودافون كاش صحيح.");

    await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      
      // 🟡 ملاحظة 1: فحص وجود المستخدم
      if (!userSnap.exists) throw new Error("لم يتم العثور على بيانات المستخدم.");
      
      const userData = userSnap.data();

      const pendingCheck = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("status", "==", "pending")
        .limit(1).get();

      if (!pendingCheck.empty) throw new Error("لديك طلب سحب قيد الانتظار.");

      // 🟡 ملاحظة 2: التوقيت (UTC هو الأضمن للمزامنة)
      const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay).get();

      let todayAmount = 0; let todayOps = 0;
      todaySnap.forEach(doc => {
        if (doc.data().status !== 'rejected') {
          todayOps++;
          todayAmount += doc.data().amount;
        }
      });

      if (todayOps >= MAX_OPS_PER_DAY) throw new Error("وصلت للحد الأقصى للعمليات اليوم.");
      if (todayAmount + amount > MAX_DAILY_AMOUNT) throw new Error("تجاوزت الحد المالي اليومي.");
      if (amount < MIN_WITHDRAWAL) throw new Error(`الحد الأدنى ${MIN_WITHDRAWAL} ج.م.`);

      const pointsNeeded = Math.ceil(amount / POINT_VALUE);
      if (userData.points < pointsNeeded) throw new Error("نقاطك لا تكفي.");

      const withdrawalRef = db.collection("withdrawals").doc();
      const withdrawalData = {
        userId,
        amount,
        wallet,
        net: amount * (1 - NET_FEE),
        pointsUsed: pointsNeeded,
        status: "pending",
        date: FieldValue.serverTimestamp(),
        // 🟡 ملاحظة 3: تسجيل البيانات الأمنية
        ip: userIp,
        userAgent: userAgent,
        referralRewardApplied: false
      };

      if (userData.referredBy && (userData.referralBonusesCount || 0) < 10) {
        withdrawalData.bonusPendingFor = userData.referredBy;
        withdrawalData.bonusPointsAmount = Math.ceil(pointsNeeded * REFERRAL_PERCENT);
      }

      tr.update(userRef, { points: FieldValue.increment(-pointsNeeded) });
      tr.set(withdrawalRef, withdrawalData);
    });

    res.status(200).json({ success: true, message: "تم إرسال الطلب بنجاح وسيتم مراجعته خلال 24 ساعه." });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}
