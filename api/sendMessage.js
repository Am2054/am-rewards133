// /api/sendMessage.js - التطهير الشامل ومنع التتبع كل 12 ساعة
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
        console.error("❌ Firebase Init Error:", error.message); 
    }
}

const db = getDatabase();
const auth = getAuth();
const messaging = getMessaging();

function getCairo12hPeriod() {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const map = {};
    parts.forEach(p => map[p.type] = p.value);
    const hour = parseInt(map.hour, 10);
    const period = hour < 12 ? 'AM' : 'PM';
    const dateKey = `${map.year}${map.month}${map.day}`;
    return { activePeriod: `${dateKey}_${period}`, dateKey, period, hour };
}

function generate12hGhostName(uid, activePeriod) {
    const hash = crypto.createHash('md5').update(uid + activePeriod).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16);
    const adjs = ["الغامض", "الثائر", "الهادئ", "المحارب", "العابر", "الصامت", "التائه", "المراقب", "المنسي", "الخفي", "الحالم", "الحكيم"];
    const names = ["طيف", "كيان", "سراب", "ظل", "نور", "صدى", "برق", "نجم", "وهم", "شبح", "ندى", "فجر"];
    const name = names[index % names.length];
    const adj = adjs[(index >> 2) % adjs.length];
    const pin = (index % 9000) + 1000;
    return `${name} ${adj} #${pin}`;
}

const bannedWords = ['الإرهاب', 'تفجير', 'مخدرات', 'الرقم القومي', 'بطاقة الرقم', 'كود البنك'];
const mentalHealthKeywords = ['انتحار', 'أقتل نفسي', 'حياتي انتهت'];

function isContentBanned(text) {
    const lower = text.toLowerCase();
    return bannedWords.some(w => lower.includes(w));
}

