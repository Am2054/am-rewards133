import/admin-stats.js - إحصائيات لوحة تحكم الإدارة العقارية حياً
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import jwt from "jsonwebtoken";
import { parse } from "cookie";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY))
  });
}

const db = getFirestore();
const auth = getAuth();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// ✅ التحقق من الجلسة الأمنية للأدمن
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  // ✅ التحقق من الجلسة
  if (!verifyAdminSession(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. حساب إجمالي عدد المستخدمين
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;

    // 2. حساب إحصائيات العقارات الكلية وحالاتها حياً
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

    // 3. حساب غرف التفاوض النشطة (المحادثات الفريدة بين الملاك والمستأجرين)
    const messagesSnap = await db.collection("messages").get();
    const uniqueRooms = new Set();
    messagesSnap.forEach(doc => {
      const data = doc.data();
      if (data.propertyId && data.senderId) {
        uniqueRooms.add(`${data.propertyId}_${data.senderId}`);
      }
    });
    const activeRooms = uniqueRooms.size;

    // 4. حساب الصفقات المكتملة الإجمالية (الحجوزات المقبولة)
    const bookingsSnap = await db.collection("bookings")
      .where("status", "==", "approved")
      .get();
    const completedDeals = bookingsSnap.size;

    // 5. حساب صفقات اليوم المكتملة
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const todayBookingsSnap = await db.collection("bookings")
      .where("status", "==", "approved")
      .where("timestamp", ">=", today)
      .get();
    const todayDeals = todayBookingsSnap.size;

    return res.status(200).json({
      totalUsers,
      totalProperties,
      pendingProperties,
      approvedProperties,
      rejectedProperties,
      activeRooms,
      completedDeals,
      todayDeals,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
