import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import rateLimit from "express-rate-limit";

// ================= Rate Limit =================
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 دقائق
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "LIMIT_REACHED",
    message: "محاولات كثيرة، انتظر 10 دقائق"
  }
});

// ================= Firebase Init =================
if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const db = getFirestore();

// ================= Handler =================
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ code: "METHOD_NOT_ALLOWED", message: "طريقة غير مسموح بها" });
  }

  const { email, password, deviceId, confirmNewDevice } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "";

  if (!email || !password || !deviceId) {
    return res.status(400).json({ code: "MISSING_DATA", message: "بيانات غير مكتملة" });
  }

  try {
    // ---------- Rate limit ----------
    await new Promise((resolve, reject) => {
      loginLimiter(req, res, () => {
        if (res.headersSent) reject({ code: "LIMIT_REACHED" });
        else resolve();
      });
    });

    // ---------- Firebase Sign In ----------
    let userRecord;
    try {
      // Firebase Admin SDK لا يدعم تسجيل الدخول بالكلمة مباشرة
      // لذلك نستخدم طريقة بديلة: نبحث عن المستخدم بالـ email
      userRecord = await auth.getUserByEmail(email);
      // بعدين نتحقق من كلمة المرور باستخدام Firebase Auth REST API
      const apiKey = process.env.FIREBASE_API_KEY; // مفتاح API الخاص بمشروع Firebase
      const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      const data = await r.json();
      if (data.error) {
        let msg = "فشل تسجيل الدخول";
        switch (data.error.message) {
          case "EMAIL_NOT_FOUND": msg = "❌ لا يوجد حساب مرتبط بهذا البريد"; break;
          case "INVALID_PASSWORD": msg = "❌ كلمة المرور خاطئة"; break;
          case "TOO_MANY_ATTEMPTS_TRY_LATER": msg = "⚠️ عدد محاولات تسجيل الدخول كبير، انتظر قليلاً"; break;
        }
        return res.status(401).json({ code: "AUTH_ERROR", message: msg });
      }
    } catch(err){
      return res.status(401).json({ code:"AUTH_ERROR", message:"❌ بيانات الدخول غير صحيحة" });
    }

    const uid = userRecord.uid;

    // ---------- User profile ----------
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return res.status(403).json({ code: "NO_PROFILE", message: "لا يوجد حساب مرتبط" });
    }

    const user = userSnap.data();
    if (user.isBanned) {
      return res.status(403).json({ code: "BANNED", message: "تم حظر الحساب" });
    }

    // ---------- Device Check ----------
    const deviceQuery = await db
      .collection("userDevices")
      .where("uid", "==", uid)
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (deviceQuery.empty) {
      const allDevicesQuery = await db.collection("userDevices").where("uid", "==", uid).limit(1).get();
      if (allDevicesQuery.empty) {
        // تسجيل أول جهاز تلقائيًا
        await db.collection("userDevices").add({
          uid,
          deviceId,
          createdAt: FieldValue.serverTimestamp()
        });
      } else {
        if (confirmNewDevice) {
          await db.collection("userDevices").add({
            uid,
            deviceId,
            createdAt: FieldValue.serverTimestamp()
          });
        } else {
          return res.status(403).json({
            code: "NEW_DEVICE",
            requireConfirmation: true,
            message: "❌ أنت تقوم بتسجيل الدخول من هاتف آخر. هل تريد تأكيد الجهاز الجديد؟"
          });
        }
      }
    }

    // ---------- Update user ----------
    await userRef.update({ lastLogin: FieldValue.serverTimestamp(), lastIp: ip });

    // ---------- Logs ----------
    await db.collection("loginLogs").add({ uid, deviceId, ip, createdAt: FieldValue.serverTimestamp() });

    // ---------- Success ----------
    return res.status(200).json({ success: true, uid });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    if (err?.code === "LIMIT_REACHED") return res.status(429).json(err);
    return res.status(500).json({ code: "SERVER_ERROR", message: "خطأ داخلي" });
  }
    }
