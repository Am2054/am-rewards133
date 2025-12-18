import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
    projectId: "am--rewards",
  });
}

const db = getFirestore();

// 🛡️ وظيفة توليد كود إحالة فريد
async function generateUniqueReferralCode() {
  let code, isExists;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const snap = await db.collection("users").where("referralCode", "==", code).limit(1).get();
    isExists = !snap.empty;
  } while (isExists);
  return code;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ success: false });

  try {
    const { uid, email, name, referralCode, deviceId, phone } = req.body;
    const ip = (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "0.0.0.0").trim();

    if (!uid || !email || !deviceId) {
      return res.status(400).json({ success: false, message: "Missing required data" });
    }

    // 1️⃣ حماية: منع الـ Overwrite
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      return res.status(409).json({ success: false, reason: "Account already exists" });
    }

    // 2️⃣ منطق الإحالة الصارم (المطور)
    let referredBy = null;
    let referrerRef = null;

    if (referralCode) {
      const refSnap = await db.collection("users")
        .where("referralCode", "==", referralCode.toUpperCase())
        .limit(1).get();

      if (!refSnap.empty) {
        const referrerData = refSnap.docs[0].data();
        const referrerId = refSnap.docs[0].id;

        // فحص سريع ومباشر للـ IP باستخدام الـ Flag الجديد
        const ipFarmCheck = await db.collection("users")
          .where("registeredIp", "==", ip)
          .where("usedAsReferral", "==", true)
          .limit(1).get();

        // تجميع شروط الرفض: (نفس الـ UID) أو (نفس الـ IP للداعي) أو (نفس الـ DeviceId للداعي) أو (IP مزرعة)
        const isSelfReferral = referrerId === uid;
        const isSameNetwork = referrerData.registeredIp === ip;
        const isSameDevice = referrerData.deviceId === deviceId;
        const isIpFarm = !ipFarmCheck.empty;

        if (!isSelfReferral && !isSameNetwork && !isSameDevice && !isIpFarm) {
          referredBy = referrerId;
          referrerRef = refSnap.docs[0].ref;
        }
      }
    }

    // 3️⃣ توليد كود المستخدم الجديد
    const myNewCode = await generateUniqueReferralCode();

    // 4️⃣ التنفيذ (Transaction)
    await db.runTransaction(async (tr) => {
      tr.set(userRef, {
        uid,
        email,
        name: name || "مستخدم جديد",
        phone: phone || "",
        deviceId,
        referralCode: myNewCode,
        referredBy: referredBy,
        usedAsReferral: !!referredBy, // الـ Flag اللي هيسهل الفحص المرة الجاية
        points: 0,
        referralPoints: 0,
        referralCount: 0,
        referralBonusesCount: 0,
        totalReferralEarnings: 0,
        registeredIp: ip,
        isBanned: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      if (referrerRef) {
        tr.update(referrerRef, {
          referralCount: FieldValue.increment(1),
        });
      }
    });

    // 5️⃣ تحسين الـ Response لخدمة الـ Frontend UX
    return res.status(200).json({ 
      success: true, 
      referralCode: myNewCode,
      referralAccepted: !!referredBy 
    });

  } catch (err) {
    console.error("Critical CreateUser Error:", err);
    return res.status(500).json({ success: false, reason: "Internal Server Error" });
  }
}
