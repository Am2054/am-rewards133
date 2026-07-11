// /api/admin-stats.js - إحصائيات لوحة تحكم الإدارة العقارية حياً (نسخة الكوكيز الآمنة والتحسين البرمجي)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database"; // استيراد قاعدة البيانات اللحظية
import jwt from "jsonwebtoken";
import { parse } from "cookie";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY)),
    databaseURL: "https://am--rewards-default-rtdb.firebaseio.com" // تهيئة الـ RTDB برابط الاتصال الفعلي
  });
}

const db = getFirestore();
const auth = getAuth();
const rtdb = getDatabase(); // كائن التحكم بـ Realtime Database
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// التحقق من الجلسة الأمنية للأدمن عبر الكوكيز المرفقة بالطلب
function verifyAdminSession(req) {
  try {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies.adminToken;

    if (!token) return false;  

    jwt.verify(token, JWT_SECRET);  
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // التوثيق الصارم والنطاق الموجه مع تفعيل الكوكيز عبر الـ CORS
  res.setHeader("Access-Control-Allow-Origin", "https://am-rewards.vercel.app");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  // التحقق من الجلسة الأمنية
  if (!verifyAdminSession(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. حساب إجمالي عدد المستخدمين من Firestore
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;

    // 2. حساب إحصائيات العقارات الكلية وحالاتها حياً من Firestore
    const propertiesSnap = await db.collection("properties").get();  
    const totalProperties = propertiesSnap.size;  

    let pendingProperties = 0;  
    let approvedProperties = 0;  
    let rejectedProperties = 0;  

    propertiesSnap.forEach(doc => {  
      const data = doc.data();  
      if (data.status === "pending") pendingProperties++;  
      else if (data.status === "approved") approvedProperties++;  
      else if (data.status === "rejected") rejectedProperties++;  
    });  

    // 3. حساب غرف التفاوض النشطة كلياً ومباشرة من الـ Realtime Database (RTDB)
    const roomsRef = rtdb.ref("chatRooms");
    const roomsSnap = await roomsRef.get();
    const activeRooms = roomsSnap.exists() ? Object.keys(roomsSnap.val()).length : 0;  

    // إرسال كائن البيانات الإحصائية الفعلي بعد استبعاد الصفقات الملغاة
    return res.status(200).json({  
      totalUsers,  
      totalProperties,  
      pendingProperties,  
      approvedProperties,  
      rejectedProperties,  
      activeRooms,  
      timestamp: new Date().toISOString()  
    });

  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
