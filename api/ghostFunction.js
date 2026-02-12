const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 1. التطهير الشامل اليومي (الساعة 12 منتصف الليل بتوقيت القاهرة)
exports.dailyGhostWipe = functions.pubsub.schedule('0 0 * * *')
    .timeZone('Africa/Cairo')
    .onRun(async (context) => {
        const db = admin.database();
        await db.ref('messages/global').remove();
        await db.ref('lastMessage').remove();
        await db.ref('online_users').remove();
        console.log('🕯️ تم تطهير عالم الأشباح بنجاح.');
        return null;
    });

// 2. معالج الإرسال الآمن مع Rate Limit حقيقي
exports.sendSecureMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'يجب تسجيل دخول كيانك أولاً.');
    }

    const uid = context.auth.uid;
    const { text, sender } = data;
    const now = Date.now();

    // منع السبام (3 ثوانٍ بين كل رسالة)
    const lastMsgRef = admin.database().ref(`lastMessage/${uid}`);
    const lastSnap = await lastMsgRef.once("value");
    if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
        throw new functions.https.HttpsError('resource-exhausted', 'اهدأ يا شبح.. الهمسات تحتاج وقتاً لتصل.');
    }

    // التحقق من الحظر
    const banStatus = await admin.database().ref(`banned_users/${uid}`).once('value');
    if (banStatus.exists()) {
        throw new functions.https.HttpsError('permission-denied', 'أنت منفي من هذا العالم.');
    }

    if (!text || text.length > 200) {
        throw new functions.https.HttpsError('invalid-argument', 'الرسالة طويلة جداً أو فارغة.');
    }

    // الفلترة الأمنية للنص
    const phonePattern = /(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d/g;
    const linkPattern = /(http|https|www|\.com|\.net|\.org|dot|[\s]com)/gi;
    const cleanText = text.replace(phonePattern, "[محجوب]").replace(linkPattern, "[محجوب]");

    await lastMsgRef.set(now);

    const globalMsgRef = admin.database().ref('messages/global').push();
    return globalMsgRef.set({
        uid: uid,
        sender: sender,
        text: cleanText,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        isConfession: text.startsWith('#'),
        isSecret: text.includes('سر')
    });
});
