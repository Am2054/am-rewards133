import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { email, password, confirmPassword, referralCode, name, phone, deviceId } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "";

  // 1. Validation
  if (password !== confirmPassword) return res.status(400).json({ message: "❌ كلمات المرور غير متطابقة" });
  if (!/^01\d{9}$/.test(phone)) return res.status(400).json({ message: "❌ رقم هاتف مصري غير صحيح" });

  try {
    // 2. تجميع البيانات للتحقق السريع (Optimization)
    const [deviceSnap, phoneSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", phone).limit(1).get()
    ]);

    if (!deviceSnap.empty) return res.status(403).json({ message: "❌ هذا الجهاز مسجل بالفعل" });
    if (!phoneSnap.empty) return res.status(400).json({ message: "❌ رقم الهاتف مستخدم" });

    // 3. البحث عن الداعي خارج الـ Transaction (أفضل أداء)
    let referrerDoc = null;
    if (referralCode) {
      const refQuery = await db.collection("users").where("referralCode", "==", referralCode.toUpperCase()).limit(1).get();
      if (!refQuery.empty) referrerDoc = refQuery.docs[0];
    }

    // 4. إنشاء الحساب في Auth
    const userRecord = await auth.createUser({ email, password, displayName: name });
    const uid = userRecord.uid;
    const myCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 5. كتابة البيانات في Transaction (Atomic Write)
    await db.runTransaction(async (tr) => {
      tr.set(db.collection("users").doc(uid), {
        uid, email, name, phone, deviceId,
        referralCode: myCode,
        referredBy: referrerDoc ? referrerDoc.id : null,
        points: 0,
        referralCount: 0,
        totalReferralEarnings: 0,
        isBanned: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerDoc) {
        tr.update(referrerDoc.ref, { referralCount: FieldValue.increment(1) });
      }

      tr.set(db.collection("userDevices").doc(), { uid, deviceId, ip, createdAt: FieldValue.serverTimestamp() });
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "❌ خطأ في قاعدة البيانات" });
  }
}
