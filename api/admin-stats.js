// /api/admin-stats.js - إحصائيات محسّنة
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

// ✅ التحقق من الجلسة
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
    // جمع الإحصائيات
    const usersSnap = await db.collection("users").get();
    const totalUsers = usersSnap.size;
    let currentPoints = 0;
    let totalDistributedPoints = 0;
    let totalRefEarnings = 0;
    let totalRefCount = 0;

    usersSnap.forEach(doc => {
      const data = doc.data();
      currentPoints += data.points || 0;
      totalDistributedPoints += (data.pointsDistributed || 0);
      totalRefEarnings += (data.totalReferralEarnings || 0);
      totalRefCount += (data.referralCount || 0);
    });

    // السحوبات المعلقة
    const withdrawalsSnap = await db.collection("withdrawals")
      .where("status", "==", "pending")
      .get();
    const pendingWithdrawals = withdrawalsSnap.size;

    // تذاكر الدعم المفتوحة
    const supportSnap = await db.collection("supportTickets")
      .where("status", "==", "open")
      .get();
    const openSupportTickets = supportSnap.size;

    // عمليات اليوم
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const todaySnap = await db.collection("withdrawals")
      .where("status", "==", "completed")
      .where("date", ">=", today)
      .get();
    const todayPaidCount = todaySnap.size;
    let totalPaidNet = 0;

    todaySnap.forEach(doc => {
      totalPaidNet += (doc.data().net || 0);
    });

    return res.status(200).json({
      totalUsers,
      currentPoints,
      totalDistributedPoints,
      totalRefEarnings,
      totalRefCount,
      pendingWithdrawals,
      openSupportTickets,
      todayPaidCount,
      totalPaidNet,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}
