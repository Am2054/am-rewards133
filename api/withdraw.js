// /api/withdraw.js - معالج السحب المحسّن
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fetch from 'node-fetch';

// تهيئة Firebase Admin
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { 
    console.error("Firebase Init Error:", error.message); 
  }
}

const db = getFirestore();
const auth = getAuth();

const POINT_VALUE = 0.07;
const MIN_WITHDRAWAL = 20;
const MAX_DAILY_AMOUNT = 200;
const MAX_OPS_PER_DAY = 2;
const NET_FEE = 0.10;
const REFERRAL_PERCENT = 0.10;
const COOLDOWN_MS = 3600000; // ساعة واحدة

// ✅ كشف محاولات الاحتيال
class FraudDetectionWithdraw {
  static async analyze(userId, amount, wallet, ip) {
    const riskScore = 0;
    const reasons = [];

    // فحص 1: مبلغ غريب جداً (جداً صغير أو كبير)
    if (amount < 20 || amount > 500) {
      riskScore += 10;
      reasons.push("Unusual withdrawal amount");
    }

    // فحص 2: عدم تطابق الأرقام المستخدمة
    const walletHistory = await db.collection("withdrawals")
      .where("userId", "==", userId)
      .where("status", "==", "completed")
      .limit(10)
      .get();

    const walletsList = walletHistory.docs.map(d => d.data().wallet);
    if (walletsList.length > 3 && !walletsList.includes(wallet)) {
      riskScore += 20;
      reasons.push("New wallet after multiple successful withdrawals");
    }

    // فحص 3: السحب من IP مختلف
    const ipHistory = walletHistory.docs.map(d => d.data().ip);
    const uniqueIPs = [...new Set(ipHistory)];
    
    if (uniqueIPs.length > 3 && !uniqueIPs.includes(ip)) {
      riskScore += 25;
      reasons.push("Withdrawal from new IP address");
    }

    // فحص 4: محاولات سريعة متتالية
    const lastWithdrawal = walletHistory.docs[0];
    if (lastWithdrawal) {
      const timeDiff = Date.now() - lastWithdrawal.data().date.toMillis();
      if (timeDiff < COOLDOWN_MS * 0.5) {
        riskScore += 30;
        reasons.push("Multiple withdrawals too close together");
      }
    }

    return {
      riskScore,
      isSuspicious: riskScore >= 50,
      reasons
    };
  }
}

