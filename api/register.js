// /api/register.js - معالج التسجيل المطور لسرعة قصوى (بدون فحص VPN خارجي)
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { notify } from "../lib/notifications.js"; // استيراد مركز الإشعارات الموحد

// تهيئة Firebase Admin
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

// ✅ Fraud Detection System (محلي بالكامل ومجاني ويعتمد على قاعدة بياناتك)
class FraudDetection {
  static async analyzeSignup(userData, ip, fingerprint) {
    let riskScore = 0;
    const reasons = [];

    // فحص 1: تكرار الـ Fingerprint (مؤشر احتيال لإنشاء حسابات متعددة من نفس المتصفح)
    const fpSnap = await db.collection("userDevices")
      .where("fingerprint", "==", fingerprint)
      .limit(5)
      .get();
    
    if (!fpSnap.empty) {
      riskScore += 30;
      reasons.push("Duplicate device fingerprint detected");
    }

    // فحص 2: تكرار الـ IP في وقت قصير (مؤشر احتيال لمنع هجمات الـ Spam)
    const ipSnap = await db.collection("registrations")
      .where("ip", "==", ip)
      .where("createdAt", ">=", new Date(Date.now() - 3600000)) // آخر ساعة
      .get();
    
    if (ipSnap.size > 3) {
      riskScore += 40;
      reasons.push("Multiple registrations from same IP in 1 hour");
    }

    return {
      riskScore,
      isSuspicious: riskScore >= 60, // يتم الحظر التلقائي فقط لو تخطى الـ 60 (مثلاً تكرار IP وبصمة جهاز معاً)
      reasons
    };
  }
}