function hasMentalHealthKeywords(text) {
    const lower = text.toLowerCase();
    return mentalHealthKeywords.some(w => lower.includes(w));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();      
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });      

    try {      
        const { action, text, uid, token, msgId, period, day, reason } = req.body;   
        
        if (!token || !uid) {
            return res.status(401).json({ error: "مطلوب تسجيل الدخول" });
        }

        try {
            const decodedToken = await auth.verifyIdToken(token);      
            if (decodedToken.uid !== uid) {
                return res.status(403).json({ error: "معرّف غير متطابق" });
            }
        } catch (e) {
            return res.status(401).json({ error: "جلسة العمل منتهية" });
        }

        const now = Date.now();    
        const periodInfo = getCairo12hPeriod();  
        const currentActivePeriod = period || day || periodInfo.activePeriod;  
        const serverGhostName = generate12hGhostName(uid, currentActivePeriod);

        // 🛡️ فحص تجدد دورة الـ 12 ساعة + التطهير الكامل (THE GREAT PURGE)
        const lastResetRef = db.ref('system/last_12h_period');    
        let isNewSession = false;  
        const { committed } = await lastResetRef.transaction(current => {  
            if (current !== periodInfo.activePeriod) return periodInfo.activePeriod;  
            return;   
        });  

        if (committed) {    
            isNewSession = true;
            // 1. إرسال الإشعار لجميع الأجهزة أولاً قبل الحذف
            try {
                const tokensSnap = await db.ref('users_tokens').once('value');
                if (tokensSnap.exists()) {
                    const tokensData = tokensSnap.val();
                    const allTokens = Object.values(tokensData)
                        .map(u => u && u.token)
                        .filter(t => typeof t === 'string' && t.length > 20);

                    if (allTokens.length > 0) {
                        const resetPayload = {
                            notification: {
                                title: "✨ التطهير الشامل.. تجلّت الأرواح!",
                                body: "تم محو همسات الدورة السابقة بالكامل. وُلدت بهوية جديدة في الظلام!",
                            },
                            data: { url: "https://am-property.vercel.app/ghost-chat.html" }
                        };
                        for (let i = 0; i < allTokens.length; i += 500) {
                            await messaging.sendEachForMulticast({ tokens: allTokens.slice(i, i + 500), ...resetPayload }).catch(() => {});
                        }
                    }
                }
            } catch (err) {}

            // 2. 🧹 مسح كل شيء من قاعدة البيانات لتوفير الاستهلاك ومنع أي تتبع
            await Promise.allSettled([
                db.ref('messages/global').remove(),      // حذف كل الرسائل السابقة 100%
                db.ref('userLimits').remove(),           // تصفير مؤقتات السبام
                db.ref('periodCount').remove(),          // تصفير عدادات الرسائل
                db.ref('user_strikes').remove(),         // تصفير البلاغات السابقة
                db.ref('banned_users').remove(),         // فك تجميد الجميع لبداية بيضاء
                db.ref('users_tokens').remove()          // حذف كل التوكنات لمنع التتبع (يتم إعادة تسجيلها عند الفتح)
            ]);
            console.log("🧹 The Great 12h Purge executed successfully!");
        }    

        // ❄️ فحص التجميد الفعلي للدورة الحالية
        const banRef = db.ref(`banned_users/${uid}`);
        const banSnap = await banRef.once('value');
        if (banSnap.exists()) {
            const banData = banSnap.val();
            if (banData.bannedUntil && banData.bannedUntil > now) {
                const remainingMinutes = Math.ceil((banData.bannedUntil - now) / 60000);
                return res.status(403).json({ 
                    error: `طيفك مجمد ومحظور من الهمس لمدة ${remainingMinutes} دقيقة بسبب مخالفة ميثاق الأشباح ❄️` 
                });
            }
        }

        // ✅ التعديل والحذف
        if (action === "EDIT" || action === "DELETE") {    
            const msgRef = db.ref(`messages/global/${currentActivePeriod}/${msgId}`);    
            const snap = await msgRef.once("value");    
            if (!snap.exists()) return res.status(404).json({ error: "NotFound" });    
            if (snap.val().uid !== uid) return res.status(403).json({ error: "Forbidden" });    

            if (action === "DELETE") {    
                await msgRef.update({ deleted: true });    
                return res.status(200).json({ success: true });    
            }    
            if (action === "EDIT") {  
                const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");    
                await msgRef.update({ text: cleanText.replace(/^#|^\*/g, '').trim(), edited: true, timestamp: now });    
                return res.status(200).json({ success: true });    
            }    
        }    

        // ✅ الحصول على الهوية
        if (action === "GET_IDENTITY") {    
            const statsRef = db.ref(`userStats/${uid}/totalMessages`);  
            const statsSnap = await statsRef.once('value');  
            const totalMsgs = statsSnap.val() || 0;  
              
            let rank = "روح تائهة ☁️";  
            if (totalMsgs > 50) rank = "طيف ثابت 🕯️";  
            if (totalMsgs > 200) rank = "حارس الظلام 🛡️";  
            if (totalMsgs > 500) rank = "سيد الأشباح 💀";  

            return res.status(200).json({   
                ghostName: serverGhostName,  
                activePeriod: periodInfo.activePeriod,   
                activeDay: periodInfo.activePeriod,
                rank: rank,  
                welcomeCard: {  
                    show: isNewSession,  
                    title: "تجلّي جديد.. روح جديدة 🕯️",  
                    message: `تم محو همسات الدورة السابقة بالكامل. رتبتك الحالية: ${rank}`,  
                }  
            });    
        }    

        // 🚨 الإبلاغ والحظر
        if (action === "REPORT") {
            const msgRef = db.ref(`messages/global/${currentActivePeriod}/${msgId}`);
            const snap = await msgRef.once("value");
            if (!snap.exists()) return res.status(404).json({ error: "Message not found" });

            const msgData = snap.val();
            const newReports = (msgData.reports || 0) + 1;
            await msgRef.update({ reports: newReports, lastReportReason: reason || "inappropriate" });

            if (newReports >= 3) {
                await msgRef.update({ deleted: true, autoDeleted: true });
                
                const offenderUid = msgData.uid;
                if (offenderUid) {
                    const strikesRef = db.ref(`user_strikes/${offenderUid}`);
                    const strikeSnap = await strikesRef.once('value');
                    const strikes = (strikeSnap.val() || 0) + 1;
                    await strikesRef.set(strikes);

                    if (strikes >= 2) {
                        await db.ref(`banned_users/${offenderUid}`).set({
                            bannedUntil: now + (6 * 60 * 60 * 1000),
                            reason: "محتوى مخالف متكرر"
                        });
                    }
                }
            }

            return res.status(200).json({ success: true, message: "تم تسجيل البلاغ" });
        }

        // سبام ليميت
        const userLimitRef = db.ref(`userLimits/${uid}`);      
        const limitSnap = await userLimitRef.once("value");      
        if (limitSnap.exists() && (now - limitSnap.val() < 2000)) {   
            return res.status(429).json({ error: "مهلاً.. انتظر ثانيتين بين كل همسة" });  
        }  

        const dailyCountRef = db.ref(`periodCount/${uid}/${periodInfo.activePeriod}`);  
        const dailySnap = await dailyCountRef.once('value');  
        const count = dailySnap.exists() ? dailySnap.val() : 0;  
        if (count >= 120) return res.status(429).json({ error: "بلغت الحد الأقصى لهمسات هذه الفترة (120)" });  

        const rawInput = (text || "").trim();  
        if (rawInput.length > 300) return res.status(400).json({ error: "الهمسة طويلة جداً" });  
        if (/(.)\1{7,}/.test(rawInput)) return res.status(400).json({ error: "توقف عن تكرار الحروف!" });  

        if (isContentBanned(rawInput)) {
            return res.status(400).json({ error: "تحتوي الهمسة على كلمات محظورة" });
        }

        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");      
        const isConfession = rawInput.startsWith('#');      
        let finalDisplayContent = cleanText.replace(/^#|^\*/g, '').trim();  

        const msgRef = db.ref(`messages/global/${currentActivePeriod}`).push();      
        await msgRef.set({ uid, sender: serverGhostName, text: finalDisplayContent, timestamp: now, isConfession, reports: 0 });      
          
        await userLimitRef.set(now);     
        await dailyCountRef.set(count + 1);  
        await db.ref(`userStats/${uid}/totalMessages`).transaction(c => (c || 0) + 1);  

        if (hasMentalHealthKeywords(finalDisplayContent)) {
            const systemMsgRef = db.ref(`messages/global/${currentActivePeriod}`).push();
            await systemMsgRef.set({
                uid: "SYSTEM", sender: "🆘 نظام الدعم", text: `نحن نهتم لأمرك 💜\nإذا كنت تمر بظرف صعب: 08008880700`, timestamp: now + 1, isSystem: true, type: "mentalHealth"
            });
        }

        // 🔔 إرسال الإشعار
        try {      
            const tokensSnap = await db.ref('users_tokens').once('value');      
            if (tokensSnap.exists()) {      
                const tokensData = tokensSnap.val();
                let targetTokens = [];
                
                Object.entries(tokensData).forEach(([userKey, val]) => {
                    if (userKey !== uid && val && val.token && typeof val.token === 'string' && val.token.length > 20) {
                        targetTokens.push(val.token);
                    }
                });

                if (targetTokens.length > 0) {      
                    const pushPayload = {      
                        notification: {      
                            title: isConfession ? `🕯️ اعتراف في الظلام` : `👻 همسة من ${serverGhostName}`,      
                            body: finalDisplayContent.substring(0, 120),
                        },      
                        data: { url: `https://am-property.vercel.app/ghost-chat.html` }
                    };      
                    
                    for (let i = 0; i < targetTokens.length; i += 500) {
                        messaging.sendEachForMulticast({ tokens: targetTokens.slice(i, i + 500), ...pushPayload }).catch(() => {});
                    }
                }      
            }      
        } catch (e) {}      

        return res.status(200).json({ success: true, ghostName: serverGhostName, activePeriod: currentActivePeriod });      
    } catch (error) { 
        return res.status(500).json({ error: error.message }); 
    }
}
