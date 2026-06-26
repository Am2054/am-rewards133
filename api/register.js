// /api/register.js - معالج التسجيل المحسّن مع تعريب كامل الأخطاء
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import fetch from 'node-fetch';

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
    console.error("خطأ في تهيئة Firebase:", error.message); 
  }
}

const db = getFirestore();
const auth = getAuth();

async function checkVPN(ip) {
  try {
    const response = await fetch(`https://vpnapi.io/?ip=${ip}&key=${process.env.VPN_API_KEY}`);
    const data = await response.json();
    return data.security?.vpn || false;
  } catch (e) {
    console.warn("فشل التحقق من VPN:", e.message);
    return false;
  }
}

class FraudDetection {
  static async analyzeSignup(userData, ip, fingerprint) {
    let riskScore = 0;
    const reasons = [];

    // ✅ تقليل الصرامة - بصمة الجهاز
    const fpSnap = await db.collection("userDevices")
      .where("fingerprint", "==", fingerprint)
      .limit(5)
      .get();
    
    if (!fpSnap.empty) {
      riskScore += 15; // تقليل من 30
      reasons.push("تم اكتشاف بصمة جهاز مكررة (عادي - نفس المتصفح)");
    }

    // ✅ تقليل الصرامة - عنوان IP
    const ipSnap = await db.collection("registrations")
      .where("ip", "==", ip)
      .where("createdAt", ">=", new Date(Date.now() - 3600000))
      .get();
    
    if (ipSnap.size > 5) { // تغيير من 3 إلى 5
      riskScore += 20; // تقليل من 40
      reasons.push("عدة تسجيلات من نفس عنوان IP (قد يكون من نفس المنزل/الشركة)");
    }

    // ✅ التحقق الفعلي من رقم الهاتف المكرر
    const phoneSnap = await db.collection("users")
      .where("phone", "==", userData.phone)
      .limit(1)
      .get();
    
    if (!phoneSnap.empty) {
      riskScore += 100; // خطر حقيقي
      reasons.push("رقم الهاتف موجود بالفعل");
    }

    // ✅ التحقق الفعلي من البريد المكرر
    try {
      await auth.getUserByEmail(userData.email);
      riskScore += 100; // خطر حقيقي
      reasons.push("البريد الإلكتروني موجود بالفعل");
    } catch (e) {}

    return {
      riskScore,
      isSuspicious: riskScore >= 80, // تغيير من 60 إلى 80
      reasons,
      debugInfo: {
        fpCount: fpSnap.size,
        ipCount: ipSnap.size,
        phoneExists: !phoneSnap.empty,
        riskScore: riskScore
      }
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "الطريقة غير مسموح بها" });

  const { email, password, confirmPassword, name, phone, deviceId, fingerprint } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "عنوان IP مجهول";
  const userAgent = req.headers["user-agent"] || "متصفح مجهول";

  console.log(`[التسجيل] محاولة تسجيل جديدة من ${ip} - ${email}`);

