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

function generateDailyGhostName(uid) {
    const today = new Date().toDateString();
    const hash = crypto.createHash('md5').update(uid + today).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16);
    const adjs = ["الغامض", "الثائر", "الهادئ", "المحارب", "العابر", "الصامت", "التائه", "المراقب", "المنسي", "الخفي"];
    const names = ["طيف", "كيان", "سراب", "ظل", "نور", "صدى", "برق", "نجم", "وهم", "شبح"];
    const name = names[index % names.length];
    const adj = adjs[(index >> 2) % adjs.length];
    const pin = (index % 9000) + 1000;
    return `${name} ${adj} #${pin}`;
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();    
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });    

    try {    
        const { action, text, uid, token, msgId } = req.body; // تم إهمال sender من Body لضمان الأمان
        const decodedToken = await auth.verifyIdToken(token);    
        if (decodedToken.uid !== uid) throw new Error("Unauthorized");    

        // 🛡️ الحماية القصوى: الهوية تُحدد حصراً من السيرفر
        const serverGhostName = generateDailyGhostName(uid);  
        const activeGhostName = serverGhostName;   
        const now = Date.now();  

        const lastResetRef = db.ref('system/last_reset_date');  
        const resetSnap = await lastResetRef.once('value');  
        const todayDate = new Date().toDateString();  

        if (!resetSnap.exists() || resetSnap.val() !== todayDate) {  
            await db.ref('messages/global').remove();  
            await lastResetRef.set(todayDate);  
            console.log("Chat purged for the new day: " + todayDate);  
        }  

        if (action === "EDIT" || action === "DELETE") {  
            const msgRef = db.ref(`messages/global/${msgId}`);  
            const snap = await msgRef.once("value");  
            if (!snap.exists()) return res.status(404).json({ error: "NotFound" });  
            if (snap.val().uid !== uid) return res.status(403).json({ error: "Forbidden" });  

            if (action === "DELETE") {  
                await msgRef.update({ deleted: true });  
                return res.status(200).json({ success: true });  
            }  
            if (action === "EDIT") {
                // فلترة النصوص عند التعديل أيضاً
                const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");  
                await msgRef.update({   
                    text: cleanText.replace(/#اعتراف|#سر|سر|^#|^\*/g, '').trim(),   
                    edited: true,  
                    timestamp: now   
                });  
                return res.status(200).json({ success: true });  
            }  
        }  

        if (action === "GET_IDENTITY") {  
            return res.status(200).json({ ghostName: serverGhostName });  
        }  

        // ⚠️ تحسين الـ Rate Limit: الحماية بناءً على UID لمنع الـ Flood من عدة تبويبات
        const userLimitRef = db.ref(`userLimits/${uid}`);    
        const limitSnap = await userLimitRef.once("value");    
        if (limitSnap.exists() && (now - limitSnap.val() < 6000)) { // تم رفع المهلة لـ 6 ثوانٍ
            return res.status(429).json({ error: "السرعة قتلت الشبح.. انتظر قليلاً." });
        }

        const rawInput = (text || "").trim();
        
        // 🚫 منع الـ Spam والرسائل الطويلة جداً
        if (rawInput.length > 300) return res.status(400).json({ error: "الهمسة طويلة جداً" });
        if (/(.)\1{7,}/.test(rawInput)) return res.status(400).json({ error: "كفى ضجيجاً (تكرار حروف)!" });

        // 🛡️ فلترة أرقام الموبايل المتطورة (حتى لو بمسافات)
        const cleanText = rawInput.replace(/((\d[\s-]?){11})/g, "[محجوب]");    
          
        const isConfession = rawInput.startsWith('#') || rawInput.includes('#اعتراف');    
        const isSecret = rawInput.startsWith('*') || rawInput.includes('#سر') || rawInput.includes('سر');    
          
        let finalDisplayContent = cleanText  
            .replace(/^#|^\*/g, '')   
            .replace(/#اعتراف/g, '')  
            .replace(/#سر/g, '')  
            .replace(/سر/g, '')  
            .trim();    

        const replyMatch = finalDisplayContent.match(/^رد على @(.+?):/);    
        const replyToName = replyMatch ? replyMatch[1].trim() : null;    

        const msgRef = db.ref('messages/global').push();    
        await msgRef.set({   
            uid,   
            sender: activeGhostName,   
            text: finalDisplayContent,   
            timestamp: now,   
            isConfession,   
            isSecret   
        });    
        await userLimitRef.set(now); // تحديث وقت آخر رسالة للـ UID   

        try {    
            const tokensSnap = await db.ref('users_tokens').once('value');    
            if (tokensSnap.exists()) {    
                const tokensData = tokensSnap.val();    
                let targetTokens = [];    
                if (replyToName) {    
                    const targetUser = Object.values(tokensData).find(u => u.ghostName === replyToName);    
                    if (targetUser && targetUser.token) targetTokens = [targetUser.token];    
                } else {    
                    const myTokenSnap = await db.ref(`users_tokens/${uid}/token`).once('value');    
                    const myToken = myTokenSnap.val();    
                    targetTokens = Object.values(tokensData)  
                        .map(u => u.token)  
                        .filter(t => typeof t === 'string' && t.length > 10 && t !== myToken);    
                }    

                if (targetTokens.length > 0) {    
                    const payloadBase = {    
                        notification: {    
                            title: replyToName ? `💬 رد جديد من ${activeGhostName}` : (isConfession ? `🕯️ اعتراف من ${activeGhostName}` : `👻 رسالة جديدة`),    
                            body: isSecret ? "همس بشيء غامض..." : (finalDisplayContent.length > 50 ? finalDisplayContent.substring(0, 47) + "..." : finalDisplayContent),    
                        },    
                        data: { url: "https://am-rewards.vercel.app/ghost-chat.html" },    
                        android: { priority: 'high', notification: { tag: 'ghost-chat-msg' } },    
                        webpush: { headers: { Urgency: 'high' }, notification: { tag: 'ghost-chat-msg', renotify: true }, fcm_options: { link: "https://am-rewards.vercel.app/ghost-chat.html" } }    
                    };    
                    
                    // إرسال الإشعارات بنظام الـ Chunking (كل 500 توكن)
                    for (let i = 0; i < targetTokens.length; i += 500) {
                        const chunk = targetTokens.slice(i, i + 500);
                        await messaging.sendEachForMulticast({ tokens: chunk, ...payloadBase });
                    }
                }    
            }    
        } catch (pushError) { console.error("Push Error", pushError); }    

        return res.status(200).json({ success: true, ghostName: activeGhostName });    
    } catch (error) { return res.status(500).json({ error: error.message }); }
}
