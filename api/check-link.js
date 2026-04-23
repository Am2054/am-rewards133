import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// دالة للتحقق من أن النص هو رابط صحيح
function isValidUrl(string) {
  try {
    const newUrl = new URL(string);
    return newUrl.protocol === 'http:' || newUrl.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

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

  const { url, userId } = req.body;
  const GOOGLE_API_KEY = process.env.SAFE_BROWSING_API_KEY;

  if (!url || !userId) return res.status(400).json({ error: "بيانات ناقصة" });
  
  // 🛡️ إضافة الفلترة هنا
  if (!isValidUrl(url)) return res.status(400).json({ error: "الرابط غير صالح، يرجى التأكد من كتابة الرابط بشكل صحيح" });

  try {
    const today = new Date().toISOString().split('T')[0];
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) return res.status(404).json({ error: "المستخدم غير موجود" });

    const userData = userDoc.data();
    
    // 🛡️ فحص إذا كان الرابط تم فصحه مسبقاً اليوم
    const lastUrl = userData.scanStats?.lastUrl || "";
    const isRepeated = (lastUrl === url && userData.scanStats?.date === today);

    let stats = userData.scanStats || { date: today, count: 0 };
    let currentPoints = userData.points || 0;

    if (stats.date !== today) { stats = { date: today, count: 0 }; }

    // لو مكرر، نرسل النتيجة فوراً بدون خصم أو زيادة عداد
    if (isRepeated) {
        const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client: { clientId: "Ahmed-Safe-Scan", clientVersion: "1.0.0" },
            threatInfo: {
                threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"],
                platformTypes: ["ANY_PLATFORM"],
                threatEntryTypes: ["URL"],
                threatEntries: [{ url: url }]
            }
          })
        });
        const data = await response.json();
        return res.status(200).json({ safe: !data.matches, isRepeated: true });
    }

    if (stats.count >= 5) return res.status(403).json({ error: "وصلت للحد الأقصى اليوم." });

    if (stats.count >= 2) {
      if (currentPoints < 2) return res.status(402).json({ error: "تحتاج لـ 2 نقطة" });
      await userRef.update({ points: FieldValue.increment(-2) });
      currentPoints -= 2; 
    }

    // فحص جوجل الفعلي
    const response = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: "Ahmed-Safe-Scan", clientVersion: "1.0.0" },
        threatInfo: {
            threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: [{ url: url }]
        }
      })
    });
    const data = await response.json();

    const newCount = stats.count + 1;
    await userRef.update({
      "scanStats.date": today,
      "scanStats.count": newCount,
      "scanStats.lastUrl": url // حفظ الرابط لمنع التكرار
    });

    return res.status(200).json({ safe: !data.matches, count: newCount, points: currentPoints });

  } catch (error) { return res.status(500).json({ error: "فشل في فحص الرابط" }); }
}
