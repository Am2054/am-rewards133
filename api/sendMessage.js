const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: "am--rewards",
            // ملاحظة: يفضل وضع هذه البيانات في Vercel Environment Variables
            clientEmail: "firebase-adminsdk-xxxxx@am--rewards.iam.gserviceaccount.com",
            privateKey: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n".replace(/\\n/g, '\n')
        }),
        databaseURL: "https://am--rewards-default-rtdb.firebaseio.com"
    });
}

const db = admin.database();

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { text, sender, uid, token } = req.body;

    try {
        // التحقق من هوية المرسل (Security Check)
        const decodedToken = await admin.auth().verifyIdToken(token);
        if (decodedToken.uid !== uid) throw new Error("Unauthenticated");

        // 1. نظام الـ Rate Limit الحقيقي (3 ثواني)
        const now = Date.now();
        const lastMsgRef = db.ref(`lastMessage/${uid}`);
        const lastSnap = await lastMsgRef.once("value");
        if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
            return res.status(429).json({ error: 'اهدأ يا شبح.. الهمسات تحتاج وقتاً.' });
        }

        // 2. التحقق من الحظر
        const banSnap = await db.ref(`banned_users/${uid}`).once('value');
        if (banSnap.exists()) return res.status(403).json({ error: 'أنت منفي من هذا العالم.' });

        // 3. فلترة النص (الروابط والأرقام)
        const phonePattern = /(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d/g;
        const linkPattern = /(http|https|www|\.com|\.net|\.org|dot|[\s]com)/gi;
        const cleanText = text.replace(phonePattern, "[محجوب]").replace(linkPattern, "[محجوب]");

        // 4. الكتابة في المسار العالمي
        const globalMsgRef = db.ref('messages/global').push();
        await globalMsgRef.set({
            uid,
            sender,
            text: cleanText,
            timestamp: admin.database.ServerValue.TIMESTAMP,
            isConfession: text.startsWith('#'),
            isSecret: text.includes('سر')
        });

        // تحديث وقت آخر رسالة
        await lastMsgRef.set(now);
        
        return res.status(200).json({ success: true });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}
