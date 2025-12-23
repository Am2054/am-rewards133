import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const db = getFirestore();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION = 10*60*1000; // 10 دقائق

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message:"Method not allowed" });

  const { idToken, deviceId, confirmNewDevice } = req.body;
  if (!idToken || !deviceId) return res.status(400).json({ message:"بيانات غير مكتملة" });

  try {
    // ----------------- تحقق من Token -----------------
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    // ----------------- محاولات تسجيل الدخول -----------------
    const attemptsRef = db.collection("loginAttempts").doc(deviceId);
    const attemptsSnap = await attemptsRef.get();
    let attemptsData = attemptsSnap.exists ? attemptsSnap.data() : {count:0,lastAttempt:0};
    const now = Date.now();
    const elapsed = now - (attemptsData.lastAttempt || 0);

    if(attemptsData.count >= MAX_ATTEMPTS && elapsed < BLOCK_DURATION){
      return res.status(403).json({
        message:"⚠️ تم تعطيل تسجيل الدخول مؤقتًا.",
        remainingTime: BLOCK_DURATION - elapsed
      });
    }

    // ----------------- User profile -----------------
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if(!userSnap.exists) return res.status(403).json({ message:"لا يوجد حساب مرتبط" });
    const user = userSnap.data();
    if(user.isBanned) return res.status(403).json({ message:"تم حظر الحساب" });

    // ----------------- Device Check -----------------
    const deviceQuery = await db.collection("userDevices")
      .where("uid","==",uid)
      .where("deviceId","==",deviceId)
      .limit(1).get();

    if(deviceQuery.empty){
      const anyDevice = await db.collection("userDevices").where("uid","==",uid).limit(1).get();
      if(!anyDevice.empty && !confirmNewDevice){
        return res.status(403).json({
          requireConfirmation:true,
          message:"❌ أنت تقوم بتسجيل الدخول من جهاز جديد. هل تريد تأكيده؟"
        });
      }
      await db.collection("userDevices").add({uid, deviceId, createdAt:FieldValue.serverTimestamp()});
    }

    // ----------------- Reset attempts -----------------
    await attemptsRef.set({count:0,lastAttempt:0},{merge:true});
    await userRef.update({lastLogin:FieldValue.serverTimestamp()});

    return res.json({success:true});

  } catch(err) {
    if(err.code === "auth/id-token-expired"){
      return res.status(401).json({message:"انتهت الجلسة، أعد تسجيل الدخول"});
    }
    return res.status(401).json({message:"جلسة غير صالحة"});
  }
  }
