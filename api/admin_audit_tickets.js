// /api/admin_audit_tickets.js - إدارة ومعالجة تذاكر الدعم والاتصال العقاري وعقارات وغرف المنصة بالخلفية
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getDatabase } from "firebase-admin/database"; 
import { getAuth } from "firebase-admin/auth"; 
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ 
      credential: cert(serviceAccount),
      databaseURL: "https://am--rewards-default-rtdb.firebaseio.com" 
    });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();
const rtdb = getDatabase(); 
const auth = getAuth(); 
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// التحقق من الجلسة الأمنية للأدمن عبر الكوكيز المرفقة بالطلب
function verifyAdminSession(req) {
  try {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies.ticketToken || cookies.adminToken;

    if (!token) return false;  

    jwt.verify(token, JWT_SECRET);  
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  
  res.setHeader("Access-Control-Allow-Origin", origin || "https://am-rewards.vercel.app");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, status, tId, reply, propertyId, requestId, reason, roomId, messageText } = req.body;

  if (action === 'admin_login') {
    let isValid = false;
    let tokenName = "";

    if (module === 'tickets' && password === process.env.ADMIN_PASSWORD6) {
      isValid = true; tokenName = "ticketToken";
    }

    if (isValid) {
      const token = jwt.sign({ role: 'admin', module }, process.env.JWT_SECRET, { expiresIn: '8h' });
      res.setHeader('Set-Cookie', serialize(tokenName, token, { 
        path: '/', httpOnly: true, secure: true, sameSite: 'strict', maxAge: 28800 
      }));
      return res.status(200).json({ success: true });
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  let isAuthorized = false;

  try {
    if (verifyAdminSession(req)) {
      isAuthorized = true;
    }
  } catch (e) {
    console.warn("Cookie verification skipped/failed:", e.message);
  }

  if (!isAuthorized) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      try {
        const decodedToken = await auth.verifyIdToken(idToken);
        if (decodedToken) {
          isAuthorized = true; 
        }
      } catch (err) {
        console.error("Firebase Admin ID Token verification failed:", err.message);
      }
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized: تصريح إداري غير صالح أو منتهي الصلاحية" });
  }

  try {
    if (module === 'tickets') {
      if (action === 'get_all_tickets') {
        const snap = await db.collection("support_tickets").orderBy("timestamp", "desc").get();
        return res.status(200).json(snap.docs.map(doc => ({ 
          id: doc.id, 
          ...doc.data(), 
          timestamp: doc.data().timestamp?.toDate() 
        })));
      }

      if (action === 'finalize_ticket') {
        const ticketRef = db.collection("support_tickets").doc(tId);
        await ticketRef.update({ 
          status, 
          adminReply: reply, 
          handledAt: serverTimestamp() 
        });
        return res.status(200).json({ success: true });
      }
    }

    if (module === 'properties') {
      if (action === 'get_admin_properties') {
        // حساب العدادات لكافة المنزلقات بما فيها منزلق التعديل الجديد (Edit Requests) في نفس الوقت لسرعة قصوى
        const [pendingCountSnap, approvedCountSnap, rejectedCountSnap, editRequestsCountSnap] = await Promise.all([
          db.collection("properties").where("status", "==", "pending").count().get(),
          db.collection("properties").where("status", "==", "approved").count().get(),
          db.collection("properties").where("status", "==", "rejected").count().get(),
          db.collection("property_edit_requests").where("status", "==", "pending").count().get()
        ]);

        const pendingCount = pendingCountSnap.data().count;
        const approvedCount = approvedCountSnap.data().count;
        const rejectedCount = rejectedCountSnap.data().count;
        const editRequestsCount = editRequestsCountSnap.data().count;
        const totalCount = pendingCount + approvedCount + rejectedCount + editRequestsCount;

        let propertiesList = [];

        if (status === 'edit_requests') {
          // استعلام وجلب طلبات التعديل المعلقة كلياً من الكولكشن المخصصة لها
          const snap = await db.collection("property_edit_requests").orderBy("createdAt", "desc").get();
          propertiesList = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate()
          }));
        } else {
          // استعلام وجلب البيانات العامة من كولكشن العقارات الرئيسية
          const snap = await db.collection("properties").orderBy("createdAt", "desc").get();
          propertiesList = snap.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate()
          }));

          if (status && status !== 'all') {
            propertiesList = propertiesList.filter(p => p.status === status);
          }
        }

        return res.status(200).json({
          properties: propertiesList,
          stats: {
            pending: pendingCount,
            approved: approvedCount,
            rejected: rejectedCount,
            edit_requests: editRequestsCount,
            total: totalCount
          }
        });
      }

      // الموافقة على إعلان عقار جديد عادي
      if (action === 'approve') {
        await db.collection("properties").doc(propertyId).update({
          status: "approved",
          rejectReason: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true, message: "✅ تمت الموافقة على العقار ونشره بنجاح بالمنصة." });
      }

      // الموافقة على طلب تعديل قائم ونقل البيانات الجديدة للمستند الأصلي
      if (action === 'approve_edit') {
        if (!requestId || !propertyId) {
          return res.status(400).json({ error: "Missing required parameters: requestId or propertyId" });
        }

        const requestSnap = await db.collection("property_edit_requests").doc(requestId).get();
        if (!requestSnap.exists) {
          return res.status(404).json({ error: "طلب التعديل المطلوب لم يتم العثور عليه." });
        }

        const requestData = requestSnap.data();
        const proposedNewData = requestData.newData;

        // 1. نقل وتحديث البيانات الجديدة في مستند العقار الأصلي ورفع الحجب عنه بجعله approved
        await db.collection("properties").doc(propertyId).update({
          ...proposedNewData,
          status: "approved",
          rejectReason: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        });

        // 2. تحديث حالة طلب التعديل المعلق ليكون معتمداً ومغلقاً بالخلفية
        await db.collection("property_edit_requests").doc(requestId).update({
          status: "approved",
          resolvedAt: FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: "✅ تم اعتماد وتطبيق التعديلات ونشر العقار المحدث بنجاح." });
      }

      // رفض إعلان عقار جديد عادي
      if (action === 'reject') {
        await db.collection("properties").doc(propertyId).update({
          status: "rejected",
          rejectReason: reason || "لم يذكر",
          updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true, message: "⚠️ تم رفض الإعلان وإشعار المعلن بالسبب بنجاح." });
      }

      // رفض طلب تعديل قائم وإخطار المستخدم بالسبب
      if (action === 'reject_edit') {
        if (!requestId || !propertyId) {
          return res.status(400).json({ error: "Missing required parameters: requestId or propertyId" });
        }

        // 1. تحديث حالة طلب التعديل ليكون مرفوضاً وتوثيق السبب
        await db.collection("property_edit_requests").doc(requestId).update({
          status: "rejected",
          rejectReason: reason || "تم رفض التعديل بواسطة الإدارة",
          resolvedAt: FieldValue.serverTimestamp()
        });

        // 2. تحديث حالة العقار الأصلي نفسه ليكون مرفوضاً ومحجوباً عن العرض العام وتوثيق سبب الرفض للمالك
        await db.collection("properties").doc(propertyId).update({
          status: "rejected",
          rejectReason: reason || "تم رفض التعديل المقترح بواسطة الإدارة",
          updatedAt: FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: "⚠️ تم رفض التعديلات المقترحة بنجاح وإبقاء العقار محجوباً." });
      }

      // حذف مستند العقار الأصلي نهائياً
      if (action === 'delete') {
        await db.collection("properties").doc(propertyId).delete();
        return res.status(200).json({ success: true, message: "🗑️ تم حذف مستند العقار نهائياً من السيرفر بنجاح." });
      }

      // حذف طلب التعديل المعلق نهائياً دون التأثير على العقار الأصلي
      if (action === 'delete_edit') {
        if (!requestId) {
          return res.status(400).json({ error: "Missing required parameter: requestId" });
        }
        await db.collection("property_edit_requests").doc(requestId).delete();
        return res.status(200).json({ success: true, message: "🗑️ تم حذف مستند طلب التعديل نهائياً بنجاح." });
      }
    }

    if (module === 'rooms') {
      if (action === 'get_admin_rooms') {
        const [roomsSnap, messagesSnap] = await Promise.all([
          rtdb.ref("chatRooms").get(),
          rtdb.ref("messages").get()
        ]);

        const roomsData = roomsSnap.exists() ? roomsSnap.val() : {};
        const messagesData = messagesSnap.exists() ? messagesSnap.val() : {};

        const roomsList = Object.keys(roomsData).map(key => ({
          id: key,
          ...roomsData[key]
        }));

        roomsList.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0));

        let totalMessages = 0;
        Object.keys(messagesData).forEach(rId => {
          if (messagesData[rId]) {
            totalMessages += Object.keys(messagesData[rId]).length;
          }
        });

        return res.status(200).json({
          rooms: roomsList,
          stats: {
            totalRooms: roomsList.length,
            totalMessages: totalMessages
          }
        });
      }

      if (action === 'admin_send_message') {
        if (!roomId || !messageText || !messageText.trim()) {
          return res.status(400).json({ error: "Missing required parameters: roomId or messageText" });
        }

        const msgRef = rtdb.ref(`messages/${roomId}`).push();
        const timestamp = Date.now();

        const systemMessage = {
          senderId: "SYSTEM",
          receiverId: "ALL",
          type: "text",
          text: `🚨 [تنبيه إداري رسمي]: ${messageText}`,
          createdAt: timestamp,
          status: "sent"
        };

        await msgRef.set(systemMessage);

        await rtdb.ref(`chatRooms/${roomId}`).update({
          lastMessage: `🚨 تنبيه إداري: ${messageText}`,
          lastMessageTime: timestamp
        });

        return res.status(200).json({ success: true, message: "تم إرسال التنبيه والتحذير الإداري للغرفة بنجاح وبثه حياً." });
      }

      if (action === 'admin_clear_room') {
        if (!roomId) {
          return res.status(400).json({ error: "Missing required parameter: roomId" });
        }

        await rtdb.ref(`messages/${roomId}`).set(null);

        await rtdb.ref(`chatRooms/${roomId}`).update({
          lastMessage: "🚫 تم تفريغ وحذف محتوى المحادثة من الإدارة",
          lastMessageTime: Date.now()
        });

        return res.status(200).json({ success: true, message: "🗑️ تم تفريغ وحذف محتوى المحادثة نهائياً بنجاح وتصفيته." });
      }
    }

  } catch (error) {
    console.error("Admin API Internal Error Details:", error);
    return res.status(500).json({ error: "Failed to process request: " + error.message });
  }
      }
