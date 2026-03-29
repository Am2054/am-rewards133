import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// تهيئة Firebase Admin
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { console.error("Firebase Init Error:", error.message); }
}

const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password, confirmPassword, referralCode, name, phone, deviceId, fingerprint } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown_ip";

  // ======== 0. نظام الـ Rate Limiting (جديد) ========
  try {
    const rateLimitRef = db.collection("rateLimits").doc(ip.replace(/\./g, "_")); // تحويل النقط لشرطات للـ ID
    const rateSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateSnap.exists) {
      const data = rateSnap.data();
      // لو حاول يسجل أكثر من 3 مرات في ساعة واحدة
      if (data.count >= 3 && (now - data.lastAttempt < 3600000)) {
        return res.status(429).json({ success: false, message: "❌ محاولات كثيرة جداً. يرجى الانتظار ساعة قبل المحاولة مرة أخرى." });
      }
      
      // إعادة تعيين العداد لو مر أكتر من ساعة
      if (now - data.lastAttempt > 3600000) {
        await rateLimitRef.set({ count: 1, lastAttempt: now });
      } else {
        await rateLimitRef.update({ count: FieldValue.increment(1), lastAttempt: now });
      }
    } else {
      await rateLimitRef.set({ count: 1, lastAttempt: now });
    }
  } catch (e) { console.error("Rate Limit Check Error:", e); }

  // ======== 1. التحقق من صحة البيانات (منطقك الأصلي) ========
  if (!email || !password || !phone || !name || !deviceId) {
    return res.status(400).json({ success: false, message: "❌ يرجى إكمال جميع الحقول المطلوبة." });
  }

  if (name.length < 3) return res.status(400).json({ success: false, message: "❌ الاسم الكامل يجب أن يكون 3 أحرف على الأقل." });
  if (!/^01\d{9}$/.test(phone)) return res.status(400).json({ success: false, message: "❌ رقم الهاتف غير صحيح." });
  if (password.length < 6) return res.status(400).json({ success: false, message: "❌ كلمة المرور ضعيفة." });
  if (password !== confirmPassword) return res.status(400).json({ success: false, message: "❌ كلمات المرور غير متطابقة." });

  try {
    // 2. التحقق من تكرار البيانات + البصمة
    const [deviceSnap, phoneSnap, fingerprintSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", phone).limit(1).get(),
      fingerprint ? db.collection("userDevices").where("fingerprint", "==", fingerprint).limit(1).get() : { empty: true }
    ]);

    if (!deviceSnap.empty) return res.status(403).json({ success: false, message: "❌ هذا الجهاز مسجل بالفعل." });
    if (!fingerprintSnap.empty) return res.status(403).json({ success: false, message: "❌ تم اكتشاف تسجيل مكرر من هذا المتصفح." });
    if (!phoneSnap.empty) return res.status(400).json({ success: false, message: "❌ رقم الهاتف مستخدم بالفعل." });

    // 3. كود الإحالة (منطقك الأصلي)
    let referredBy = null;
    let referrerRef = null;
    if (referralCode) {
      const refSnap = await db.collection("users").where("referralCode", "==", referralCode.toUpperCase()).limit(1).get();
      if (!refSnap.empty) {
        referredBy = refSnap.docs[0].id;
        referrerRef = refSnap.docs[0].ref;
      }
    }

    // 4. Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.createUser({ email, password, displayName: name });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') return res.status(400).json({ success: false, message: "❌ البريد مسجل مسبقاً." });
      throw authError;
    }

    const uid = userRecord.uid;
    const myReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 5. Firestore Transaction (حفظ بياناتك الأصلية + البصمة)
    await db.runTransaction(async (tr) => {
      tr.set(db.collection("users").doc(uid), {
        uid, email, name, phone, deviceId,
        referralCode: myReferralCode,
        referredBy: referredBy,
        points: 0, referralCount: 0, totalReferralEarnings: 0,
        referralBonusesCount: 0, withdrawn: 0, isBanned: false,
        registeredIp: ip, createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) tr.update(referrerRef, { referralCount: FieldValue.increment(1) });
      
      tr.set(db.collection("userDevices").doc(), { 
        uid, deviceId, fingerprint: fingerprint || "legacy", ip, createdAt: FieldValue.serverTimestamp() 
      });
    });

    return res.status(200).json({ success: true, message: "✅ تم إنشاء الحساب بنجاح." });

  } catch (err) {
    console.error("Signup Error:", err);
    return res.status(500).json({ success: false, message: "❌ حدث خطأ داخلي." });
  }
}
