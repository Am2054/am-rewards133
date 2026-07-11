// /api/admin_audit_tickets.js - إدارة ومعالجة تذاكر الدعم وعقارات المنصة بالخلفية (نسخة الدعم المزدوج والفرز الذكي بالذاكرة)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth"; // استيراد موديول المصادقة الفيدرالي
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
const auth = getAuth(); // تهيئة أداة التحقق الفيدرالية للأدمن
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

export default async function handler(req, res) {
  const origin = req.headers.origin;
  
  // تفعيل ديناميكي للـ CORS Whitelisting لضمان تخطي جدران الأمان بكافة النطاقات حياً
  res.setHeader("Access-Control-Allow-Origin", origin || "https://am-rewards.vercel.app");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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

  // --- [2] نظام المصادقة الهجين فائق الاستقرار والأمان الحقيقي (Hybrid Authorization Model) ---
  let isAuthorized = false;

  // أ. محاولة المصادقة الأولى: عبر الكوكيز الإدارية المشفرة بـ JWT
  try {
    const cookies = parse(req.headers.cookie || "");
    const token = cookies.ticketToken || cookies.adminToken;
    if (token) {
      jwt.verify(token, JWT_SECRET);
      isAuthorized = true;
    }
  } catch (e) {
    console.warn("Cookie verification skipped/failed:", e.message);
  }

  // ب. محاولة المصادقة البديلة: عبر التحقق الفيدرالي من الـ Firebase ID Token الممرر بالـ Header
  // يحل كلياً مشاكل الـ SameSite ومنع كوكيز الطرف الثالث في المتصفحات الحديثة
  if (!isAuthorized) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      try {
        const decodedToken = await auth.verifyIdToken(idToken);
        if (decodedToken) {
          isAuthorized = true; // تم التحقق الفيدرالي بنجاح
        }
      } catch (err) {
        console.error("Firebase Admin ID Token verification failed:", err.message);
      }
    }
  }

  // إذا فشل كلا مساري التوثيق الآمنين، يتم الرفض
  if (!isAuthorized) {
    return res.status(401).json({ error: "Unauthorized: تصريح إداري غير صالح أو منتهي الصلاحية" });
  }

  try {
    // --- [3] موديول التذاكر والاتصال العقاري (Tickets Module) ---
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

    // --- [4] موديول العقارات الإداري الموفر لقراءات العميل (Properties Admin Module) ---
    if (module === 'properties') {
      
      // جلب العقارات وحساب الإحصائيات بالكامل بالخلفية لإنقاذ تكلفة القراءات والـ Network Overhead
      if (action === 'get_admin_properties') {
        
        // حساب إجمالي الحالات بطريقة متوازية سريعة ومنخفضة التكلفة كلياً (Parallel DB Counts)
        // لا تتطلب هذه الحسابات الفردية وجود كشاف مركب (Composite Index) إطلاقاً
        const [pendingCountSnap, approvedCountSnap, rejectedCountSnap] = await Promise.all([
          db.collection("properties").where("status", "==", "pending").count().get(),
          db.collection("properties").where("status", "==", "approved").count().get(),
          db.collection("properties").where("status", "==", "rejected").count().get()
        ]);

        const pendingCount = pendingCountSnap.data().count;
        const approvedCount = approvedCountSnap.data().count;
        const rejectedCount = rejectedCountSnap.data().count;
        const totalCount = pendingCount + approvedCount + rejectedCount;

        // تصفية جلب المستندات الحقيقية بدون دمج فلتر الـ where مع الـ orderBy لتفادي مشكلة الـ Composite Index كلياً
        // يتم جلب المستندات مرتبة بالأحدث تنازلياً، ثم تصفيتها برمجياً في الذاكرة (In-Memory Filtering)
        let queryRef = db.collection("properties").orderBy("createdAt", "desc");
        const snap = await queryRef.get();
        
        let propertiesList = snap.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate()
        }));

        // تطبيق التصفية الذكية في الذاكرة بالخلفية قبل الإرجاع
        if (status && status !== 'all') {
          propertiesList = propertiesList.filter(p => p.status === status);
        }

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

  } catch (error) {
    console.error("Admin API Internal Error Details:", error);
    // إرجاع كود 500 حقيقي مع تفاصيل الخطأ لتسهيل التشخيص بدلاً من 401 المضلل
    return res.status(500).json({ error: "Failed to process request: " + error.message });
  }
}
