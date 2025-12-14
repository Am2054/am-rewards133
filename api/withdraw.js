import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth"; // ⬅️ تم إضافة استيراد مصادقة المستخدم

// ** تهيئة مفاتيح Firebase Admin Key **
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
    projectId: "am--rewards",
  });
}

const db = getFirestore();
const auth = getAuth(); // ⬅️ تهيئة خدمة المصادقة

// ⚙️ إعدادات الإحالة (قد لا تكون مطلوبة هنا إذا كانت الدالة فقط للسحب)
const POINT_VALUE = 0.07; 

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    // 🛑 1. التحقق من مصادقة المستخدم (Firebase ID Token)
    const token = req.headers.authorization?.split('Bearer ')[1];
    let userId = null;

    if (!token) {
        return res.status(401).json({ success: false, message: "Authorization token missing." });
    }

    try {
        const decodedToken = await auth.verifyIdToken(token);
        userId = decodedToken.uid;
    } catch (error) {
        console.error("Firebase Auth Error:", error.message);
        return res.status(401).json({ success: false, message: "Invalid or expired authorization token." });
    }
    // ⬅️ انتهى التحقق من الأمان

    try {
        const { amount, wallet } = req.body; // البيانات المرسلة من الفرونت إند

        if (!amount || !wallet) {
            return res.status(400).json({ success: false, message: "Missing amount or wallet data." });
        }
        
        // يجب أن يتم وضع منطق التحقق من الرصيد والحدود والسحب هنا
        // هذا مجرد نموذج مبسط:

        await db.runTransaction(async (tr) => {
            const userRef = db.collection("users").doc(userId);
            const userSnap = await tr.get(userRef);

            if (!userSnap.exists) throw new Error("User not found.");

            const userData = userSnap.data();
            const currentPoints = userData.points || 0;
            const pointsNeeded = Math.ceil(amount / POINT_VALUE);

            if (currentPoints < pointsNeeded) {
                 // استخدام رسالة واضحة يمكن للفرونت إند التعرف عليها
                throw new Error("resource-exhausted: Insufficient points for this withdrawal."); 
            }
            
            // 2. تحديث رصيد المستخدم
            tr.update(userRef, {
                points: FieldValue.increment(-pointsNeeded)
            });

            // 3. إنشاء وثيقة سحب جديدة
            const withdrawalRef = db.collection("withdrawals").doc();
            tr.set(withdrawalRef, {
                userId: userId,
                amount: amount,
                net: amount * 0.90, // صافي المبلغ بعد 10% رسوم
                pointsUsed: pointsNeeded,
                wallet: wallet,
                status: "pending",
                date: FieldValue.serverTimestamp(),
                // ... بيانات إحالة اختيارية
            });
        });


        // 4. رسالة النجاح
        return res.status(200).json({ success: true, message: "تم إرسال طلب السحب بنجاح. سنراجع طلبك خلال 24 ساعة." });

    } catch (err) {
        console.error("Withdrawal Error:", err);
        return res.status(500).json({ success: false, message: err.message || "Internal Server Error" });
    }
}
