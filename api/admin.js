import { del } from '@vercel/blob';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// تهيئة Firebase Admin ببيئة الخادم السحابي
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY);

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();
const auth = getAuth();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { action, propertyId, updateData, rejectReason, idToken } = req.body;

  try {
    // 1. نظام جدار الحماية الأمني للتحقق من الصلاحيات الإدارية للمستخدم (Admin Check)
    if (!idToken) return res.status(401).json({ error: 'Access Denied: Missing authorization token' });
    const decodedToken = await auth.verifyIdToken(idToken);
    const userRecord = await auth.getUser(decodedToken.uid);
    
    // التحقق من وجود الكاستم كليم الإداري أو التحقق من قاعدة بيانات المستخدمين
    const adminDoc = await db.collection('users').doc(decodedToken.uid).get();
    const isAdmin = adminDoc.exists && adminDoc.data().role === 'admin';
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: You do not possess structural Admin privileges' });
    }

    const propRef = db.collection('properties').doc(propertyId);

    // 2. معالجة وتوجيه حركات الأكشن (Action Switch Router)
    switch (action) {
      case 'getPending': {
        const snapshot = await db.collection('properties').where('status', '==', 'pending').orderBy('createdAt', 'desc').get();
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        return res.status(200).json({ success: true, data: list });
      }

      case 'approve': {
        await propRef.update({
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: decodedToken.uid,
          updatedAt: new Date()
        });
        return res.status(200).json({ success: true, message: 'Property approved into active directory' });
      }

      case 'reject': {
        if (!rejectReason) return res.status(400).json({ error: 'A valid written rejection reason is mandatory' });
        await propRef.update({
          status: 'rejected',
          rejectReason: rejectReason,
          rejectedAt: new Date(),
          rejectedBy: decodedToken.uid,
          updatedAt: new Date()
        });
        return res.status(200).json({ success: true, message: 'Property marked as rejected successfully' });
      }

      case 'edit': {
        await propRef.update({
          ...updateData,
          updatedAt: new Date()
        });
        return res.status(200).json({ success: true, message: 'Property custom update submitted' });
      }

      case 'delete': {
        const docSnap = await propRef.get();
        if (!docSnap.exists) return res.status(404).json({ error: 'Property target document not found' });
        
        const data = docSnap.data();
        
        // مسح وحذف كافة ألبومات الصور المسجلة بـ Vercel Blob من الحاوية السحابية
        if (data.images && Array.isArray(data.images)) {
          for (const url of data.images) {
            try { await del(url); } catch (e) { console.error("Error purging image blob:", e); }
          }
        }
        // مسح ملف الفيديو المصاحب إن وُجد من Vercel Blob
        if (data.video) {
          try { await del(data.video); } catch (e) { console.error("Error purging video blob:", e); }
        }

        // الحذف النهائي والكامل لـ Document العقار من نوى الـ Firestore
        await propRef.delete();
        return res.status(200).json({ success: true, message: 'Property and associated media entirely purged' });
      }

      default:
        return res.status(400).json({ error: 'Specified execution administrative action is invalid' });
    }

  } catch (error) {
    console.error("Admin Centralized API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
