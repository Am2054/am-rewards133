const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 1. وظيفة التطهير اليومي (Scheduled)
exports.dailyGhostWipe = functions.pubsub.schedule('0 0 * * *')
    .timeZone('Africa/Cairo')
    .onRun(async (context) => {
        // مسح المجلد العالمي بالكامل
        await admin.database().ref('messages/global').remove();
        console.log('🕯️ تم تطهير عالم الأشباح بنجاح.');
        return null;
    });

// 2. وظيفة الإرسال الآمن (Callable)
exports.sendSecureMessage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'يجب استدعاء كيانك أولاً.');
    }

    const uid = context.auth.uid;
    const { text, sender } = data;

    // التحقق من الحظر (Ban Check)
    const banStatus = await admin.database().ref(`banned_users/${uid}`).once('value');
    if (banStatus.exists()) {
        throw new functions.https.HttpsError('permission-denied', 'أنت منفي من هذا العالم.');
    }

    if (!text || text.length > 200) {
        throw new functions.https.HttpsError('invalid-argument', 'الهمسة طويلة جداً.');
    }

    // الفلترة (Sanitize)
    const phonePattern = /(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d[\s-]*\d/g;
    const linkPattern = /(http|https|www|\.com|\.net|\.org|dot|[\s]com)/gi;
    const cleanText = text.replace(phonePattern, "[محجوب]").replace(linkPattern, "[محجوب]");

    // الكتابة في المسار العالمي الجديد (Flat Structure)
    const globalMsgRef = admin.database().ref('messages/global').push();
    return globalMsgRef.set({
        uid: uid, // تخزين الـ UID للتمييز بين "أنا" والآخرين في الـ UI
        sender: sender,
        text: cleanText,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        isConfession: text.startsWith('#'),
        isSecret: text.includes('سر')
    });
});