  try {
    if (!email || !password || !phone || !name || !deviceId) {
      return res.status(400).json({ error: "❌ جميع الحقول مطلوبة" });
    }

    const nameParts = name.trim().split(/\s+/).filter(part => part.length > 0);
    if (nameParts.length < 3) {
      return res.status(400).json({ error: "❌ يجب إدخال الاسم ثلاثياً على الأقل (مثل: أحمد محمد علي)" });
    }

    if (!/^01[0125]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: "❌ رقم الهاتف غير صحيح (يجب أن يبدأ بـ 01 ويحتوي على 11 رقم)" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "❌ كلمة المرور ضعيفة جداً (الحد الأدنى 6 أحرف)" });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: "❌ كلمات المرور غير متطابقة" });
    }

    const fraudCheck = await FraudDetection.analyzeSignup({ email, phone }, ip, fingerprint);
    
    console.log(`[تحليل احتيال] ${email} - النقاط: ${fraudCheck.riskScore} - التفاصيل:`, fraudCheck.debugInfo);

    if (fraudCheck.isSuspicious) {
      console.warn(`[تنبيه احتيال] محاولة تسجيل عالية المخاطر من ${ip}:`, fraudCheck.reasons);
      
      await db.collection("fraudLogs").add({
        ip,
        fingerprint,
        email,
        phone,
        reasons: fraudCheck.reasons,
        riskScore: fraudCheck.riskScore,
        debugInfo: fraudCheck.debugInfo,
        timestamp: FieldValue.serverTimestamp()
      });

      return res.status(403).json({ 
        error: "❌ تم حجب التسجيل لأسباب أمنية. يرجى التواصل مع فريق الدعم على: support@amrewards.com" 
      });
    }

    // ✅ تقليل Spam - المحاولات المتكررة من نفس IP
    const rateLimitRef = db.collection("rateLimits").doc(ip.replace(/\./g, "_"));
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data();
      if (data.count >= 10 && (now - data.lastAttempt < 3600000)) { // تغيير من 5 إلى 10
        return res.status(429).json({ error: "❌ عدد محاولات التسجيل كثير. يرجى المحاولة بعد ساعة." });
      }
      if (now - data.lastAttempt > 3600000) {
        await rateLimitRef.set({ count: 1, lastAttempt: now });
      } else {
        await rateLimitRef.update({ count: FieldValue.increment(1), lastAttempt: now });
      }
    } else {
      await rateLimitRef.set({ count: 1, lastAttempt: now });
    }

    const [deviceSnap, phoneSnap, emailSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", phone).limit(1).get(),
      db.collection("users").where("email", "==", email.toLowerCase()).limit(1).get()
    ]);

    if (!deviceSnap.empty) {
      return res.status(403).json({ error: "❌ هذا الجهاز مسجل بالفعل. حد أقصى حساب واحد لكل جهاز." });
    }

    if (!phoneSnap.empty) {
      return res.status(400).json({ error: "❌ رقم الهاتف مسجل بالفعل." });
    }

    if (!emailSnap.empty) {
      return res.status(400).json({ error: "❌ البريد الإلكتروني مسجل بالفعل." });
    }

    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: email.toLowerCase(),
        password,
        displayName: name
      });
    } catch (authError) {
      console.error("خطأ Firebase Auth:", authError.code);
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: "❌ البريد الإلكتروني مسجل بالفعل." });
      }
      if (authError.code === 'auth/weak-password') {
        return res.status(400).json({ error: "❌ كلمة المرور ضعيفة جداً." });
      }
      if (authError.code === 'auth/invalid-email') {
        return res.status(400).json({ error: "❌ البريد الإلكتروني غير صحيح." });
      }
      throw authError;
    }

    const uid = userRecord.uid;

    await db.runTransaction(async (tr) => {
      tr.set(db.collection("users").doc(uid), {
        uid,
        email: email.toLowerCase(),
        name,
        phone,
        deviceId,
        isBanned: false,
        registeredIp: ip,
        createdAt: FieldValue.serverTimestamp(),
        loginStreak: 1,
        lastLoginDate: FieldValue.serverTimestamp(),
        twoFAEnabled: false,
        trustLevel: 'جديد',
        userRole: 'مستخدم عادي',
        verificationStatus: 'غير موثق'
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
        email: email.toLowerCase(),
        phone,
        ip,
        fingerprint,
        deviceId,
        timestamp: FieldValue.serverTimestamp(),
        status: "نجح"
      });
    });

    console.log(`[نجح] تم تسجيل المستخدم: ${uid} - ${email}`);

    return res.status(200).json({
      success: true,
      message: "✅ تم إنشاء الحساب بنجاح! يرجى تسجيل الدخول."
    });

  } catch (err) {
    console.error("[خطأ] خطأ التسجيل:", err);
    return res.status(500).json({ error: "❌ حدث خطأ أثناء التسجيل. يرجى محاولة لاحقاً." });
  }
}