// ✅ معالج السحب الرئيسي
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) return res.status(401).json({ error: "غير مصرح لك" });

  const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "Unknown";
  const userAgent = req.headers['user-agent'] || 'Unknown';

  try {
    const decodedToken = await auth.verifyIdToken(token);
    const userId = decodedToken.uid;
    const { amount: rawAmount, wallet, method = 'vodafone' } = req.body;
    const amount = Number(rawAmount);

    // ✅ التحقق من صحة البيانات
    const METHODS = {
      vodafone: /^010\d{8}$/,
      orange: /^012\d{8}$/
    };

    if (!METHODS[method] || !METHODS[method].test(wallet)) {
      return res.status(400).json({ 
        error: `رقم ${method === 'vodafone' ? 'فودافون كاش' : 'أورانج موني'} غير صحيح` 
      });
    }

    if (amount < MIN_WITHDRAWAL) {
      return res.status(400).json({ 
        error: `الحد الأدنى للسحب ${MIN_WITHDRAWAL} ج.م` 
      });
    }

    // ✅ فحص الـ Cooldown
    const lastWithdrawal = await db.collection("withdrawals")
      .where("userId", "==", userId)
      .where("status", "==", "completed")
      .orderBy("date", "desc")
      .limit(1)
      .get();

    if (!lastWithdrawal.empty) {
      const lastTime = lastWithdrawal.docs[0].data().date.toMillis();
      const timeDiff = Date.now() - lastTime;
      
      if (timeDiff < COOLDOWN_MS) {
        const remainingMins = Math.ceil((COOLDOWN_MS - timeDiff) / 60000);
        return res.status(429).json({ 
          error: `⏳ يجب الانتظار ${remainingMins} دقيقة قبل السحب التالي` 
        });
      }
    }

    // ✅ فحص الحدود اليومية
    const startOfDay = new Date(); 
    startOfDay.setUTCHours(0, 0, 0, 0);
    
    const todaySnap = await db.collection("withdrawals")
      .where("userId", "==", userId)
      .where("date", ">=", startOfDay).get();

    let todayAmount = 0; 
    let todayOps = 0;
    
    todaySnap.forEach(doc => {
      if (doc.data().status !== 'rejected') {
        todayOps++;
        todayAmount += doc.data().amount;
      }
    });

    if (todayOps >= MAX_OPS_PER_DAY) {
      return res.status(403).json({ 
        error: "وصلت للحد الأقصى للعمليات اليومية" 
      });
    }

    if (todayAmount + amount > MAX_DAILY_AMOUNT) {
      return res.status(403).json({ 
        error: `تجاوزت الحد اليومي المسموح. المتبقي: ${(MAX_DAILY_AMOUNT - todayAmount).toFixed(2)} ج.م` 
      });
    }

    // ✅ فحص الاحتيال
    const fraudCheck = await FraudDetectionWithdraw.analyze(userId, amount, wallet, userIp);
    
    if (fraudCheck.isSuspicious) {
      console.warn(`[FRAUD ALERT] Suspicious withdrawal from ${userId}:`, fraudCheck.reasons);
      
      await db.collection("fraudLogs").add({
        userId,
        type: 'withdrawal',
        amount,
        wallet,
        ip: userIp,
        reasons: fraudCheck.reasons,
        riskScore: fraudCheck.riskScore,
        timestamp: FieldValue.serverTimestamp()
      });

      return res.status(403).json({ 
        error: "تم رفض طلب السحب لأسباب أمنية. يرجى التواصل مع الدعم." 
      });
    }

    // ✅ الحصول على بيانات المستخدم
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();
    
    if (!userSnap.exists) {
      return res.status(404).json({ error: "لم يتم العثور على بيانات المستخدم" });
    }

    const userData = userSnap.data();
    const pointsNeeded = Math.ceil(amount / POINT_VALUE);

    if (userData.points < pointsNeeded) {
      return res.status(400).json({ 
        error: "نقاطك لا تكفي لهذا السحب" 
      });
    }

    // ✅ معالجة السحب في Transaction
    const withdrawalRef = db.collection("withdrawals").doc();
    const withdrawalData = {
      userId,
      userName: userData.name,
      amount,
      wallet,
      method,
      net: amount * (1 - NET_FEE),
      fee: amount * NET_FEE,
      pointsUsed: pointsNeeded,
      status: "pending",
      date: FieldValue.serverTimestamp(),
      ip: userIp,
      userAgent: userAgent,
      referralRewardApplied: false,
      rejectionReason: null
    };

    await db.runTransaction(async (tr) => {
      // تقليل النقاط
      tr.update(userRef, { 
        points: FieldValue.increment(-pointsNeeded),
        totalWithdrawn: FieldValue.increment(amount)
      });

      // إنشاء سجل السحب
      tr.set(withdrawalRef, withdrawalData);

      // معالجة مكافأة الإحالة
      if (userData.referredBy && (userData.totalReferralEarnings || 0) < 10) {
        const bonusPoints = Math.ceil(pointsNeeded * REFERRAL_PERCENT);
        const bonusEgp = Number((amount * REFERRAL_PERCENT).toFixed(2));

        tr.update(withdrawalRef, {
          bonusPendingFor: userData.referredBy,
          bonusPointsAmount: bonusPoints,
          bonusEgpAmount: bonusEgp
        });

        // إضافة إشعار للـ Referrer
        tr.set(db.collection("notifications").doc(), {
          userId: userData.referredBy,
          type: 'referral_withdrawal',
          message: `${userData.name} سحب ${amount} ج.م وحصلت على عمولة ${bonusEgp} ج.م`,
          timestamp: FieldValue.serverTimestamp(),
          read: false
        });
      }
    });

    console.log(`[WITHDRAWAL] New withdrawal request from ${userId}: ${amount}EGP via ${method}`);

    return res.status(200).json({
      success: true,
      message: "تم إرسال طلب السحب بنجاح! سيتم معالجة الطلب خلال 24 ساعة."
    });

  } catch (err) {
    console.error("[ERROR] Withdrawal error:", err);
    return res.status(500).json({ 
      error: "حدث خطأ أثناء معالجة طلب السحب. حاول لاحقاً." 
    });
  }
        }