// ✅ معالج التسجيل الرئيسي
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "الطريقة غير مسموح بها" });

  const { email, password, confirmPassword, name, phone, deviceId, fingerprint } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown_ip";
  const userAgent = req.headers["user-agent"] || "unknown";

  console.log(`[SIGNUP] New registration attempt from ${ip} - ${email}`);

  try {
    // ======== 1. التحقق من صحة البيانات الحسابية والمدخلات ========
    if (!email || !password || !phone || !name || !deviceId) {
      return res.status(400).json({ 
        error: "برجاء ملء جميع الحقول المطلوبة" 
      });
    }

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (cleanName.length < 3) {
      return res.status(400).json({ 
        error: "يجب أن يتكون الاسم من 3 أحرف على الأقل" 
      });
    }

    if (!/^01[0125]\d{8}$/.test(cleanPhone)) {
      return res.status(400).json({ 
        error: "صيغة رقم الهاتف غير صحيحة، يجب أن يكون رقماً مصرياً صالحاً يتكون من 11 رقماً" 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: "كلمة المرور ضعيفة للغاية (الحد الأدنى 6 أحرف)" 
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        error: "كلمات المرور غير متطابقة" 
      });
    }

    // ======== 2. التحقق من البيانات المكررة أولاً ========
    const [deviceSnap, phoneSnap, emailSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", cleanPhone).limit(1).get(),
      db.collection("users").where("email", "==", cleanEmail).limit(1).get()
    ]);

    if (!deviceSnap.empty) {
      return res.status(403).json({ 
        error: "هذا الجهاز مسجل بالفعل. مسموح بحساب واحد فقط لكل جهاز." 
      });
    }

    if (!phoneSnap.empty) {
      return res.status(400).json({ 
        error: "رقم الهاتف هذا مسجل بحساب آخر بالفعل." 
      });
    }

    if (!emailSnap.empty) {
      return res.status(400).json({ 
        error: "البريد الإلكتروني هذا مسجل بحساب آخر بالفعل." 
      });
    }

    // التحقق الإضافي من الـ Auth الخاص بـ Firebase للبريد الإلكتروني
    try {
      await auth.getUserByEmail(cleanEmail);
      return res.status(400).json({ 
        error: "البريد الإلكتروني هذا مسجل بحساب آخر بالفعل." 
      });
    } catch (e) {
      // البريد غير مكرر في الـ Auth، يمكن المتابعة بأمان
    }

    // ======== 3. كشف الاحتيال وتعدد الحسابات ========
    const fraudCheck = await FraudDetection.analyzeSignup({ email: cleanEmail, phone: cleanPhone }, ip, fingerprint);
    
    if (fraudCheck.isSuspicious) {
      console.warn(`[FRAUD ALERT] High risk signup blocked from ${ip}:`, fraudCheck.reasons);
      
      await db.collection("fraudLogs").add({
        ip,
        fingerprint: fingerprint || "legacy",
        email: cleanEmail,
        phone: cleanPhone,
        reasons: fraudCheck.reasons,
        riskScore: fraudCheck.riskScore,
        timestamp: FieldValue.serverTimestamp()
      });

      return res.status(403).json({ 
        error: "تم حظر التسجيل تلقائياً لأسباب أمنية (تعدد الحسابات أو نشاط مريب من نفس الجهاز). يرجى الاتصال بالدعم." 
      });
    }

    // ======== 4. Rate Limiting ========
    const rateLimitDocId = ip.trim().replace(/[\.\:\s]/g, "_");
    const rateLimitRef = db.collection("rateLimits").doc(rateLimitDocId);
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data();
      if (data.count >= 5 && (now - data.lastAttempt < 3600000)) {
        return res.status(429).json({ 
          error: "محاولات تسجيل كثيرة جداً من هذا الجهاز. يرجى المحاولة مرة أخرى بعد ساعة." 
        });
      }
      
      if (now - data.lastAttempt > 3600000) {
        await rateLimitRef.set({ count: 1, lastAttempt: now });
      } else {
        await rateLimitRef.update({ 
          count: FieldValue.increment(1), 
          lastAttempt: now 
        });
      }
    } else {
      await rateLimitRef.set({ count: 1, lastAttempt: now });
    }

    // ======== 5. إنشاء حساب Firebase Auth ========
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: cleanEmail,
        password,
        displayName: cleanName
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ 
          error: "البريد الإلكتروني هذا مسجل بحساب آخر بالفعل." 
        });
      }
      throw authError;
    }

    const uid = userRecord.uid;

    // ======== 6. حفظ البيانات في Firestore مع نظام التراجع الذاتي ========
    try {
      await db.runTransaction(async (tr) => {
        tr.set(db.collection("users").doc(uid), {
          uid,
          email: cleanEmail,
          name: cleanName,
          phone: cleanPhone,
          deviceId,
          points: 0,
          withdrawn: 0,
          isBanned: false,
          registeredIp: ip,
          createdAt: FieldValue.serverTimestamp(),
          loginStreak: 1,
          lastLoginDate: FieldValue.serverTimestamp(),
          totalChallengesCompleted: 0,
          challengesCompletedToday: [],
          twoFAEnabled: false,
          trustLevel: 'new'
        });

        tr.set(db.collection("userDevices").doc(), {
          uid,
          deviceId,
          fingerprint: fingerprint || "legacy",
          ip,
          userAgent,
          createdAt: FieldValue.serverTimestamp(),
          lastUsed: FieldValue.serverTimestamp()
        });

        tr.set(db.collection("registrations").doc(), {
          uid,
          email: cleanEmail,
          phone: cleanPhone,
          ip,
          fingerprint,
          deviceId,
          timestamp: FieldValue.serverTimestamp(),
          status: "success"
        });
      });

      console.log(`[SUCCESS] User registered successfully: ${uid} - ${cleanEmail}`);

      // 🔔 إرسال إشعار تليجرام للمسؤول بوجود مستخدم جديد
      // تم وضعه داخل try/catch للتأكد من أنه في حال وجود مشكلة في تليجرام، لا يتعطل تسجيل المستخدم الأصلي
      try {
        await notify.newUser({
          name: cleanName,
          email: cleanEmail,
          phone: cleanPhone,
          uid: uid,
          ip: ip
        });
      } catch (notifError) {
        console.error("[TELEGRAM WARNING] Failed to send newUser notification:", notifError.message);
      }

      return res.status(200).json({
        success: true,
        message: "✅ تم إنشاء الحساب بنجاح! جاري تسجيل الدخول..."
      });

    } catch (dbError) {
      // التراجع وحذف حساب الـ Auth فوراً في حال فشل تخزين Firestore لعدم حدوث تعليق للبيانات
      console.error("[ROLLBACK] Database transaction failed, deleting Auth user...", dbError);
      try {
        await auth.deleteUser(uid);
      } catch (authDeleteError) {
        console.error("Failed to delete orphaned Auth user:", authDeleteError.message);
      }
      throw dbError;
    }

  } catch (err) {
    console.error("[ERROR] Signup error:", err);
    return res.status(500).json({ 
      error: "حدث خطأ غير متوقع أثناء التسجيل. يرجى المحاولة مرة أخرى لاحقاً." 
    });
  }
}
