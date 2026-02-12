import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: "am--rewards",
            clientEmail: "firebase-adminsdk-xxxxx@am--rewards.iam.gserviceaccount.com", // ضع ايميلك هنا
            privateKey: "-----BEGIN PRIVATE KEY-----\nإنسخ مفتاحك هنا بالكامل\n-----END PRIVATE KEY-----\n".replace(/\\n/g, '\n')
        }),
        databaseURL: "https://am--rewards-default-rtdb.firebaseio.com"
    });
}

const db = admin.database();

export default async function handler(req, res) {
    // إعدادات CORS للسماح بالطلبات الخارجية
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { text, sender, uid, token } = req.body;

        // التحقق من التوكين للأمان
        const decodedToken = await admin.auth().verifyIdToken(token);
        if (decodedToken.uid !== uid) {
            throw new Error("Unauthorized access");
        }

        // نظام الحماية من السبام (3 ثواني)
        const now = Date.now();
        const lastMsgRef = db.ref(`lastMessage/${uid}`);
        const lastSnap = await lastMsgRef.once("value");
        
        if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
            return res.status(429).json({ error: 'اهدأ قليلاً يا شبح.. الهمسات تحتاج وقتاً.' });
        }

        // تنظيف النص من الأرقام والروابط
        const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");

        // كتابة الرسالة في قاعدة البيانات
        const msgRef = db.ref('messages/global').push();
        await msgRef.set({
            uid: uid,
            sender: sender,
            text: cleanText,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            isConfession: text.startsWith('#'),
            isSecret: text.includes('سر')
        });

        // تحديث وقت آخر رسالة للمستخدم
        await lastMsgRef.set(now);

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Server Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
}
