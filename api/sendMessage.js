// api/sendMessage.js - Backend المعدّل بالكامل مع كل الحماية

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
                serviceAccount.private_key = serviceAccount.private_key.replace(/\n/g, '\n');
            }
            initializeApp({
                credential: cert(serviceAccount),
                databaseURL: "https://am--rewards-default-rtdb.firebaseio.com"
            });
        }
    } catch (error) { console.error("Firebase Init Error:", error.message); }
}

const db = getDatabase();
const auth = getAuth();
const messaging = getMessaging();

function getFormattedDate() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date()).replace(/-/g, '');
}

function generateDailyGhostName(uid) {
    const egyptDate = getFormattedDate();
    const hash = crypto.createHash('md5').update(uid + egyptDate).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16);
    const adjs = ["الغامض", "الثائر", "الهادئ", "المحارب", "العابر", "الصامت", "التائه", "المراقب", "المنسي", "الخفي"];
    const names = ["طيف", "كيان", "سراب", "ظل", "نور", "صدى", "برق", "نجم", "وهم", "شبح"];
    const name = names[index % names.length];
    const adj = adjs[(index >> 2) % adjs.length];
    const pin = (index % 9000) + 1000;
    return `${name} ${adj} #${pin}`;
}

// 🛡️ نظام الكلمات المحظورة
const bannedWords = [
    'الإرهاب', 'تفجير', 'مخدرات', 'بيع',
    'الرقم القومي', 'بطاقة الرقم', 'كود البنك',
    'رابط', 'http', 'https', '.com',
    'تمويل الإرهاب', 'قمار', 'خمر',
    'انتحار', 'أقتل نفسي', 'سم', 'حبال',
    // كلمات عنصرية وطائفية
    'عنصري', 'طائفة', 'كافر', 'مرتد',
];

const mentalHealthKeywords = [
    'انتحار', 'موت', 'أقتل نفسي', 'حياتي انتهت',
    'لا أستطيع', 'يأس', 'اكتئاب شديد', 'وحيد'
];

const mentalHealthResources = {
    egypt: {
        name: "الاتحاد القومي للصحة النفسية",
        phone: "+20100123456",
        website: "https://example.com"
    },
    international: {
        name: "International Association for Suicide Prevention",
        website: "https://www.iasp.info/resources/Crisis_Centres/"
    }
};

function isContentBanned(text) {
    const lowerText = text.toLowerCase();
    return bannedWords.some(word => lowerText.includes(word));
}

function hasMentalHealthKeywords(text) {
    const lowerText = text.toLowerCase();
    return mentalHealthKeywords.some(word => lowerText.includes(word));
}

