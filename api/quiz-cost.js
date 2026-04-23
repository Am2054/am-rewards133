import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// (التهيئة كما هي...)
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { userId, level } = req.body;

  if (!userId || !level) return res.status(400).json({ error: "بيانات ناقصة" });

  const costs = {
    "easy": 0,
    "medium": 2,
    "hard": 3,
    "expert": 5
  };

  const cost = costs[level];
  if (cost === undefined) return res.status(400).json({ error: "مستوى غير صالح" });

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) return res.status(404).json({ error: "المستخدم غير موجود" });

    const userData = userDoc.data();
    const unlockedLevels = userData.unlockedLevels || [];

    // التحقق: هل المستوى مفتوح بالفعل؟
    const isUnlocked = unlockedLevels.includes(level);
    const currentPoints = userData.points || 0;

    // إذا لم يكن المستوى مفتوحاً، نتحقق من الرصيد ونخصم النقاط
    if (!isUnlocked && cost > 0) {
      if (currentPoints < cost) {
        return res.status(402).json({ error: `رصيدك غير كافٍ. تحتاج إلى ${cost} نقطة.` });
      }

      // خصم النقاط وإضافة المستوى لقائمة المفتوحين
      await userRef.update({
        points: FieldValue.increment(-cost),
        unlockedLevels: FieldValue.arrayUnion(level)
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: isUnlocked ? "تم الدخول للمستوى (مفتوح مسبقاً)" : "تم خصم النقاط وفتح المستوى بنجاح", 
      newPoints: isUnlocked ? currentPoints : currentPoints - cost 
    });

  } catch (error) {
    return res.status(500).json({ error: "حدث خطأ أثناء معالجة العملية" });
  }
}
