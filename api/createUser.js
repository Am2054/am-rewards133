import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
    projectId: "am--rewards",
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false });
  }

  try {
    const { uid, email, name, referralCode, deviceId } = req.body;

    if (!uid || !email || !deviceId) {
      return res.status(400).json({ success: false, message: "Missing data" });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;

    let referredBy = null;
    let referrerRef = null;

    // 🔗 ربط الإحالة
    if (referralCode) {
      const refSnap = await db
        .collection("users")
        .where("referralCode", "==", referralCode.toUpperCase())
        .limit(1)
        .get();

      if (!refSnap.empty && refSnap.docs[0].id !== uid) {
        referredBy = refSnap.docs[0].id;
        referrerRef = refSnap.docs[0].ref;
      }
    }

    // 🎯 كود إحالة جديد
    const myCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    await db.runTransaction(async (tr) => {
      const userRef = db.collection("users").doc(uid);

      tr.set(userRef, {
        uid,
        email,
        name: name || "مستخدم جديد",
        deviceId,
        referralCode: myCode,
        referredBy,
        points: 0,
        referralCount: 0,
        referralBonusesCount: 0,
        totalReferralEarnings: 0,
        registeredIp: ip,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) {
        tr.update(referrerRef, {
          referralCount: FieldValue.increment(1),
        });
      }
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("CreateUser Error:", err);
    return res.status(500).json({ success: false });
  }
  }