function filterContent(text) {
    let filtered = text;
    bannedWords.forEach(word => {
        const regex = new RegExp(word, 'gi');
        filtered = filtered.replace(regex, '[محجوب]');
    });
    return filtered;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();      
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });      

    try {      
        const { action, text, uid, token, msgId, day, reason } = req.body;   
        const decodedToken = await auth.verifyIdToken(token);      
        if (decodedToken.uid !== uid) throw new Error("Unauthorized");      

        const serverGhostName = generateDailyGhostName(uid);    
        const now = Date.now();    
        const todayDateFormatted = getFormattedDate();  
        const activeDay = day || todayDateFormatted;  

        // 🛡️ فحص اليوم الجديد (نظام التطهير اليومي) باستخدام Transaction  
        const lastResetRef = db.ref('system/last_reset_date');    
        const todayDateString = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });    
          
        let isNewSession = false;  
        const { committed } = await lastResetRef.transaction(current => {  
            if (current !== todayDateString) return todayDateString;  
            return;   
        });  

        if (committed) {    
            await db.ref('messages/global').remove();  
            isNewSession = true;   
        }    

        // منطق التعديل والحذف  
        if (action === "EDIT" || action === "DELETE") {    
            const msgRef = db.ref(`messages/global/${activeDay}/${msgId}`);    
            const snap = await msgRef.once("value");    
            if (!snap.exists()) return res.status(404).json({ error: "NotFound" });    
            if (snap.val().uid !== uid) return res.status(403).json({ error: "Forbidden" });    

            if (action === "DELETE") {    
                await msgRef.update({ deleted: true });    
                return res.status(200).json({ success: true });    
            }    
            if (action === "EDIT") {  
                const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");    
                await msgRef.update({     
                    text: cleanText.replace(/#اعتراف|#سر|سر|^#|^\*/g, '').trim(),     
                    edited: true,    
                    timestamp: now     
                });    
                return res.status(200).json({ success: true });    
            }    
        }    

        // 🌕 استجابة الهوية + الرتب الشبحية
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
                activeDay: todayDateFormatted,   
                rank: rank,  
                welcomeCard: {  
                    show: isNewSession,  
                    title: "تجلّي جديد.. روح جديدة 🕯️",  
                    message: `لقد تلاشت أرواح الأمس. رتبتك الحالية: ${rank}`,  
                    nameTag: serverGhostName,  
                    accentColor: "#7000ff",  
                    footer: "كل شيء هنا عابر.. إلا الأثر."  
                }  
            });    
        }    

        // 🚫 التقرير/البلاغ على الرسائل
        if (action === "REPORT") {
            const msgRef = db.ref(`messages/global/${activeDay}/${msgId}`);
            const snap = await msgRef.once("value");
            if (!snap.exists()) return res.status(404).json({ error: "Message not found" });

            await msgRef.update({
                reports: (snap.val().reports || 0) + 1,
                lastReportReason: reason
            });

            // إذا وصلت التقارير ل 3 = حذف تلقائي
            if ((snap.val().reports || 0) + 1 >= 3) {
                await msgRef.update({ deleted: true, autoDeleted: true });
            }

            return res.status(200).json({ success: true, message: "تم التقرير بنجاح" });
        }

        // حماية السبام والحد اليومي  
        const userLimitRef = db.ref(`userLimits/${uid}`);      
        const limitSnap = await userLimitRef.once("value");      
        if (limitSnap.exists() && (now - limitSnap.val() < 5000)) {   
            return res.status(429).json({ error: "السرعة قتلت الشبح.. انتظر قليلاً." });  
        }  

        const dailyCountRef = db.ref(`dailyCount/${uid}/${todayDateFormatted}`);  
        const dailySnap = await dailyCountRef.once('value');  
        const count = dailySnap.exists() ? dailySnap.val() : 0;  
        if (count >= 100) return res.status(429).json({ error: "بلغت الحد اليومي للهمسات (100)." });  

        // معالجة النص وتنظيفه  
        const rawInput = (text || "").trim();  
        if (rawInput.length > 300) return res.status(400).json({ error: "الهمسة طويلة جداً" });  
        if (/(.)\1{7,}/.test(rawInput)) return res.status(400).json({ error: "توقف عن الضجيج!" });  

        // 🛡️ فحص المحتوى المحظور
        if (isContentBanned(rawInput)) {
            return res.status(400).json({ 
                error: "المحتوى يحتوي على كلمات غير مسموحة",
                hint: "تذكر: نحن هنا لننشر الحب لا الكراهية 💜"
            });
        }

        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");      
        const isConfession = rawInput.startsWith('#') || rawInput.includes('#اعتراف');      
        const isSecret = rawInput.startsWith('*') || rawInput.includes('#سر');      
            
        let finalDisplayContent = cleanText.replace(/^#|^\*|#اعتراف|#سر|سر/g, '').trim();  

        // 🆘 فحص الكلمات المتعلقة بالصحة النفسية
        let hasMentalHealthIssue = false;
        if (hasMentalHealthKeywords(finalDisplayContent)) {
            hasMentalHealthIssue = true;
            // سيتم إضافة رسالة نظام تلقائية
        }

        // منطق الردود للإشعارات  
        const replyMatch = finalDisplayContent.match(/^رد على @(.+?):/);      
        const replyToName = replyMatch ? replyMatch[1].trim() : null;      

        // 🆑 تحقق من آخر اعتراف للمستخدم (Cooldown للاعترافات)
        if (isConfession) {
            const lastConfessionRef = db.ref(`lastConfession/${uid}`);
            const lastConfSnap = await lastConfessionRef.once('value');
            if (lastConfSnap.exists() && (now - lastConfSnap.val() < 60000)) { // دقيقة واحدة
                return res.status(429).json({ 
                    error: "استرح شوي قبل ما تعترف ثاني 🕯️",
                    waitTime: Math.ceil((60000 - (now - lastConfSnap.val())) / 1000)
                });
            }
            await lastConfessionRef.set(now);
        }

        // 📝 إرسال الرسالة + تحديث إحصائيات الرتبة  
        const msgRef = db.ref(`messages/global/${activeDay}`).push();      
        await msgRef.set({     
            uid, 
            sender: serverGhostName, 
            text: finalDisplayContent,     
            timestamp: now, 
            isConfession, 
            isSecret,
            reports: 0, // نظام التقارير
            hasMentalHealthIssue: hasMentalHealthIssue, // ✨ علامة الصحة النفسية
            reactions: { // ✨ نظام التقييم
                good: 0,
                bad: 0
            }
        });      
          
        await userLimitRef.set(now);     
        await dailyCountRef.set(count + 1);  
        await db.ref(`userStats/${uid}/totalMessages`).transaction(c => (c || 0) + 1);  

        // 🆘 إذا كانت رسالة حول الصحة النفسية = أضف رسالة نظام
        if (hasMentalHealthIssue) {
            const systemMsgRef = db.ref(`messages/global/${activeDay}`).push();
            await systemMsgRef.set({
                uid: "SYSTEM",
                sender: "🆘 نظام الدعم",
                text: `نحن نقلق عليك 💜\n\nإذا كنت تمر بوقت عصيب:\n📞 مصر: ${mentalHealthResources.egypt.phone}\n🌍 عالمياً: ${mentalHealthResources.international.website}`,
                timestamp: now + 1,
                isSystem: true,
                type: "mentalHealth"
            });
        }

        // 🔔 نظام الإشعارات المتكامل (Push Notifications) - محسّن للسرعة
        try {      
            const tokensSnap = await db.ref('users_tokens').once('value');      
            if (tokensSnap.exists()) {      
                const tokensData = tokensSnap.val();      
                const myTokenSnap = await db.ref(`users_tokens/${uid}/token`).once('value');  
                const myToken = myTokenSnap.val();  

                let targetTokens = [];      
                if (replyToName) {      
                    const targetUser = Object.values(tokensData).find(u => u.ghostName === replyToName);      
                    if (targetUser && targetUser.token) targetTokens = [targetUser.token];      
                } else {      
                    targetTokens = Object.values(tokensData)    
                        .map(u => u.token)    
                        .filter(t => typeof t === 'string' && t.length > 10 && t !== myToken);      
                }      

                if (targetTokens.length > 0) {      
                    // ✨ التحسين: عرض الرسالة كاملة مع الاسم
                    const payload = {      
                        notification: {      
                            title: replyToName ? `💬 ${serverGhostName} رد عليك` : (isConfession ? `🕯️ اعتراف جديد` : `👻 ${serverGhostName}`),      
                            // ✨ الرسالة كاملة بدل آخر 50 حرف
                            body: finalDisplayContent,
                        },      
                        data: {   
                            url: `https://am-rewards.vercel.app/ghost-chat.html?msgId=${msgRef.key}`,
                            ghostName: serverGhostName,
                            timestamp: String(now),
                            fullMessage: finalDisplayContent, // ✨ الرسالة كاملة
                            senderName: serverGhostName // ✨ اسم المُرسل
                        },  
                        android: {   
                            priority: 'high',   
                            ttl: 0,   
                            notification: { 
                                tag: 'ghost-chat-msg', 
                                priority: 'max', 
                                visibility: 'public',
                                sound: 'default'
                            }   
                        },  
                        webpush: {   
                            headers: { "Urgency": "high", "TTL": "0" },   
                            notification: { 
                                tag: 'ghost-chat-msg', 
                                renotify: true,
                                badge: '/badge-icon.png'
                            }   
                        }  
                    };      
                    
                    // ✨ الحل الأساسي: أرسل الإشعارات بالتوازي
                    const chunks = [];
                    for (let i = 0; i < targetTokens.length; i += 500) {
                        chunks.push(targetTokens.slice(i, i + 500));
                    }
                    
                    // أرسل جميع البلوكات في نفس الوقت بدل الانتظار بينهم
                    await Promise.all(chunks.map(chunk =>
                        messaging.sendEachForMulticast({ tokens: chunk, ...payload })
                            .catch(err => console.error('Multicast chunk error:', err))
                    ));
                }      
            }      
        } catch (e) { console.error("Push Error", e); }      

        return res.status(200).json({ 
            success: true, 
            ghostName: serverGhostName, 
            activeDay,
            warnings: hasMentalHealthIssue ? "تم إرسال رسالة دعم ✨" : null
        });      
    } catch (error) { return res.status(500).json({ error: error.message }); }
}
