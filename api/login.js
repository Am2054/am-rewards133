import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g,"\n");
  initializeApp({ credential: cert(serviceAccount) });
}

const auth = getAuth();
const db = getFirestore();

const BLOCK_DURATION = 10 * 60 * 1000; // 10 دقائق
const MAX_ATTEMPTS = 5;

export default async function handler(req,res){
  if(req.method!=="POST") return res.status(405).json({ message:"Method not allowed" });

  const { idToken, deviceId, confirmNewDevice } = req.body;
  if(!idToken || !deviceId) return res.status(400).json({ message:"بيانات غير مكتملة" });

  try{
    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    if(!userSnap.exists) return res.status(403).json({ message:"لا يوجد حساب مرتبط" });

    const user = userSnap.data();
    if(user.isBanned) return res.status(403).json({ message:"تم حظر الحساب" });

    // ---------- Device Check ----------
    const deviceQuery = await db.collection("userDevices")
      .where("uid","==",uid)
      .where("deviceId","==",deviceId).limit(1).get();

    if(deviceQuery.empty){
      const anyDevice = await db.collection("userDevices").where("uid","==",uid).limit(1).get();

      if(!anyDevice.empty && !confirmNewDevice){
        // ---------- Attempts Check ----------
        const attemptsRef = db.collection("loginAttempts").doc(uid);
        const attemptsSnap = await attemptsRef.get();
        const now = Date.now();
        let attemptsData = attemptsSnap.exists ? attemptsSnap.data() : { count:0, lastAttempt:null };

        if(attemptsData.lastAttempt){
          const elapsed = now - attemptsData.lastAttempt.toMillis();
          if(attemptsData.count>=MAX_ATTEMPTS && elapsed < BLOCK_DURATION){
            return res.status(403).json({
              message:"⚠️ تم تعطيل تأكيد الجهاز مؤقتًا.",
              remainingTime: BLOCK_DURATION - elapsed
            });
          }else if(elapsed >= BLOCK_DURATION){
            attemptsData.count = 0; // reset
          }
        }

        attemptsData.count = (attemptsData.count||0)+1;
        attemptsData.lastAttempt = FieldValue.serverTimestamp();
        await attemptsRef.set(attemptsData,{ merge:true });

        return res.status(403).json({
          requireConfirmation:true,
          message:"❌ أنت تقوم بتسجيل الدخول من جهاز جديد. هل تريد تأكيده؟"
        });
      }

      await db.collection("userDevices").add({ uid, deviceId, createdAt: FieldValue.serverTimestamp() });
    }

    await userRef.update({ lastLogin: FieldValue.serverTimestamp() });
    return res.json({ success:true });

  }catch(err){
    if(err.code==="auth/id-token-expired") return res.status(401).json({ message:"انتهت الجلسة، أعد تسجيل الدخول" });
    return res.status(401).json({ message:"جلسة غير صالحة" });
  }
}
