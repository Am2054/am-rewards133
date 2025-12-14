import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
// تم إزالة getAuth لعدم الحاجة إليه في هذه الدالة

// ** تهيئة مفاتيح Firebase Admin Key **
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: "am--rewards",
  });
}

const db = getFirestore();

// ⚙️ إعدادات الإحالة
const REFERRAL_BONUS_LIMIT = 10;
const POINT_VALUE = 0.07; 

// 🔑 مفتاح سري يجب تعيينه كمتغير بيئة على Vercel
// ** تم تعديل هذا السطر لقراءة AMIR_KEY **
const ADMIN_SECRET = process.env.AMIR_KEY; 

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    // 🛑 1. التحقق من المفتاح السري للمسؤول
    const providedSecret = req.headers['x-admin-secret']; 
    
    // ** التحقق سيعتمد الآن على قيمة AMIR_KEY المخزنة في Vercel **
    if (!ADMIN_SECRET || providedSecret !== ADMIN_SECRET) {
        console.warn("❌ تم رفض محاولة معالجة إحالة غير مصرح بها.");
        return res.status(401).json({ 
            success: false, 
            message: "Unauthorized access: Invalid secret key." 
        });
    }

    try {
        const { withdrawalId, actualAmountPaid } = req.body; 
        
        if (!withdrawalId || !actualAmountPaid) {
            return res.status(400).json({ success: false, message: "Missing withdrawal ID or payment amount." });
        }
        
        // 🔒 عملية آمنة للمكافأة (تبقى كما هي)
        await db.runTransaction(async (tr) => {
            const withdrawalRef = db.collection("withdrawals").doc(withdrawalId);
            const wSnap = await tr.get(withdrawalRef);

            if (!wSnap.exists) throw new Error("Withdrawal document not found");
            
            const wData = wSnap.data();
            const { referredByUID, isReferralEligible, isReferralPaid } = wData;

            if (wData.status === "completed") throw new Error("Withdrawal status already completed.");

            if (isReferralPaid) throw new Error("Referral bonus already processed.");
            
            if (!referredByUID || !isReferralEligible) {
                // تحديث حالة السحب إلى مكتمل حتى لو لم يكن مؤهلاً للمكافأة
                tr.update(withdrawalRef, { status: "completed", isReferralPaid: true, referralStatus: "Not Eligible" });
                return; 
            }

            const referrerRef = db.collection("users").doc(referredByUID);
            const referrerSnap = await tr.get(referrerRef);

            if (!referrerSnap.exists) throw new Error("Referrer user not found");

            const referrerData = referrerSnap.data();
            const currentBonusCount = referrerData.referralBonusesCount || 0;
            
            if (currentBonusCount >= REFERRAL_BONUS_LIMIT) {
                // تحديث حالة السحب إلى مكتمل مع تسجيل تجاوز الحد
                tr.update(withdrawalRef, { status: "completed", isReferralPaid: true, referralStatus: "Limit Reached" });
                return;
            }

            // 4. حساب المكافأة (10% من المبلغ المدفوع فعليًا)
            const bonusEGP = actualAmountPaid * 0.10;
            const bonusPoints = Math.ceil(bonusEGP / POINT_VALUE);

            // 5. منح المكافأة وتحديث عداد الداعي
            tr.update(referrerRef, {
                points: FieldValue.increment(bonusPoints),
                referralBonusesCount: FieldValue.increment(1) 
            });

            // 6. تحديث وثيقة السحب لتسجيل نجاح الدفع والمكافأة
            tr.update(withdrawalRef, {
                status: "completed", 
                isReferralPaid: true,
                referralStatus: `Paid ${bonusPoints} pts`,
                referralPointsAwarded: bonusPoints
            });
        });

        return res.status(200).json({ success: true, message: `Referral bonus and withdrawal completion processed for ID: ${withdrawalId}` });

    } catch (err) {
        console.error("Referral Error:", err);
        return res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
    }
}

        
