import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
  });
}

const db = getFirestore();

// وظيفة توليد كود إحالة فريد
async function generateReferralCode() {
  let code, exists;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const snap = await db.collection("users").where("referralCode", "==", code).limit(1).get();
    exists = !snap.empty;
  } while (exists);
  return code;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const { uid, email, deviceId, referralCode, name, phone } = req.body;
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "").trim();

  if (!uid || !email || !deviceId) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }

  try {
    // 1. توليد كود المستخدم الجديد قبل بدء العملية
    const myNewCode = await generateReferralCode();

    // 2. البدء في تنفيذ المعاملة (Transaction) لضمان سلامة البيانات 100%
    const result = await db.runTransaction(async (tr) => {
      
      // أ- فحص الجهاز داخل الترانزاكشن لمنع الـ Race Condition
      const deviceSnap = await tr.get(db.collection("userDevices").where("deviceId", "==", deviceId).limit(1));
      if (!deviceSnap.empty) throw "DEVICE_EXISTS";

      // ب- فحص وجود المستخدم
      const userRef = db.collection("users").doc(uid);
      const userSnap = await tr.get(userRef);
      if (userSnap.exists) throw "ACCOUNT_EXISTS";

      let referredBy = null;
      let referrerRef = null;

      // ج- منطق الإحالة
      if (referralCode && referralCode.trim() !== "") {
        const refSnap = await db.collection("users")
          .where("referralCode", "==", referralCode.toUpperCase())
          .limit(1)
          .get();

        if (!refSnap.empty) {
          const refDoc = refSnap.docs[0];
          const refData = refDoc.data();
          // منع الإحالة لنفس الجهاز أو نفس الحساب
          if (refDoc.id !== uid && refData.deviceId !== deviceId) {
            referredBy = refDoc.id;
            referrerRef = refDoc.ref;
          }
        }
      }

      // د- إنشاء وثيقة المستخدم
      tr.set(userRef, {
        uid,
        email,
        name: name || "مستخدم جديد",
        phone: phone || "", // تم إضافة الهاتف هنا
        deviceId,
        referralCode: myNewCode,
        referredBy,
        points: 0,
        referralCount: 0,
        registeredIp: ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      // هـ- تحديث حساب الداعي
      if (referrerRef) {
        tr.update(referrerRef, {
          referralCount: FieldValue.increment(1),
        });
      }

      // و- تسجيل الجهاز في جدول الأجهزة
      const deviceDocRef = db.collection("userDevices").doc();
      tr.set(deviceDocRef, {
        uid,
        deviceId,
        ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { myNewCode };
    });

    return res.status(200).json({
      success: true,
      referralCode: result.myNewCode,
    });

  } catch (err) {
    console.error("Registration Error:", err);
    const map = {
      "ACCOUNT_EXISTS": "الحساب موجود بالفعل",
      "DEVICE_EXISTS": "هذا الجهاز مسجل بالفعل بحساب آخر",
    };
    return res.status(403).json({ error: map[err] || "خطأ فني في التسجيل" });
  }
}
