import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// التأكد من تشغيل Firebase Admin بنفس طريقتك
if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) { 
    console.error("Firebase Init Error:", e.message); 
  }
}

const db = getFirestore();

export default async function handler(req, res) {
  // السماح فقط بطلبات POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { url } = req.body;
  const GOOGLE_API_KEY = process.env.SAFE_BROWSING_API_KEY; // المفتاح اللي جبناه من Google Cloud

  if (!url) {
    return res.status(400).json({ error: "الرابط مطلوب" });
  }

  try {
    const apiEndpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${GOOGLE_API_KEY}`;

    const requestBody = {
      client: { clientId: "Ahmed-Safe-Scan", clientVersion: "1.0.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url: url }]
      }
    };

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    // لو data.matches موجودة يبقى الرابط خطر
    const isSafe = !data.matches;

    return res.status(200).json({ safe: isSafe });

  } catch (error) {
    console.error("Scanning Error:", error);
    return res.status(500).json({ error: "فشل الفحص" });
  }
}
