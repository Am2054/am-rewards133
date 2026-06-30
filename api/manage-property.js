// /api/manage-property.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// تهيئة Firebase Admin بنفس طريقتك الذكية
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      initializeApp({ credential: cert(serviceAccount) });
    }
  } catch (error) { 
    console.error("Firebase Init Error:", error.message); 
  }
}

const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  // إعدادات CORS للـ Serverless Functions
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'الطريقة غير مسموح بها، استخدم POST فقط' });
  }

  const { propertyId, action, reason } = req.body;
  const authHeader = req.headers.authorization;

  // التحقق من المدخلات الأساسية
  if (!propertyId || !action) {
    return res.status(400).json({ error: 'الحقول الأساسية (propertyId, action) مطلوبة' });
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح بالوصول، التوكن مفقود' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // التحقق من التوكن وصلاحية الأدمن
    const decodedToken = await auth.verifyIdToken(idToken);
    
    // تأكيد حساب الأدمن الخاص بك
    if (decodedToken.email !== "ahmed_admin@example.com") {
      return res.status(403).json({ error: 'عذراً، لا تملك صلاحيات المسؤول الإدارية' });
    }

    const docRef = db.collection('properties').doc(propertyId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({ error: 'مستند العقار غير موجود بالنظام' });
    }

    // معالجة الطلب بناءً على الـ action المرسل من الـ Frontend
    if (action === 'approve') {
      await docRef.update({
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        rejectReason: FieldValue.delete() // حذف سبب الرفض القديم إن وجد
      });
      return res.status(200).json({ success: true, message: 'تمت الموافقة على العقار ونشره بنجاح!' });

    } else if (action === 'reject') {
      if (!reason || reason.trim() === '') {
        return res.status(400).json({ error: 'يجب تحديد سبب الرفض لإشعار المستثمر' });
      }
      await docRef.update({
        status: 'rejected',
        rejectReason: reason,
        rejectedAt: FieldValue.serverTimestamp()
      });
      return res.status(200).json({ success: true, message: 'تم رفض العقار بنجاح وتوثيق السبب.' });

    } else {
      return res.status(400).json({ error: 'الإجراء المطلوب (action) غير مدعوم' });
    }

  } catch (error) {
    console.error("Manage Property API Error:", error.message);
    return res.status(500).json({ error: 'حدث خطأ في السيرفر الداخلي: ' + error.message });
  }
}
