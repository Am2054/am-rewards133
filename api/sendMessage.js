import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";

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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === "OPTIONS") return res.status(200).end();  
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });  

    try {  
        const { action, text, sender, uid, token, msgId } = req.body;  

        const decodedToken = await auth.verifyIdToken(token);  
        if (decodedToken.uid !== uid) throw new Error("Unauthorized");  

        // --- معالجة التعديل والحذف الآمن ---
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
                const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");
                await msgRef.update({ 
                    text: cleanText.replace(/#اعتراف|#سر|سر/g, '').trim(), 
                    edited: true 
                });
                return res.status(200).json({ success: true });
            }
        }

        // --- كود الإرسال الأصلي ---
        const now = Date.now();  
        const safeSenderName = sender.replace(/[.#$[\]]/g, "_");  
        const lastMsgRef = db.ref(`lastMessage/${safeSenderName}`);  
        const lastSnap = await lastMsgRef.once("value");  
          
        if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {  
            return res.status(429).json({ error: "اهدأ قليلاً يا شبح.." });  
        }  

        const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");  
        const isConfession = text.includes('#اعتراف');  
        const isSecret = text.includes('#سر') || text.includes('سر');  

        let finalDisplayContent = cleanText  
            .replace(/#اعتراف/g, '')  
            .replace(/#سر/g, '')  
            .replace(/سر/g, '')  
            .trim();  

        const replyMatch = finalDisplayContent.match(/^رد على @(.+?):/);  
        const replyToName = replyMatch ? replyMatch[1].trim() : null;  

        const msgRef = db.ref('messages/global').push();  
        await msgRef.set({ uid, sender, text: finalDisplayContent, timestamp: now, isConfession, isSecret });  
        await lastMsgRef.set(now);  

        // --- نظام الإشعارات ---
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
                    const payload = {  
                        notification: {  
                            title: replyToName ? `💬 رد جديد من ${sender}` : (isConfession ? `🕯️ اعتراف من ${sender}` : `👻 رسالة جديدة`),  
                            body: isSecret ? "همس بشيء غامض..." : (finalDisplayContent.length > 50 ? finalDisplayContent.substring(0, 47) + "..." : finalDisplayContent),  
                        },  
                        data: { url: "https://am-rewards.vercel.app/ghost-chat.html" },  
                        android: { priority: 'high', notification: { tag: 'ghost-chat-msg' } },  
                        webpush: {   
                            headers: { Urgency: 'high' },  
                            notification: { tag: 'ghost-chat-msg', renotify: true },  
                            fcm_options: { link: "https://am-rewards.vercel.app/ghost-chat.html" }  
                        }  
                    };  

                    await messaging.sendEachForMulticast({ tokens: targetTokens, ...payload });  
                }  
            }  
        } catch (pushError) { console.error("Push Error"); }  

        return res.status(200).json({ success: true });  

    } catch (error) { return res.status(500).json({ error: error.message }); }
}
