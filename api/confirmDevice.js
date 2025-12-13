// api/confirmDevice.js (تسجيل الموارد)

import { initializeApp, cert, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ... (كود تهيئة Firebase Admin بالكامل كما في secureSignup.js) ...
const serviceAccountJson = process.env.FIREBASE_ADMIN_KEY;
const projectId = "am--rewards";

let app;
let db;

try {
    if (!serviceAccountJson) {
        throw new Error("FIREBASE_ADMIN_KEY is missing");
    }

    if (!getApps().length) {
        app = initializeApp({
            credential: cert(JSON.parse(serviceAccountJson)),
            projectId,
        });
    } else {
        app = getApp();
    }

    db = getFirestore(app);
} catch (err) {
    db = null;
}
// ----------------------------------
// 🚀 API Handler
// ----------------------------------
export default async function handler(req, res) {
    if (!db) {
        return res.status(500).json({ confirmed: false, reason: "Server configuration error" });
    }

    if (req.method !== "POST") {
        return res.status(405).json({ confirmed: false, reason: "Method Not Allowed" });
    }

    try {
        const { email, deviceId } = req.body; 

        if (!email || !deviceId) {
            return res.status(400).json({ confirmed: false, reason: "Missing email or deviceId" });
        }

        const ip =
            req.headers["x-forwarded-for"]?.split(",")[0] ||
            req.socket.remoteAddress;

        // 🌟 الخطوة الحاسمة: تسجيل البيانات في userDevices بعد نجاح التسجيل في Firebase Auth
        await db.collection("userDevices").add({
            email,
            deviceId,
            ip,
            createdAt: FieldValue.serverTimestamp(),
        });
        
        console.log(`✅ تأكيد الجهاز/البريد لـ: ${email} @ ${ip}`);
        return res.status(200).json({ confirmed: true });

    } catch (err) {
        console.error("🔥 Confirmation Error:", err);
        return res.status(500).json({ confirmed: false, reason: "Server error during confirmation" });
    }
}
