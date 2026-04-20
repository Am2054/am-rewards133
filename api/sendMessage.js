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
    // تثبيت التوقيت لمنع تغير الاسم عند الـ Refresh
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date()).replace(/-/g, '');
}

function generateDailyGhostName(uid) {
    const egyptDate = getFormattedDate(); // استخدام الدالة الموحدة
    const hash = crypto.createHash('md5').update(uid + egyptDate).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16);
    const adjs = ["الغامض", "الثائر", "الهادئ", "المحارب", "العابر", "الصامت", "التائه", "المراقب", "المنسي", "الخفي"];
    const names = ["طيف", "كيان", "سراب", "ظل", "نور", "صدى", "برق", "نجم", "وهم", "شبح"];
    const name = names[index % names.length];
    const adj = adjs[(index >> 2) % adjs.length];
    const pin = (index % 9000) + 1000;
    return `${name} ${adj} #${pin}`;
}


export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();    
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });    

    try {    
        const { action, text, uid, token, msgId, day } = req.body; 
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

        // 🌕 استجابة الهوية + الرتب الشبحية (الميزة المضافة)
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

        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");    
        const isConfession = rawInput.startsWith('#') || rawInput.includes('#اعتراف');    
        const isSecret = rawInput.startsWith('*') || rawInput.includes('#سر');    
          
        let finalDisplayContent = cleanText.replace(/^#|^\*|#اعتراف|#سر|سر/g, '').trim();

        // منطق الردود للإشعارات
        const replyMatch = finalDisplayContent.match(/^رد على @(.+?):/);    
        const replyToName = replyMatch ? replyMatch[1].trim() : null;    

        // 📝 إرسال الرسالة + تحديث إحصائيات الرتبة
        const msgRef = db.ref(`messages/global/${activeDay}`).push();    
        await msgRef.set({   
            uid, sender: serverGhostName, text: finalDisplayContent,   
            timestamp: now, isConfession, isSecret   
        });    
        
        await userLimitRef.set(now);   
        await dailyCountRef.set(count + 1);
        await db.ref(`userStats/${uid}/totalMessages`).transaction(c => (c || 0) + 1);

 // في الـ Backend، استبدل فقط جزء الـ Push Notifications بهذا الجزء:
        // 🔔 نظام الإشعارات المتكامل (Push Notifications)
        try {    
            const tokensSnap = await db.ref('users_tokens').once('value');    
            if (tokensSnap.exists()) {    
                const tokensData = tokensSnap.val();    
                const myTokenSnap = await db.ref(`users_tokens/${uid}/token`).once('value');
                const myToken = myTokenSnap.val();

                let targetTokens = Object.values(tokensData)
                    .map(u => u.token)
                    .filter(t => typeof t === 'string' && t.length > 10 && t !== myToken);

                if (targetTokens.length > 0) {    
                    const payload = {    
                        notification: {    
                            title: replyToName ? `💬 رد من ${serverGhostName}` : `👻 همسة جديدة في الشات`,    
                            body: finalDisplayContent, // إرسال النص كاملاً
                        },    
                        data: { 
                            url: "https://am-rewards.vercel.app/ghost-chat.html",
                            click_action: "FLUTTER_NOTIFICATION_CLICK"
                        },
                        android: { 
                            priority: 'high', 
                            ttl: 0, 
                            notification: { tag: 'ghost-chat-msg', priority: 'max', visibility: 'public' } 
                        },
                        webpush: { 
                            headers: { "Urgency": "high", "TTL": "0" }, 
                            notification: { tag: 'ghost-chat-msg', renotify: true } 
                        }
                    };    
                    
                    for (let i = 0; i < targetTokens.length; i += 500) {
                        const chunk = targetTokens.slice(i, i + 500);
                        await messaging.sendEachForMulticast({ tokens: chunk, ...payload });
                    }
                }    
            }    
        } catch (e) { console.error("Push Error", e); } 


        return res.status(200).json({ success: true, ghostName: serverGhostName, activeDay });    
    } catch (error) { return res.status(500).json({ error: error.message }); }
}
