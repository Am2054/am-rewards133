import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

if (!getApps().length) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY))
  });
}

const db = getFirestore();
const adminAuth = getAuth();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {

    // ==========================
    // التحقق من Firebase ID Token
    // ==========================
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Token" });
    }

    const idToken = authHeader.split("Bearer ")[1];

    const decoded = await adminAuth.verifyIdToken(idToken);

    // اسمح فقط للأدمن
    if (decoded.email !== process.env.ADMIN_EMAIL) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // ==========================
    // Users
    // ==========================

    const usersCountSnap = await db.collection("users").count().get();
    const totalUsers = usersCountSnap.data().count;

    // ==========================
    // Properties
    // ==========================

    const propertiesSnap = await db.collection("properties").get();

    const totalProperties = propertiesSnap.size;

    let pendingProperties = 0;
    let approvedProperties = 0;
    let rejectedProperties = 0;

    propertiesSnap.forEach(doc => {
      const data = doc.data();

      switch (data.status) {
        case "pending":
          pendingProperties++;
          break;

        case "approved":
          approvedProperties++;
          break;

        case "rejected":
          rejectedProperties++;
          break;
      }
    });

    // ==========================
    // Active Rooms
    // ==========================

    const messagesSnap = await db.collection("messages").get();

    const rooms = new Set();

    messagesSnap.forEach(doc => {
      const d = doc.data();

      if (d.propertyId && d.senderId) {
        rooms.add(`${d.propertyId}_${d.senderId}`);
      }
    });

    const activeRooms = rooms.size;

    // ==========================
    // Deals
    // ==========================

    const completedDealsSnap = await db.collection("bookings")
      .where("status", "==", "approved")
      .count()
      .get();

    const completedDeals = completedDealsSnap.data().count;

    // ==========================
    // Today's Deals
    // ==========================

    const today = new Date();

    today.setUTCHours(0, 0, 0, 0);

    const todaySnap = await db.collection("bookings")
      .where("status", "==", "approved")
      .where("timestamp", ">=", Timestamp.fromDate(today))
      .get();

    const todayDeals = todaySnap.size;

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

  } catch (err) {

    console.error(err);

    return res.status(401).json({
      error: "Unauthorized"
    });

  }
}
