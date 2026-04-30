import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
        // 1. التحقق من الجلسة
        const sessionRef = db.collection("linkSessions").doc(`${userId}_${linkIdx}`);
        const snap = await sessionRef.get();

        if (!snap.exists || snap.data().used) return res.status(400).json({ error: "جلسة غير صالحة أو تم استخدامها" });

        // 2. مطابقة الكود
        if (snap.data().code.toString() !== selectedCode.toString()) {
            return res.status(401).json({ error: "الرمز غير صحيح" });
        }

        // 3. جلب بيانات الرابط والنقاط من قاعدة البيانات بدلاً من المصفوفة الثابتة
        const linkDoc = await db.collection("links_data").doc(linkIdx.toString()).get();
        if (!linkDoc.exists) {
            return res.status(404).json({ error: "الرابط غير موجود في قاعدة البيانات" });
        }

        const linkData = linkDoc.data();
        const pts = linkData.points || 1.5; // استخدام النقاط المسجلة في links_data

        // 4. تنفيذ التحديث لرصيد المستخدم
        const userRef = db.collection("users").doc(userId);
        await userRef.update({
            points: FieldValue.increment(pts),
            [`lastLinks.${linkIdx}`]: FieldValue.serverTimestamp()
        });

        // 5. علامة على أن الجلسة استُخدمت
        await sessionRef.set({ used: true }, { merge: true });

        return res.status(200).json({ success: true, points: pts });
    } catch (e) {
        console.error("Server Error:", e);
        return res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
}
