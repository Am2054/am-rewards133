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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "الطريقة غير مسموحة." });
  }

  // ======== 1. التحقق من المصادقة ========
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ success: false, message: "رمز المصادقة مفقود." });

  let userId;
  try {
    const decodedToken = await auth.verifyIdToken(token);
    userId = decodedToken.uid;
  } catch (err) {
    console.error("Firebase Auth Error:", err.message);
    return res.status(401).json({ success: false, message: "رمز مصادقة غير صالح أو منتهي الصلاحية." });
  }

  // ======== 2. البيانات الأمنية المضافة ========
  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'Unknown Agent';

  // ======== 3. التحقق من المدخلات وتحويل المبلغ ========
  const { amount: rawAmount, wallet } = req.body;
  const amount = Number(rawAmount); 
  
  if (isNaN(amount) || !wallet) { 
    return res.status(400).json({ success: false, message: "البيانات المدخلة غير صالحة." });
  }
  if (amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ success: false, message: `الحد الأدنى للسحب هو ${MIN_WITHDRAWAL} جنيه مصري.` });
  }
  if (!/^\d{11}$/.test(wallet)) {
    return res.status(400).json({ success: false, message: "رقم المحفظة غير صالح. يجب أن يتكون من 11 رقماً." });
  }

  try {
    await db.runTransaction(async (tr) => {
      // ======== 4. جلب بيانات المستخدم ========
      const userRef = db.collection("users").doc(userId);
      const userSnap = await tr.get(userRef);
      if (!userSnap.exists) throw new Error("لم يتم العثور على المستخدم.");

      const userData = userSnap.data();
      const currentPoints = userData.points || 0;
      const pointsNeeded = Math.ceil(amount / POINT_VALUE);

      if (currentPoints < pointsNeeded) {
        throw new Error("نقاط غير كافية لإتمام هذا السحب.");
      }

      // ======== 5. التحقق من الحد اليومي وعدد العمليات ========
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);

      const todaySnap = await db.collection("withdrawals")
        .where("userId", "==", userId)
        .where("date", ">=", startOfDay)
        .where("status", "in", ["pending", "completed"])
        .get();

      let todayAmount = 0;
      let todayOps = 0;

      todaySnap.forEach(doc => {
        const data = doc.data();
        todayOps++;
        todayAmount += data.amount || 0;
      });
      
      if (todayOps >= MAX_OPS_PER_DAY) {
        throw new Error(`وصلت للحد الأقصى لعدد عمليات السحب اليومية (${MAX_OPS_PER_DAY} عملية).`);
      }
      if ((todayAmount + amount) > MAX_DAILY_AMOUNT) {
        throw new Error(`تجاوزت الحد الأقصى للمبلغ اليومي للسحب (${MAX_DAILY_AMOUNT} جنيه مصري).`);
      }

      // ======== 6. تجهيز تحديثات المستخدم وإنشاء وثيقة السحب ========
      const userUpdates = { 
        points: FieldValue.increment(-pointsNeeded),
        withdrawn: FieldValue.increment(amount) 
      };

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
      };

      // ======== 7. مكافأة الإحالة (أول 10 عمليات فقط) ========  
      const { referredBy, referralBonusesCount = 0 } = userData; 
      if (referredBy && referralBonusesCount < 10) {  
        withdrawalData.referredBy = referredBy;
        withdrawalData.referralBonusPercent = REFERRAL_BONUS_PERCENT;  
        withdrawalData.referralPointsCalculated = Math.ceil((amount * REFERRAL_BONUS_PERCENT) / POINT_VALUE);
        
        // زيادة عداد المكافآت للمستخدم الحالي
        userUpdates.referralBonusesCount = FieldValue.increment(1);
      }  
        
      tr.update(userRef, userUpdates);
      tr.set(withdrawalRef, withdrawalData);  
    });  

    return res.status(200).json({ success: true, message: "✅ تم إرسال طلب السحب بنجاح. سيتم مراجعته خلال 24 ساعة." });

  } catch (err) {
    console.error("Withdrawal Error:", err);
    // تنظيف الرسالة من أي نصوص إنجليزية قبل العلامة :
    const cleanMessage = err.message.includes(':') ? err.message.split(':').pop().trim() : err.message;
    return res.status(400).json({ success: false, message: cleanMessage || "خطأ داخلي في الخادم." });
  }
}
