import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// تهيئة آمنة للـ Admin SDK
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) {
    console.error("Admin Key Error:", e.message);
  }
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // [اختياري] فحص App Check Token هنا لو فعلته
  // const appCheckToken = req.headers['x-firebase-appcheck'];
  // if (!appCheckToken) return res.status(401).json({error: "Unauthorized"});

  const { uid, email, deviceId, referralCode, name, phone } = req.body;
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "").trim();

  // التحقق من البيانات الأساسية
  if (!uid || !email || !deviceId || !phone) {
    return res.status(400).json({ error: "بيانات ناقصة (الهاتف مطلوب)" });
  }

  try {
    // توليد كود إحالة فريد (٦ حروف/أرقام)
    const myNewCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const result = await db.runTransaction(async (tr) => {
      // 1. فحص الجهاز (داخل الـ Transaction لضمان الأمان المطلق)
      const deviceRef = db.collection("userDevices").where("deviceId", "==", deviceId).limit(1);
      const deviceSnap = await tr.get(deviceRef);
      if (!deviceSnap.empty) throw "DEVICE_EXISTS";

      // 2. فحص وجود الحساب
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tr.get(userRef);
      if (userSnap.exists) throw "ACCOUNT_EXISTS";

      let referredBy = null;
      let referrerRef = null;

      // 3. منطق الإحالة الصارم
      if (referralCode && referralCode.trim() !== "") {
        const refQuery = db.collection("users").where("referralCode", "==", referralCode.toUpperCase()).limit(1);
        const refSnap = await tr.get(refQuery);

        if (!refSnap.empty) {
          const refDoc = refSnap.docs[0];
          const refData = refDoc.data();
          // منع الإحالة لنفس الجهاز أو الشخص
          if (refDoc.id !== uid && refData.deviceId !== deviceId) {
            referredBy = refDoc.id;
            referrerRef = refDoc.ref;
          }
        }
      }

      // 4. الحفظ النهائي
      tr.set(userRef, {
        uid, email, name, phone, deviceId,
        referralCode: myNewCode,
        referredBy,
        points: 0,
        referralCount: 0,
        registeredIp: ip,
        isBanned: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) {
        tr.update(referrerRef, { referralCount: FieldValue.increment(1) });
      }

      tr.set(db.collection("userDevices").doc(), {
        uid, deviceId, ip, createdAt: FieldValue.serverTimestamp()
      });

      return { myNewCode };
    });

    return res.status(200).json({ success: true, referralCode: result.myNewCode });

  } catch (err) {
    const errorMap = {
      "DEVICE_EXISTS": "هذا الجهاز مسجل بالفعل بحساب آخر",
      "ACCOUNT_EXISTS": "الحساب موجود بالفعل"
    };
    return res.status(403).json({ error: errorMap[err] || "فشل في إتمام عملية التسجيل" });
  }
}
