// /api/admin_audit_tickets.js - إدارة ومعالجة تذاكر الدعم وعقارات المنصة بالخلفية
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import jwt from "jsonwebtoken";
import { parse, serialize } from "cookie";

if (!getApps().length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
  } catch (e) { console.error("Firebase Init Error:", e.message); }
}

const db = getFirestore();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://am-rewards.vercel.app');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, module, password, uid, status, tId, reply, propertyId, reason } = req.body;

  // --- [1] نظام تسجيل الدخول المنفصل للتذاكر والإدارة ---
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

  // التحقق من الكوكيز
  const cookies = parse(req.headers.cookie || "");
  const adminToken = cookies.ticketToken || cookies.adminToken;
  if (!adminToken) return res.status(401).json({ error: "No Admin Token" });

  try {
    jwt.verify(adminToken, process.env.JWT_SECRET);

    // --- [2] موديول التذاكر والاتصال العقاري (Tickets Module) ---
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
          handledAt: FieldValue.serverTimestamp() 
        });
        return res.status(200).json({ success: true });
      }
    }

    // --- [3] موديول العقارات الإداري الموفر لقراءات العميل (Properties Admin Module) ---
    if (module === 'properties') {
      
      // جلب العقارات وحساب الإحصائيات بالكامل بالخلفية لإنقاذ تكلفة القراءات والـ Network Overhead
      if (action === 'get_admin_properties') {
        
        // حساب إجمالي الحالات بطريقة متوازية سريعة ومنخفضة التكلفة كلياً (Parallel DB Counts)
        const [pendingCountSnap, approvedCountSnap, rejectedCountSnap] = await Promise.all([
          db.collection("properties").where("status", "==", "pending").count().get(),
          db.collection("properties").where("status", "==", "approved").count().get(),
          db.collection("properties").where("status", "==", "rejected").count().get()
        ]);

        const pendingCount = pendingCountSnap.data().count;
        const approvedCount = approvedCountSnap.data().count;
        const rejectedCount = rejectedCountSnap.data().count;
        const totalCount = pendingCount + approvedCount + rejectedCount;

        // تصفية جلب المستندات الحقيقية بناء على تصفية الحالة المستهدفة
        let queryRef = db.collection("properties");
        if (status && status !== 'all') {
          queryRef = queryRef.where("status", "==", status);
        }

        const snap = await queryRef.orderBy("createdAt", "desc").get();
        const propertiesList = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate()
        }));

        return res.status(200).json({
          properties: propertiesList,
          stats: {
            pending: pendingCount,
            approved: approvedCount,
            rejected: rejectedCount,
            total: totalCount
          }
        });
      }

      // معالجة حالات العقار من موافقة، رفض، أو حذف نهائي
      if (action === 'approve') {
        await db.collection("properties").doc(propertyId).update({
          status: "approved",
          rejectReason: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true, message: "✅ تمت الموافقة على العقار ونشره بنجاح بالمنصة." });
      }

      if (action === 'reject') {
        await db.collection("properties").doc(propertyId).update({
          status: "rejected",
          rejectReason: reason || "لم يذكر",
          updatedAt: FieldValue.serverTimestamp()
        });
        return res.status(200).json({ success: true, message: "⚠️ تم رفض الإعلان وإشعار المعلن بالسبب بنجاح." });
      }

      if (action === 'delete') {
        await db.collection("properties").doc(propertyId).delete();
        return res.status(200).json({ success: true, message: "🗑️ تم حذف مستند العقار نهائياً من السيرفر بنجاح." });
      }
    }

  } catch (e) { 
    console.error("Admin API Error:", e.message);
    return res.status(401).json({ error: "Session Expired" }); 
  }
}
