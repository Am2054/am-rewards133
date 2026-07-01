// /api/manage-property.js

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// تهيئة Firebase Admin
if (!getApps().length) {
  try {
    let rawKey = process.env.FIREBASE_ADMIN_KEY;

    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey.trim());

      if (serviceAccount.private_key) {
        serviceAccount.private_key =
          serviceAccount.private_key.replace(/\\n/g, "\n");
      }

      initializeApp({
        credential: cert(serviceAccount),
      });
    }
  } catch (error) {
    console.error("Firebase Init Error:", error.message);
  }
}

const db = getFirestore();
const auth = getAuth();

// بيانات الأدمن
const ADMIN_UID = "2TbVjtXDHTVWweQRShVpqFasKwA2";
const ADMIN_EMAIL = "amir992005@gmail.com";

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "الطريقة غير مسموح بها",
    });
  }

  const { propertyId, action, reason, updateData } = req.body;
  const authHeader = req.headers.authorization;

  if (!propertyId || !action) {
    return res.status(400).json({
      error: "الحقول الأساسية مطلوبة",
    });
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "غير مصرح بالوصول، التوكن مفقود",
    });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    // التحقق من المستخدم
    const decodedToken = await auth.verifyIdToken(idToken);

    // التحقق من صلاحيات الأدمن
    if (
      decodedToken.uid !== ADMIN_UID &&
      decodedToken.email !== ADMIN_EMAIL
    ) {
      return res.status(403).json({
        error: "عذراً، لا تملك صلاحيات المسؤول",
      });
    }

    const docRef = db.collection("properties").doc(propertyId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      return res.status(404).json({
        error: "مستند العقار غير موجود بالنظام",
      });
    }

    // ==========================
    // الموافقة
    // ==========================
    if (action === "approve") {
      await docRef.update({
        status: "approved",
        approvedAt: FieldValue.serverTimestamp(),
        rejectReason: FieldValue.delete(),
      });

      return res.status(200).json({
        success: true,
        message: "تمت الموافقة على العقار ونشره بنجاح!",
      });
    }

    // ==========================
    // الرفض
    // ==========================
    if (action === "reject") {
      if (!reason || reason.trim() === "") {
        return res.status(400).json({
          error: "يجب تحديد سبب الرفض",
        });
      }

      await docRef.update({
        status: "rejected",
        rejectReason: reason,
        rejectedAt: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        success: true,
        message: "تم رفض العقار بنجاح وتوثيق السبب.",
      });
    }

    // ==========================
    // الحذف
    // ==========================
    if (action === "delete") {
      await docRef.delete();

      return res.status(200).json({
        success: true,
        message: "تم حذف العقار نهائياً بنجاح.",
      });
    }

    // ==========================
    // التعديل
    // ==========================
    if (action === "edit") {
      if (!updateData || typeof updateData !== "object") {
        return res.status(400).json({
          error: "البيانات مفقودة",
        });
      }

      delete updateData.id;
      delete updateData.createdAt;

      await docRef.update({
        ...updateData,
        lastEditedAt: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({
        success: true,
        message: "تم تحديث بيانات العقار بنجاح.",
      });
    }

    return res.status(400).json({
      error: "الإجراء المطلوب غير مدعوم",
    });
  } catch (error) {
    console.error("API Error:", error);

    return res.status(500).json({
      error: "حدث خطأ في السيرفر الداخلي: " + error.message,
    });
  }
}
