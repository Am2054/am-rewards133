import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// تهيئة Firebase Admin
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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { userId, linkIdx, selectedCode } = req.body;
    if (!userId || linkIdx === undefined || !selectedCode) return res.status(400).json({ error: "بيانات ناقصة" });

    try {
        const sessionRef = db.collection("linkSessions").doc(`${userId}_${linkIdx}`);
        const snap = await getDoc(sessionRef);

        if (!snap.exists() || snap.data().used) return res.status(400).json({ error: "جلسة غير صالحة أو تم استخدامها" });

        if (snap.data().code !== selectedCode.toString()) {
            return res.status(401).json({ error: "الرمز غير صحيح" });
        }

        // تحديد النقاط (يجب أن تكون متطابقة مع مصفوفة shortlinks في الفرونت)
        const pointsMap = { 0: 2.5, 1: 1.5, 2: 1.5, 3: 2.5, 4: 1.5, 5: 1.5, 6: 4, 7: 1.5, 8: 1.5, 9: 2.5, 10: 1.5, 12: 1.5, 13: 4, 14: 2.5 };
        const pts = pointsMap[linkIdx] || 1.5;

        // تنفيذ العمليات في Batch للضمان
        const userRef = db.collection("users").doc(userId);
        await userRef.update({
            points: increment(pts),
            [`lastLinks.${linkIdx}`]: serverTimestamp()
        });

        await sessionRef.set({ used: true }, { merge: true });

        return res.status(200).json({ success: true, points: pts });
    } catch (e) {
        return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
}
