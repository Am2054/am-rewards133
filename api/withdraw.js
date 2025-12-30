const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

// التحقق من وجود التطبيق مسبقاً لمنع خطأ التكرار
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  initializeApp({
    credential: cert(serviceAccount),
    projectId: "am--rewards"
  });
}

const db = getFirestore();
const auth = getAuth();

const POINT_VALUE = 0.07;
const MIN_WITHDRAWAL = 20;
const MAX_DAILY_AMOUNT = 200;
const MAX_OPS_PER_DAY = 2;
const NET_FEE = 0.10;
const REFERRAL_BONUS_PERCENT = 0.10;

export default async function handler(req, res) {
  // ضبط الرأس ليكون JSON دائماً لمنع خطأ Unexpected token 'A'
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "الطريقة غير مسموحة." });
  }

  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    return res.status(401).json({ success: false, message: "رمز المصادقة مفقود." });
  }

  let userId;
  try {
    const decodedToken = await auth.verifyIdToken(token);
    userId = decodedToken.uid;
  } catch (err) {
    return res.status(401).json({ success: false, message: "جلسة منتهية، يرجى إعادة تسجيل الدخول." });
  }

  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";
  const userAgent = req.headers['user-agent'] || 'Unknown Agent';
  const { amount: rawAmount, wallet } = req.body;
  const amount = Number(rawAmount);

  if (isNaN(amount) || !wallet || !/^\d{11}$/.test(wallet)) {
    return res.status(400).json({ success: false, message: "بيانات غير صالحة. تأكد من الرقم والمبلغ." });
  }

  try {
    await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      if (!userSnap.exists) throw new Error("المستخدم غير موجود.");

      const userData = userSnap.data();
      const pointsNeeded = Math.ceil(amount / POINT_VALUE);
      if ((userData.points || 0) < pointsNeeded) throw new Error("نقاطك الحالية لا تكفي لإتمام هذا السحب.");

      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay)
        .get();

      let todayAmount = 0;
      let todayOps = 0;
      todaySnap.forEach(doc => {
        const data = doc.data();
        if (data.status !== 'rejected') {
          todayOps++;
          todayAmount += data.amount;
        }
      });

      if (todayOps >= MAX_OPS_PER_DAY) {
        throw new Error(`وصلت للحد الأقصى (${MAX_OPS_PER_DAY}) من العمليات اليوم.`);
      }
      if ((todayAmount + amount) > MAX_DAILY_AMOUNT) {
        throw new Error(`تجاوزت الحد اليومي. المتبقي لك: ${(MAX_DAILY_AMOUNT - todayAmount).toFixed(2)} ج.م`);
      }
      if (amount < MIN_WITHDRAWAL) {
        throw new Error(`أقل مبلغ للسحب هو ${MIN_WITHDRAWAL} ج.م.`);
      }

      const userUpdates = { points: FieldValue.increment(-pointsNeeded) };
      const withdrawalRef = db.collection("withdrawals").doc();
      const withdrawalData = {
        userId,
        amount,
        net: amount * (1 - NET_FEE),
        pointsUsed: pointsNeeded,
        wallet,
        status: "pending",
        date: FieldValue.serverTimestamp(),
        ip: userIp,
        userAgent: userAgent,
        referralBonusApplied: false
      };

      // نظام الإحالات
      const { referredBy, referralBonusesCount = 0 } = userData;
      if (referredBy && referralBonusesCount < 10) {
        const bonusPoints = Math.ceil(pointsNeeded * REFERRAL_BONUS_PERCENT);
        const referrerRef = db.collection("users").doc(referredBy);
        tr.update(referrerRef, { points: FieldValue.increment(bonusPoints) });
        userUpdates.referralBonusesCount = FieldValue.increment(1);
        withdrawalData.referralBonusApplied = true;
      }

      tr.update(userRef, userUpdates);
      tr.set(withdrawalRef, withdrawalData);
    });

    return res.status(200).json({ success: true, message: "تم إرسال طلب السحب بنجاح وسيتم مراجعته خلال 24 ساعة." });

  } catch (err) {
    // إرسال نص الخطأ بوضوح لتجنب حرف A
    return res.status(400).json({ success: false, message: err.message });
  }
}
