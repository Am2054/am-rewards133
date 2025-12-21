import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";

// ------------------- Rate Limiter -------------------
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 5, // يسمح بـ 5 محاولات فقط من نفس الـ IP
  message: { code: "LIMIT_REACHED", message: "لقد حاولت كثيراً، يرجى المحاولة بعد 15 دقيقة" }
});

// ------------------- Firebase Init -------------------
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// ------------------- توليد كود إحالة فريد -------------------
async function generateUniqueReferralCode(tr) {
  let code, exists = true;

  while (exists) {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const snap = await tr.get(
      db.collection("users").where("referralCode", "==", code).limit(1)
    );
    exists = !snap.empty;
  }

  return code;
}

// ------------------- تسجيل المحاولات -------------------
async function logSignupAttempt(data) {
  await db.collection('signupLogs').add({
    ...data,
    timestamp: FieldValue.serverTimestamp()
  });
}

// ------------------- Handler التسجيل -------------------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password, referralCode, name, phone, deviceId } = req.body;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "";

  if (!email || !password || !phone || !name || !deviceId) {
    await logSignupAttempt({ email, deviceId, ip, status: "MISSING_DATA" });
    return res.status(400).json({ code: "MISSING_DATA", message: "بيانات ناقصة" });
  }

  try {
    // ---------------- Rate Limiter ----------------
    await new Promise((resolve, reject) => {
      signupLimiter(req, res, (result) => {
        if (res.headersSent) reject("LIMIT_REACHED");
        else resolve();
      });
    });

    // ---------------- تحقق من الجهاز ----------------
    const deviceSnap = await db.collection("userDevices")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();
    if (!deviceSnap.empty) {
      await logSignupAttempt({ email, deviceId, ip, status: "DEVICE_EXISTS" });
      return res.status(403).json({ code: "DEVICE_EXISTS", message: "هذا الجهاز مسجل بالفعل، مسموح بحساب واحد لكل جهاز" });
    }

    // ---------------- Transaction لإنشاء الحساب ----------------
    const result = await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(); // توليد UID تلقائي
      const uid = userRef.id;

      let referredBy = null;
      let referrerRef = null;

      // ---------------- منطق الإحالة ----------------
      if (referralCode) {
        const refSnap = await tr.get(
          db.collection("users")
            .where("referralCode", "==", referralCode.toUpperCase())
            .limit(1)
        );

        if (!refSnap.empty) {
          const refDoc = refSnap.docs[0];
          const refData = refDoc.data();

          if (refDoc.id !== uid && refData.deviceId !== deviceId) {
            referredBy = refDoc.id;
            referrerRef = refDoc.ref;
          }
        }
      }

      const myReferralCode = await generateUniqueReferralCode(tr);
      const hashedPassword = await bcrypt.hash(password, 10);

      // ---------------- إنشاء الحساب ----------------
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
        tr.update(referrerRef, {
          referralCount: FieldValue.increment(1),
        });
      }

      tr.set(db.collection("userDevices").doc(), {
        uid,
        deviceId,
        ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { uid, referralCode: myReferralCode };
    });

    await logSignupAttempt({ email, deviceId, ip, status: "SUCCESS" });
    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    const map = {
      DEVICE_EXISTS: "هذا الجهاز مسجل بالفعل، مسموح بحساب واحد لكل جهاز",
      LIMIT_REACHED: "لقد حاولت كثيراً، يرجى المحاولة بعد 15 دقيقة"
    };

    await logSignupAttempt({ email, deviceId, ip, status: err.toString() });
    return res.status(403).json({ code: err.toString(), message: map[err] || "فشل تسجيل الحساب، حاول لاحقاً" });
  }
                    }
