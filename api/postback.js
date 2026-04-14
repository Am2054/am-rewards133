import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// تهيئة Firebase Admin بالطريقة اللي بعتها
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { console.error("Firebase Init Error:", error.message); }
}

const db = getFirestore();

export default async function handler(req, res) {
  // استقبال البيانات من MyLead
  // الرابط المتوقع: /api/postback?user_id={ml_sub1}&points={payout}&status={status}
  const { user_id, points, status } = req.query;

  // status === "1" يعني العرض اكتمل وتمت الموافقة عليه من MyLead
  if (status === "1" && user_id) {
    try {
      const userRef = db.collection('users').doc(user_id);
      
      // معادلة تحويل الأرباح لنقاط (كل 1 يورو = 1000 نقطة مثلاً)
      const earnedPoints = Math.floor(parseFloat(points) * 1000);

      if (earnedPoints > 0) {
        await userRef.update({
          referralPoints: FieldValue.increment(earnedPoints)
        });
        return res.status(200).send('OK'); // MyLead بتحتاج رد بسيط زي OK
      }
    } catch (error) {
      console.error("Database Update Error:", error);
      return res.status(500).send('Database Error');
    }
  }
  return res.status(400).send('Invalid Request');
}
