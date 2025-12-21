import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth"; // أضفنا هذا السطر
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";

// ------------------- Rate Limiter -------------------
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 5, 
  message: { code: "LIMIT_REACHED", message: "لقد حاولت كثيراً، يرجى المحاولة بعد 15 دقيقة" }
});

// ------------------- Firebase Init -------------------
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();
const auth = getAuth(); // تعريف الـ Auth الخاص بالأدمن

async function generateUniqueReferralCode(tr) {
  let code, exists = true;
  while (exists) {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const snap = await tr.get(db.collection("users").where("referralCode", "==", code).limit(1));
    exists = !snap.empty;
  }
  return code;
}

async function logSignupAttempt(data) {
  await db.collection('signupLogs').add({ ...data, timestamp: FieldValue.serverTimestamp() });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password, referralCode, name, phone, deviceId } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "";

  if (!email || !password || !phone || !name || !deviceId) {
    return res.status(400).json({ code: "MISSING_DATA", message: "بيانات ناقصة" });
  }

  try {
    // 1. تشغيل الـ Rate Limiter
    await new Promise((resolve, reject) => {
      signupLimiter(req, res, (result) => {
        if (res.headersSent) reject("LIMIT_REACHED");
        else resolve();
      });
    });

    // 2. التحقق من الجهاز (أمان إضافي)
    const deviceSnap = await db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get();
    if (!deviceSnap.empty) {
      await logSignupAttempt({ email, deviceId, ip, status: "DEVICE_EXISTS" });
      return res.status(403).json({ code: "DEVICE_EXISTS", message: "هذا الجهاز مسجل بالفعل" });
    }

    // 3. إنشاء المستخدم في Firebase Auth (عن طريق السيرفر)
    // هذا يمنع الخطأ الذي يظهر لك في الـ Frontend
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: email,
        password: password,
        displayName: name,
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ code: "EMAIL_EXISTS", message: "البريد الإلكتروني مسجل بالفعل" });
      }
      throw authError;
    }

    const uid = userRecord.uid;

    // 4. تنفيذ الـ Transaction لحفظ البيانات وإعداد الإحالة
    const result = await db.runTransaction(async (tr) => {
      let referredBy = null;
      let referrerRef = null;

      if (referralCode) {
        const refSnap = await tr.get(db.collection("users").where("referralCode", "==", referralCode.toUpperCase()).limit(1));
        if (!refSnap.empty) {
          const refDoc = refSnap.docs[0];
          referredBy = refDoc.id;
          referrerRef = refDoc.ref;
        }
      }

      const myReferralCode = await generateUniqueReferralCode(tr);
      const hashedPassword = await bcrypt.hash(password, 10);

      const userRef = db.collection("users").doc(uid);
      tr.set(userRef, {
        uid,
        email,
        password: hashedPassword,
        name,
        phone,
        deviceId,
        referralCode: myReferralCode,
        referredBy,
        hasReferrer: !!referredBy,
        points: 0,
        referralCount: 0,
        isBanned: false,
        registeredIp: ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) {
        tr.update(referrerRef, { referralCount: FieldValue.increment(1) });
      }

      tr.set(db.collection("userDevices").doc(), { uid, deviceId, ip, createdAt: FieldValue.serverTimestamp() });

      return { uid, referralCode: myReferralCode };
    });

    await logSignupAttempt({ email, deviceId, ip, status: "SUCCESS" });
    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error("Signup Error:", err);
    return res.status(500).json({ code: "SERVER_ERROR", message: "حدث خطأ في السيرفر، حاول لاحقاً" });
  }
}
