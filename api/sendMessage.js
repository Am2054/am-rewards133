import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import crypto from "crypto";

if (!getApps().length) {
    try {
        let rawKey = process.env.FIREBASE_ADMIN_KEY;
        if (rawKey) {
            const serviceAccount = JSON.parse(rawKey.trim());
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            initializeApp({
                credential: cert(serviceAccount),
                databaseURL: "https://am--rewards-default-rtdb.firebaseio.com"
            });
        }
    } catch (error) {
        console.error("Firebase Init Error:", error.message);
    }
}

const db = getDatabase();
const auth = getAuth();
const messaging = getMessaging();

// ✅ حساب الهوية كل 12 ساعة بدقة بدون أي لخبطة عند منتصف الليل
function get12HourSlot() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const second = parseInt(map.second, 10);
    const period = hour < 12 ? '0' : '1';
    const slotKey = `${map.year}${map.month}${map.day}_${period}`;

    const hoursLeft = (hour < 12 ? 11 : 23) - hour;
    const minsLeft = 59 - minute;
    const secsLeft = 60 - second;
    const nextResetTime = Date.now() + ((hoursLeft * 3600) + (minsLeft * 60) + secsLeft) * 1000;

    const hashNum = parseInt(crypto.createHash('md5').update(slotKey).digest('hex').substring(0, 6), 16);
    return { slotKey, nextResetTime, bgIndex: hashNum };
}

function generateGhostName(uid, slotKey) {
    const hash = crypto.createHash('md5').update(uid + slotKey).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16);
    const adjs = ["الغامض", "الثائر", "الهادئ", "المحارب", "العابر", "الصامت", "التائه", "المراقب", "المنسي", "الخفي"];
    const names = ["طيف", "كيان", "سراب", "ظل", "نور", "صدى", "برق", "نجم", "وهم", "شبح"];
    const name = names[index % names.length];
    const adj = adjs[(index >> 2) % adjs.length];
    const pin = (index % 9000) + 1000;
    return `${name} ${adj} #${pin}`;
}

