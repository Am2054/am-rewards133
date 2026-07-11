// /api/admin-users.js - موديول إدارة مستخدمي منصة العقارات بالخلفية وحسابات الغرف والعقارات
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database"; // استيراد قاعدة البيانات اللحظية
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ 
      credential: cert(serviceAccount),
      databaseURL: "https://am--rewards-default-rtdb.firebaseio.com" // ربط الـ RTDB لخدمات حساب غرف المحادثة
    });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();
const rtdb = getDatabase(); // كائن التحكم بالـ Realtime Database

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, status, lastId, searchQuery, sortBy } = req.body;

  // --- [1] نظام تسجيل الدخول الموحد لمدير المستخدمين ---
  if (action === 'admin_login') {
    let isValid = false;
    let role = "";
    
    if (module === 'users' && password === process.env.ADMIN_PASSWORD1) { 
      isValid = true; 
      role = "users_admin"; 
    }

    if (isValid) {
      const token = jwt.sign({ role, module }, process.env.JWT_SECRET, { expiresIn: '24h' });
      res.setHeader('Set-Cookie', serialize('adminToken', token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 86400 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  // --- [2] التحقق من التوكن للمضي في العمليات ---
  const cookies = parse(req.headers.cookie || "");
  const token = cookies.adminToken;
  if (!token) return res.status(401).json({ error: "No Token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== 'users_admin' || decoded.module !== 'users') {
      return res.status(403).json({ error: "Forbidden" });
    }

    // --- [3] موديول إدارة مستخدمي العقارات وشؤون الأعضاء ---
    if (module === 'users') {
      if (action === 'get_users') {
        let queryRef = db.collection("users");

        if (searchQuery) {
          queryRef = queryRef
            .orderBy("email")
            .where("email", ">=", searchQuery.toLowerCase().trim())
            .where("email", "<=", searchQuery.toLowerCase().trim() + "\uf8ff");
        } else {
          queryRef = queryRef.orderBy("lastLogin", "desc");
        }

        if (lastId && !searchQuery) {
          const lastSnapshot = await db.collection("users").doc(lastId).get();
          if (lastSnapshot.exists) {
            queryRef = queryRef.startAfter(lastSnapshot);
          }
        }

        queryRef = queryRef.limit(10);

        const snap = await queryRef.get();
        console.log("Users Found:", snap.size);

        // جلب غرف التفاوض النشطة كلياً ودفعة واحدة من قاعدة البيانات اللحظية (High-Performance Single Call)
        const roomsSnap = await rtdb.ref("chatRooms").get();
        const allRooms = roomsSnap.exists() ? Object.values(roomsSnap.val()) : [];

        // معالجة وحساب بيانات الأعضاء بالتوازي بكفاءة تامة (Promise.all Pipeline)
        const users = await Promise.all(snap.docs.map(async (doc) => {
          const uId = doc.id;
          const uData = doc.data();

          // 1. حساب عدد العقارات الفعلي للمستخدم في Firestore
          const propertiesCountSnap = await db.collection("properties")
            .where("ownerId", "==", uId)
            .count()
            .get();
          const propertiesCount = propertiesCountSnap.data().count;

          // 2. حساب عدد الغرف الفعلي النشط للمستخدم بالـ Realtime Database في الذاكرة
          const roomsCount = allRooms.filter(room => 
            (room.participants && room.participants[uId]) || 
            room.ownerId === uId || 
            room.buyerId === uId
          ).length;

          let lastLoginText = "غير نشط حالياً";
          if (uData.lastLogin) {
            try {
              const date = uData.lastLogin.toDate ? uData.lastLogin.toDate() : new Date(uData.lastLogin);
              lastLoginText = date.toLocaleString("ar-EG");
            } catch (e) {
              console.warn("Date parse warn:", e.message);
            }
          }

          return {
            id: uId,
            name: uData.name || "مستخدم مجهول",
            email: uData.email || "-",
            phone: uData.phone || "غير مسجل",
            status: uData.isBanned ? "banned" : "active",
            propertiesCount,
            roomsCount,
            lastLoginText
          };
        }));

        const countSnap = await db.collection("users").count().get();

        return res.status(200).json({
          users,
          total: countSnap.data().count
        });
      }

      // تفعيل حظر أو فك حظر حساب العضو
      if (action === 'toggle_ban') {
        const isBannedValue = (status === 'banned');
        await db.collection('users').doc(uid).update({ 
          isBanned: isBannedValue,
          status: status,
          bannedAt: isBannedValue ? FieldValue.serverTimestamp() : null 
        });
        return res.status(200).json({ success: true });
      }
    }

  } catch (e) { 
    console.error("Session Error:", e.message);
    return res.status(401).json({ error: "Session Expired" }); 
  }
}
