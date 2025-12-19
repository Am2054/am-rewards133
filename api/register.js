// api/register.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
  });
}

const db = getFirestore();

// توليد كود إحالة فريد
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

  const { uid, email, deviceId, referralCode, name } = req.body;
  const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "").trim();

  if (!uid || !email || !deviceId) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }

  try {
    // 🔒 فحص الجهاز مرة واحدة وبشكل حاسم
    const deviceSnap = await db.collection("userDevices")
      .where("deviceId", "==", deviceId)
      .limit(1)
      .get();

    if (!deviceSnap.empty) {
      return res.status(403).json({ error: "هذا الجهاز مسجل بالفعل" });
    }

    const userRef = db.collection("users").doc(uid);
    const myReferralCode = await generateReferralCode();

    await db.runTransaction(async (tr) => {
      const userSnap = await tr.get(userRef);
      if (userSnap.exists) throw "ACCOUNT_EXISTS";

      let referredBy = null;
      let referrerRef = null;

      if (referralCode) {
        const refSnap = await db.collection("users")
          .where("referralCode", "==", referralCode.toUpperCase())
          .limit(1)
          .get();

        if (!refSnap.empty) {
          const refDoc = refSnap.docs[0];
          const refData = refDoc.data();

          const isSelf = refDoc.id === uid;
          const sameDevice = refData.deviceId === deviceId;

          if (!isSelf && !sameDevice) {
            referredBy = refDoc.id;
            referrerRef = refDoc.ref;
          }
        }
      }

      tr.set(userRef, {
        uid,
        email,
        name: name || "مستخدم جديد",
        deviceId,
        referralCode: myReferralCode,
        referredBy,
        points: 0,
        referralCount: 0,
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
    });

    return res.status(200).json({
      success: true,
      referralCode: myReferralCode,
    });

  } catch (err) {
    const map = {
      "ACCOUNT_EXISTS": "الحساب موجود بالفعل",
    };
    return res.status(403).json({ error: map[err] || "خطأ في التسجيل" });
  }
  }