const bannedWords = ['الإرهاب', 'تفجير', 'مخدرات', 'الرقم القومي', 'بطاقة الرقم', 'كود البنك'];
const mentalHealthKeywords = ['انتحار', 'أقتل نفسي', 'حياتي انتهت'];

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

    try {
        const { action, text, uid, token, msgId, day, reason, replyTo } = req.body;

        const decodedToken = await auth.verifyIdToken(token);
        if (decodedToken.uid !== uid) return res.status(401).json({ error: "Unauthorized" });

        const { slotKey, nextResetTime, bgIndex } = get12HourSlot();
        const serverGhostName = generateGhostName(uid, slotKey);
        const now = Date.now();
        const activeSlot = day || slotKey;

        // 🛡️ فحص الهوية الجديدة كل 12 ساعة ومسح القاعدة عند التبديل
        const lastResetRef = db.ref('system/last_reset_slot');
        const resetPromise = lastResetRef.transaction(current => {
            if (current !== slotKey) return slotKey;
            return;
        }).then(({ committed }) => {
            if (committed) {
                return Promise.all([
                    db.ref('messages/global').remove(),
                    db.ref('users_tokens').remove(),
                    db.ref('dailyCount').remove(),
                    db.ref('userLimits').remove()
                ]);
            }
        });

        // ✅ جلب الهوية بسرعة (بالتوازي مع فحص التصفير)
        if (action === "GET_IDENTITY") {
            const [, statsSnap] = await Promise.all([
                resetPromise,
                db.ref(`userStats/${uid}/totalMessages`).once('value')
            ]);
            const totalMsgs = statsSnap.val() || 0;

            let rank = "روح تائهة ☁️";
            if (totalMsgs > 50) rank = "طيف ثابت ⚡";
            if (totalMsgs > 200) rank = "حارس الظلام 🛡️";
            if (totalMsgs > 500) rank = "سيد الأشباح 💀";

            return res.status(200).json({
                ghostName: serverGhostName,
                activeDay: slotKey,
                nextResetTime,
                bgIndex,
                rank
            });
        }

        await resetPromise;

        // ✅ التعديل والحذف
        if (action === "EDIT" || action === "DELETE") {
            const msgRef = db.ref(`messages/global/${activeSlot}/${msgId}`);
            const snap = await msgRef.once("value");
            if (!snap.exists()) return res.status(404).json({ error: "الرسالة مش موجودة" });
            if (snap.val().uid !== uid) return res.status(403).json({ error: "مش مسموح" });

            if (action === "DELETE") {
                await msgRef.update({ deleted: true });
                return res.status(200).json({ success: true });
            }
            if (action === "EDIT") {
                const cleanText = (text || "").replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");
                await msgRef.update({
                    text: cleanText.replace(/^#|^\*/g, '').trim(),
                    edited: true,
                    timestamp: now
                });
                return res.status(200).json({ success: true });
            }
        }

        // ✅ الإبلاغ عن الرسائل
        if (action === "REPORT") {
            const msgRef = db.ref(`messages/global/${activeSlot}/${msgId}`);
            const snap = await msgRef.once("value");
            if (!snap.exists()) return res.status(404).json({ error: "الرسالة مش موجودة" });

            const newReports = (snap.val().reports || 0) + 1;
            await msgRef.update({
                reports: newReports,
                lastReportReason: reason,
                ...(newReports >= 3 ? { deleted: true, autoDeleted: true } : {})
            });
            return res.status(200).json({ success: true });
        }

        // ✅ منع السبام
        const userLimitRef = db.ref(`userLimits/${uid}`);
        const limitSnap = await userLimitRef.once("value");
        if (limitSnap.exists() && (now - limitSnap.val() < 3000)) {
            return res.status(429).json({ error: "استنى 3 ثواني بين كل رسالة والتانية" });
        }

        const dailyCountRef = db.ref(`dailyCount/${uid}/${slotKey}`);
        const dailySnap = await dailyCountRef.once('value');
        const count = dailySnap.exists() ? dailySnap.val() : 0;
        if (count >= 120) return res.status(429).json({ error: "وصلت للحد الأقصى للرسايل في الهوية دي" });

        // ✅ فحص النص (حد أقصى 500 حرف)
        const rawInput = (text || "").trim();
        if (!rawInput) return res.status(400).json({ error: "الرسالة فاضية" });
        if (rawInput.length > 500) return res.status(400).json({ error: "الرسالة طويلة جداً (الحد الأقصى 500 حرف)" });
        if (/(.)\1{8,}/.test(rawInput)) return res.status(400).json({ error: "بلاش تكرار حروف كتير" });

        const lowerText = rawInput.toLowerCase();
        if (bannedWords.some(w => lowerText.includes(w))) {
            return res.status(400).json({ error: "الكلام ده فيه كلمات مش مسموحة" });
        }

        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");
        const isConfession = rawInput.startsWith('#');
        const finalDisplayContent = cleanText.replace(/^#|^\*/g, '').trim();
        const hasMentalHealthIssue = mentalHealthKeywords.some(w => lowerText.includes(w));

        const msgRef = db.ref(`messages/global/${activeSlot}`).push();
        await msgRef.set({
            uid,
            sender: serverGhostName,
            text: finalDisplayContent,
            timestamp: now,
            isConfession,
            replyTo: replyTo || null,
            reports: 0
        });

        await Promise.all([
            userLimitRef.set(now),
            dailyCountRef.set(count + 1),
            db.ref(`userStats/${uid}/totalMessages`).transaction(c => (c || 0) + 1)
        ]);

        if (hasMentalHealthIssue) {
            await db.ref(`messages/global/${activeSlot}`).push().set({
                uid: "SYSTEM",
                sender: "🆘 نظام الدعم",
                text: `إحنا قلقانين عليك 💜\nلو بتمر بوقت صعب اتكلم مع حد بتثق فيه أو اطلب المساعدة المتخصصة فوراً.`,
                timestamp: now + 1,
                isSystem: true,
                type: "mentalHealth"
            });
        }

        // ✅ إرسال الإشعارات بسرعة وحذف التوكنات البايظة تلقائياً
        const tokensSnap = await db.ref('users_tokens').once('value');
        if (tokensSnap.exists()) {
            const entries = Object.entries(tokensSnap.val());
            const validTokens = [];
            const keyByToken = {};

            for (const [key, val] of entries) {
                if (val && val.token && typeof val.token === 'string' && val.token.length > 10) {
                    validTokens.push(val.token);
                    keyByToken[val.token] = key;
                }
            }

            if (validTokens.length > 0) {
                const payload = {
                    notification: {
                        title: isConfession ? `⚡ رسالة مميزة` : `👻 ${serverGhostName}`,
                        body: finalDisplayContent.substring(0, 140),
                    },
                    data: {
                        url: `https://chat-elashbah.vercel.app/ghost-chat.html`,
                    },
                    android: { priority: 'high', notification: { tag: 'ghost-chat-msg', priority: 'max' } },
                    webpush: { headers: { "Urgency": "high" }, notification: { tag: 'ghost-chat-msg' } }
                };

                for (let i = 0; i < validTokens.length; i += 500) {
                    const chunk = validTokens.slice(i, i + 500);
                    const resp = await messaging.sendEachForMulticast({ tokens: chunk, ...payload });
                    resp.responses.forEach((r, idx) => {
                        if (!r.success && r.error?.code === 'messaging/registration-token-not-registered') {
                            db.ref(`users_tokens/${keyByToken[chunk[idx]]}`).remove().catch(() => {});
                        }
                    });
                }
            }
        }

        return res.status(200).json({ success: true, ghostName: serverGhostName, activeDay: slotKey });
    } catch (error) {
        console.error('Handler Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
