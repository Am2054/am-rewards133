import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database"; // حذفنا ServerValue
import { getAuth } from "firebase-admin/auth";

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { text, sender, uid, token } = req.body;
    
    // التحقق من التوكن
    const decodedToken = await auth.verifyIdToken(token);
    if (decodedToken.uid !== uid) throw new Error("Unauthorized");

    const now = Date.now();
    const safeSenderName = sender.replace(/[.#$[\]]/g, "_");
    
    // حماية من السبام
    const lastMsgRef = db.ref(`lastMessage/${safeSenderName}`);
    const lastSnap = await lastMsgRef.once("value");
    if (lastSnap.exists() && (now - lastSnap.val() < 3000)) {
      return res.status(429).json({ error: "اهدأ قليلاً يا شبح.." });
    }

    const cleanText = text.replace(/(010|011|012|015|019|٠١٠|٠١١|٠١٢|٠١٥|٠١٩)[\s-]*\d{8}/g, "[محجوب]");
    const isConfession = text.includes('#اعتراف');
    const isSecret = text.includes('#سر') || text.includes('سر');

    const msgRef = db.ref('messages/global').push();
    
    // التعديل السحري هنا ✅
    await msgRef.set({
      uid,
      sender,
      text: cleanText,
      timestamp: now, // استخدام رقم مباشر بدلاً من ServerValue
      isConfession,
      isSecret
    });

    await lastMsgRef.set(now);
    return res.status(200).json({ success: true });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
