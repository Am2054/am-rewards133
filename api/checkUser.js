// api/secureSignup.js - الكود المصحح

import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app'; // 💡 إضافة getApps و getApp
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// 1. الحصول على مفتاح الخدمة من متغيرات البيئة
// نستخدم المفتاح JSON مباشرة (لنفترض أنك عدلت متغير البيئة)
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const projectId = process.env.FIREBASE_PROJECT_ID || 'am-rewards'; 

let db;
let app; // تعريف كائن التطبيق

// 2. التهيئة لمرة واحدة فقط
try {
  // 💡 التعديل الحاسم: نستخدم getApps().length للتحقق من التهيئة
  if (getApps().length === 0) { 
    
    if (!serviceAccountKey) {
        throw new Error("❌ FIREBASE_SERVICE_ACCOUNT_KEY is missing from Vercel Environment Variables.");
    }
    
    app = initializeApp({
        credential: cert(JSON.parse(serviceAccountKey)), 
        projectId: projectId
    });
  } else {
    // إذا كان مهيأ بالفعل، نحصل على التطبيق الأول
    app = getApp(); 
  }
  
  db = getFirestore(app); // نستخدم app الذي تم تهيئته

} catch (error) {
  // هذا الخطأ سيظهر في سجلات Vercel بوضوح
  console.error("⛔ Firebase Admin SDK Init Failed:", error.message);
  // يجب أن نرفع خطأ لمنع الكود من الوصول إلى قاعدة البيانات
  throw new Error("SERVER CONFIG ERROR: Check Firebase Key and JSON Format."); 
}

// ----------------------------------------------------------------------
// 3. بقية الدالة (handler)
export default async function handler(req, res) {
  // ... (كود التحقق من نوع الطلب) ...

  try {
    const { email, deviceId, ip } = req.body;
    // ... (بقية منطق التحقق والتخزين)
    
    // ... (نهاية الدالة)
  } catch (err) {
    // ...
  }
}
