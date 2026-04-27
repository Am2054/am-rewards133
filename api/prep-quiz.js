// /api/prep-quiz.js - المعالج المحسّن
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) {
    console.error("Firebase Init Error:", e.message);
  }
}

const db = getFirestore();

// 🎓 معالج اختبارات "حضر نفسك" - محسّن
async function handleQuizCost(req, res) {
  const { userId, level } = req.body;

  if (!userId || !level) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }

  const costs = {
    "easy": 0,
    "medium": 0,
    "hard": 3,
    "expert": 5
  };

  const cost = costs[level];
  if (cost === undefined) {
    return res.status(400).json({ error: "مستوى غير صالح" });
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    const userData = userDoc.data();
    const unlockedLevels = userData.unlockedLevels || [];
    const isUnlocked = unlockedLevels.includes(level);
    const currentPoints = userData.points || 0;

    console.log(`📊 المستخدم: ${userId}, المستوى: ${level}, النقاط الحالية: ${currentPoints}, التكلفة: ${cost}`);

    // ✅ إذا لم يكن المستوى مفتوحاً وفيه تكلفة
    if (!isUnlocked && cost > 0) {
      if (currentPoints < cost) {
        return res.status(402).json({ 
          error: `رصيدك غير كافٍ. تحتاج إلى ${cost} نقطة، لديك ${currentPoints}.` 
        });
      }

      console.log(`💰 خصم ${cost} نقطة من ${currentPoints}`);

      // ✅ خصم النقاط
      await userRef.update({
        points: FieldValue.increment(-cost),
        unlockedLevels: FieldValue.arrayUnion(level),
        lastQuizCost: {
          level: level,
          cost: cost,
          timestamp: new Date().toISOString()
        }
      });

      const newPoints = currentPoints - cost;
      console.log(`✅ تم الخصم بنجاح. النقاط الجديدة: ${newPoints}`);

      return res.status(200).json({
        success: true,
        message: "تم فتح المستوى بنجاح",
        newPoints: newPoints,
        cost: cost,
        charged: true
      });
    }

    // ✅ المستوى مفتوح بالفعل أو مجاني
    return res.status(200).json({
      success: true,
      message: isUnlocked ? "المستوى مفتوح مسبقاً" : "المستوى مجاني",
      isUnlocked: isUnlocked,
      currentPoints: currentPoints,
      charged: false
    });

  } catch (error) {
    console.error("❌ Quiz Error:", error);
    return res.status(500).json({ error: "حدث خطأ في معالجة الطلب" });
  }
}

// 🔍 معالج فحص الروابط
async function handleLinkCheck(req, res) {
  const { url, userId } = req.body;
  const GOOGLE_API_KEY = process.env.SAFE_BROWSING_API_KEY;

  if (!url || !userId) {
    return res.status(400).json({ error: "بيانات ناقصة" });
  }

  function isValidUrl(string) {
    try {
      const newUrl = new URL(string);
      return newUrl.protocol === 'http:' || newUrl.protocol === 'https:';
    } catch (err) {
      return false;
    }
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ 
      error: "الرابط غير صالح، يرجى التأكد من كتابة الرابط بشكل صحيح (https://...)" 
    });
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "المستخدم غير موجود" });
    }

    const userData = userDoc.data();

    // ✅ التحقق من الرابط المكرر
    const lastUrl = userData.scanStats?.lastUrl || "";
    const isRepeated = (lastUrl === url && userData.scanStats?.date === today);

    let stats = userData.scanStats || { date: today, count: 0 };
    let currentPoints = userData.points || 0;

    if (stats.date !== today) {
      stats = { date: today, count: 0 };
    }

    console.log(`📊 الفحص: ${url}, المحاولة: ${stats.count + 1}, النقاط: ${currentPoints}, مكرر: ${isRepeated}`);

    // 🔄 إذا كان مكرراً، أرسل النتيجة بدون خصم
    if (isRepeated) {
      try {
        const response = await fetch(
          `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`,
          {
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
          }
        );
        const data = await response.json();
        return res.status(200).json({ 
          safe: !data.matches, 
          isRepeated: true,
          message: "تم فحص هذا الرابط مسبقاً - لم يتم خصم نقاط"
        });
      } catch (err) {
        console.error("Google Safe Browsing Error:", err);
        return res.status(503).json({ error: "خدمة الفحص غير متاحة حالياً" });
      }
    }

    // ✅ التحقق من الحد الأقصى
    if (stats.count >= 5) {
      return res.status(403).json({ 
        error: "وصلت للحد الأقصى (5) محاولات اليوم." 
      });
    }

    // ✅ خصم نقاط إذا تجاوزت المحاولات المجانية
    let costCharged = 0;
    if (stats.count >= 2 && stats.count < 5) {
      if (currentPoints < 2) {
        return res.status(402).json({ 
          error: "تحتاج إلى 2 نقطة لمتابعة الفحص" 
        });
      }

      console.log(`💰 خصم 2 نقطة من ${currentPoints}`);

      await userRef.update({ points: FieldValue.increment(-2) });
      currentPoints -= 2;
      costCharged = 2;
    }

    // 🔍 فحص جوجل Safe Browsing
    try {
      const response = await fetch(
        `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`,
        {
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
        }
      );
      const data = await response.json();

      // ✅ تحديث إحصائيات المستخدم
      const newCount = stats.count + 1;
      await userRef.update({
        "scanStats.date": today,
        "scanStats.count": newCount,
        "scanStats.lastUrl": url,
        "scanStats.lastCheck": new Date().toISOString()
      });

      let threatType = "آمن تماماً ✅";
      if (data.matches && data.matches.length > 0) {
        const threats = data.matches[0].threatType;
        if (threats.includes("MALWARE")) threatType = "🚨 برنامج ضار";
        else if (threats.includes("SOCIAL_ENGINEERING")) threatType = "⚠️ محتال/انتحال";
        else if (threats.includes("UNWANTED_SOFTWARE")) threatType = "⚠️ برنامج غير مرغوب";
        else threatType = "⚠️ تهديد محتمل";
      }

      console.log(`✅ فحص كامل: ${threatType}`);

      return res.status(200).json({
        success: true,
        safe: !data.matches,
        threatType: threatType,
        count: newCount,
        points: currentPoints,
        isFree: stats.count < 2,
        charged: costCharged,
        message: stats.count >= 2 ? `تم خصم ${costCharged} نقطة من رصيدك` : "فحص مجاني"
      });
    } catch (err) {
      console.error("Google Safe Browsing API Error:", err);
      return res.status(503).json({ 
        error: "خدمة الفحص غير متاحة حالياً. حاول لاحقاً." 
      });
    }

  } catch (error) {
    console.error("❌ Link Check Error:", error);
    return res.status(500).json({ error: "فشل في فحص الرابط" });
  }
}

// 🔀 الموجّه الرئيسي
export default async function handler(req, res) {
  // ✅ CORS Headers
  res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action } = req.body;

  try {
    if (action === 'quiz-cost') {
      return handleQuizCost(req, res);
    } else if (action === 'check-link') {
      return handleLinkCheck(req, res);
    } else if (!action && req.body.level && req.body.userId) {
      // للتوافق مع الطلب القديم
      return handleQuizCost(req, res);
    } else if (!action && req.body.url && req.body.userId) {
      // للتوافق مع الطلب القديم
      req.body.action = 'check-link';
      return handleLinkCheck(req, res);
    }

    return res.status(400).json({ error: "طلب غير صحيح" });
  } catch (err) {
    console.error("❌ Server Error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
    }
