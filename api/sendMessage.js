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
    } catch (error) { 
        console.error("❌ Firebase Init Error:", error.message); 
    }
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

const bannedWords = [
    'الإرهاب', 'تفجير', 'مخدرات', 'بيع',
    'الرقم القومي', 'بطاقة الرقم', 'كود البنك',
];

const mentalHealthKeywords = [
    'انتحار', 'موت', 'أقتل نفسي', 'حياتي انتهت',
];

function isContentBanned(text) {
    const lowerText = text.toLowerCase();
    return bannedWords.some(word => lowerText.includes(word));
}

function hasMentalHealthKeywords(text) {
    const lowerText = text.toLowerCase();
    return mentalHealthKeywords.some(word => lowerText.includes(word));
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();      
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });      

    try {      
        const { action, text, uid, token, msgId, day, reason } = req.body;   
        
        // ✅ التحقق من التوكن
        let decodedToken;
        try {
            decodedToken = await auth.verifyIdToken(token);      
            if (decodedToken.uid !== uid) throw new Error("Unauthorized");
        } catch (e) {
            console.warn("⚠️ التحقق من التوكن فشل:", e.message);
        }

        const serverGhostName = generateDailyGhostName(uid);    
        const now = Date.now();    
        const todayDateFormatted = getFormattedDate();  
        const activeDay = day || todayDateFormatted;  

        // 🛡️ فحص اليوم الجديد
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

        // ✅ التعديل والحذف
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
                    text: cleanText.replace(/^#|^\*/g, '').trim(),     
                    edited: true,    
                    timestamp: now     
                });    
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
                activeDay: todayDateFormatted,   
                rank: rank,  
                welcomeCard: {  
                    show: isNewSession,  
                    title: "تجلّي جديد.. روح جديدة 🕯️",  
                    message: `لقد تلاشت أرواح الأمس. رتبتك الحالية: ${rank}`,  
                }  
            });    
        }    

        // ✅ الإبلاغ عن الرسائل
        if (action === "REPORT") {
            const msgRef = db.ref(`messages/global/${activeDay}/${msgId}`);
            const snap = await msgRef.once("value");
            if (!snap.exists()) return res.status(404).json({ error: "Message not found" });

            await msgRef.update({
                reports: (snap.val().reports || 0) + 1,
                lastReportReason: reason
            });

            if ((snap.val().reports || 0) + 1 >= 3) {
                await msgRef.update({ deleted: true, autoDeleted: true });
            }

            return res.status(200).json({ success: true, message: "تم الإبلاغ" });
        }

        // ✅ الحد من السبام
        const userLimitRef = db.ref(`userLimits/${uid}`);      
        const limitSnap = await userLimitRef.once("value");      
        if (limitSnap.exists() && (now - limitSnap.val() < 3000)) {   
            return res.status(429).json({ error: "انتظر قليلاً قبل الرسالة التالية" });  
        }  

        const dailyCountRef = db.ref(`dailyCount/${uid}/${todayDateFormatted}`);  
        const dailySnap = await dailyCountRef.once('value');  
        const count = dailySnap.exists() ? dailySnap.val() : 0;  
        if (count >= 100) return res.status(429).json({ error: "بلغت الحد اليومي للهمسات (100)" });  

        // ✅ معالجة النص
        const rawInput = (text || "").trim();  
        if (rawInput.length > 300) return res.status(400).json({ error: "الهمسة طويلة جداً" });  
        if (/(.)\1{7,}/.test(rawInput)) return res.status(400).json({ error: "توقف عن الضجيج!" });  

        if (isContentBanned(rawInput)) {
            return res.status(400).json({ error: "المحتوى يحتوي على كلمات غير مسموحة" });
        }

        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");      
        const isConfession = rawInput.startsWith('#');      
        let finalDisplayContent = cleanText.replace(/^#|^\*/g, '').trim();  

        let hasMentalHealthIssue = hasMentalHealthKeywords(finalDisplayContent);

        const replyMatch = finalDisplayContent.match(/^رد على @(.+?):/);      
        const replyToName = replyMatch ? replyMatch[1].trim() : null;      

        // 📝 إرسال الرسالة
        const msgRef = db.ref(`messages/global/${activeDay}`).push();      
        await msgRef.set({     
            uid, 
            sender: serverGhostName, 
            text: finalDisplayContent,     
            timestamp: now, 
            isConfession,
            reports: 0
        });      
          
        await userLimitRef.set(now);     
        await dailyCountRef.set(count + 1);  
        await db.ref(`userStats/${uid}/totalMessages`).transaction(c => (c || 0) + 1);  

        // 🆘 رسالة نظام للصحة النفسية
        if (hasMentalHealthIssue) {
            const systemMsgRef = db.ref(`messages/global/${activeDay}`).push();
            await systemMsgRef.set({
                uid: "SYSTEM",
                sender: "🆘 نظام الدعم",
                text: `نحن نقلق عليك 💜\n\nإذا كنت تمر بوقت عصيب:\n📞 مصر: +20100123456`,
                timestamp: now + 1,
                isSystem: true,
                type: "mentalHealth"
            });
        }

        // ✅ الإشعارات التراكمية
        try {      
            const tokensSnap = await db.ref('users_tokens').once('value');      
            if (tokensSnap.exists()) {      
                const tokensData = tokensSnap.val();
                
                // ✅ جمع جميع التوكنات
                let targetTokens = [];
                Object.values(tokensData).forEach(userData => {
                    if (userData && userData.token && typeof userData.token === 'string' && userData.token.length > 10) {
                        targetTokens.push(userData.token);
                    }
                });

                if (targetTokens.length > 0) {      
                    const payload = {      
                        notification: {      
                            title: isConfession ? `🕯️ اعتراف جديد` : `👻 ${serverGhostName}`,      
                            body: finalDisplayContent.substring(0, 150),
                        },      
                        data: {   
                            url: `https://am-rewards.vercel.app/ghost-chat.html`,
                            ghostName: serverGhostName,
                        },  
                        android: {   
                            priority: 'high',   
                            notification: { 
                                tag: 'ghost-chat-msg',
                                priority: 'max',
                            }   
                        },  
                        webpush: {   
                            headers: { "Urgency": "high" },   
                            notification: { 
                                tag: 'ghost-chat-msg',
                            }   
                        }  
                    };      
                    
                    // ✅ إرسال لجميع المستخدمين (تراكمي)
                    console.log(`📢 Sending notifications to ${targetTokens.length} users`);
                    
                    const chunks = [];
                    for (let i = 0; i < targetTokens.length; i += 500) {
                        chunks.push(targetTokens.slice(i, i + 500));
                    }
                    
                    for (const chunk of chunks) {
                        await messaging.sendEachForMulticast({ 
                            tokens: chunk, 
                            ...payload 
                        }).catch(err => console.error('❌ Multicast error:', err));
                    }
                    
                    console.log('✅ Notifications sent');
                }      
            }      
        } catch (e) { 
            console.error("❌ Push Error", e); 
        }      

        return res.status(200).json({ 
            success: true, 
            ghostName: serverGhostName, 
            activeDay
        });      
    } catch (error) { 
        console.error('❌ Handler Error:', error);
        return res.status(500).json({ error: error.message }); 
    }
                    }
