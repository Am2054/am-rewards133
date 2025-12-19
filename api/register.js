import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  initializeApp({ credential: cert(serviceAccount) });
}

const db = getFirestore();

// توليد كود إحالة فريد
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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { uid, email, deviceId, referralCode, name, phone } = req.body;
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "";

  if (!uid || !email || !deviceId || !phone) {
    return res.status(400).json({ error: "MISSING_DATA" });
  }

  try {
    const result = await db.runTransaction(async (tr) => {
      // 🔒 منع تكرار الجهاز
      const deviceSnap = await tr.get(
        db.collection("userDevices").where("deviceId", "==", deviceId).limit(1)
      );
      if (!deviceSnap.empty) throw "DEVICE_EXISTS";

      // 🔒 منع تكرار الحساب
      const userRef = db.collection("users").doc(uid);
      if ((await tr.get(userRef)).exists) throw "ACCOUNT_EXISTS";

      let referredBy = null;
      let referrerRef = null;

      // 🔗 منطق الإحالة
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

      // 🧾 إنشاء الحساب
      tr.set(userRef, {
        uid,
        email,
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

      return { referralCode: myReferralCode };
    });

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    const map = {
      DEVICE_EXISTS: "هذا الجهاز مسجل بالفعل",
      ACCOUNT_EXISTS: "الحساب موجود بالفعل",
      MISSING_DATA: "بيانات ناقصة",
    };
    return res.status(403).json({ error: map[err] || "REGISTER_FAILED" });
  }
         }
