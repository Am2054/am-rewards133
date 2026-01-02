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

  const { email, password, confirmPassword, referralCode, name, phone, deviceId } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "";

  // ======== 1. التحقق من صحة البيانات ========
  if (!email || !password || !phone || !name || !deviceId) {
    return res.status(400).json({ success: false, message: "❌ يرجى إكمال جميع الحقول المطلوبة." });
  }

  if (name.length < 3) {
    return res.status(400).json({ success: false, message: "❌ الاسم الكامل يجب أن يكون 3 أحرف على الأقل." });
  }

  if (!/^01\d{9}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "❌ رقم الهاتف غير صحيح، يجب أن يكون 11 رقماً ويبدأ بـ 01." });
  }

  if (password.length < 6) {
    return res.status(400).json({ success: false, message: "❌ كلمة المرور ضعيفة، يجب أن لا تقل عن 6 أحرف." });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: "❌ كلمات المرور غير متطابقة." });
  }

  try {
    // 2. التحقق من تكرار البيانات (خارج الـ Transaction للأداء)
    const [deviceSnap, phoneSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", phone).limit(1).get()
    ]);

    if (!deviceSnap.empty) return res.status(403).json({ success: false, message: "❌ هذا الجهاز مسجل بالفعل بحساب آخر." });
    if (!phoneSnap.empty) return res.status(400).json({ success: false, message: "❌ رقم الهاتف هذا مستخدم بالفعل." });

    // 3. التحقق من كود الإحالة (خارج الـ Transaction كما طلبت)
    let referredBy = null;
    let referrerRef = null;
    if (referralCode) {
      const refSnap = await db.collection("users").where("referralCode", "==", referralCode.toUpperCase()).limit(1).get();
      if (!refSnap.empty) {
        referredBy = refSnap.docs[0].id;
        referrerRef = refSnap.docs[0].ref;
      }
    }

    // 4. إنشاء الحساب في Firebase Auth
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: email,
        password: password,
        displayName: name,
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ success: false, message: "❌ البريد الإلكتروني مسجل مسبقاً." });
      }
      throw authError;
    }

    const uid = userRecord.uid;
    const myReferralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 5. حفظ البيانات في Firestore (Transaction للكتابة فقط لضمان السرعة)
    await db.runTransaction(async (tr) => {
      tr.set(db.collection("users").doc(uid), {
        uid, email, name, phone, deviceId,
        referralCode: myReferralCode,
        referredBy: referredBy,
        points: 0,
        referralCount: 0,
        totalReferralEarnings: 0,
        referralBonusesCount: 0,
        withdrawn: 0,
        isBanned: false,
        registeredIp: ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) tr.update(referrerRef, { referralCount: FieldValue.increment(1) });
      tr.set(db.collection("userDevices").doc(), { uid, deviceId, ip, createdAt: FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true, message: "✅ تم إنشاء الحساب بنجاح." });

  } catch (err) {
    console.error("Signup Error:", err);
    return res.status(500).json({ success: false, message: "❌ حدث خطأ داخلي أثناء التسجيل." });
  }
}
