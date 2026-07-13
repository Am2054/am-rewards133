import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { getMessaging } from "firebase-admin/messaging";

// 1️⃣ تهيئة الـ Firebase Admin باستخدام المفتاح السري وقاعدة البيانات
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
const messaging = getMessaging();

export default async function handler(req, res) {
    // تفعيل الـ CORS لتتمكن من إرسال الطلب من المتصفح مباشرة
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === "OPTIONS") return res.status(200).end();      
    if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });      

    try {      
        // استقبال البيانات الأساسية لإرسال الإشعار
        const { receiverId, senderName, title, body, roomId } = req.body;   
        
        if (!receiverId || !body) {
            return res.status(400).json({ error: "Missing required fields (receiverId, body)" });
        }

        // 2️⃣ جلب الـ Token الخاص بالمستلم من قاعدة البيانات (users_tokens)
        const tokenSnap = await db.ref(`users_tokens/${receiverId}`).once('value');
        
        if (!tokenSnap.exists()) {
            return res.status(404).json({ error: "No FCM token found for this receiver" });
        }

        const receiverToken = tokenSnap.val().token;

        if (receiverToken && typeof receiverToken === 'string' && receiverToken.length > 10) {
            // 3️⃣ تجهيز هيكل الإشعار (Payload) المتوافق مع الشات الجديد
            const payload = {      
                notification: {      
                    title: title || `💬 رسالة جديدة من ${senderName || 'شخص ما'}`,      
                    body: body.substring(0, 150), // قص النص إذا كان طويلاً جداً
                },      
                data: {   
                    url: `https://am-rewards.vercel.app/chat.html?roomId=${roomId || ''}`,
                    senderName: senderName || 'طرف آخر',
                },  
                android: {   
                    priority: 'high',   
                    notification: { 
                        tag: 'am-chat-msg',
                        priority: 'max',
                        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png'
                    }   
                },  
                webpush: {   
                    headers: { "Urgency": "high" },   
                    notification: { 
                        tag: 'am-chat-msg',
                        icon: 'https://cdn-icons-png.flaticon.com/512/633/633600.png'
                    }   
                },
                token: receiverToken
            };      
            
            // 4️⃣ إرسال الإشعار للمستلم المحدد
            console.log(`📢 Sending notification to: ${receiverId}`);
            const response = await messaging.send(payload);
            console.log('✅ Notification sent successfully:', response);
            
            return res.status(200).json({ success: true, messageId: response });
        } else {
            return res.status(400).json({ error: "Invalid FCM Token" });
        }
    } catch (error) { 
        console.error('❌ Notification Sender Error:', error);
        return res.status(500).json({ error: error.message }); 
    }
}
