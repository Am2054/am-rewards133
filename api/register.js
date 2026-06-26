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

    // التحقق من بصمة الجهاز المكررة
    const fpSnap = await db.collection("userDevices")
      .where("fingerprint", "==", fingerprint)
      .limit(5)
      .get();
    
    if (!fpSnap.empty) {
      riskScore += 30;
      reasons.push("تم اكتشاف بصمة جهاز مكررة");
    }

    // التحقق من التسجيلات المتعددة من نفس IP
    const ipSnap = await db.collection("registrations")
      .where("ip", "==", ip)
      .where("createdAt", ">=", new Date(Date.now() - 3600000))
      .get();
    
    if (ipSnap.size > 3) {
      riskScore += 40;
      reasons.push("تم اكتشاف عدة تسجيلات من نفس عنوان IP خلال ساعة واحدة");
    }

    // التحقق من رقم الهاتف المكرر
    const phoneSnap = await db.collection("users")
      .where("phone", "==", userData.phone)
      .limit(1)
      .get();
    
    if (!phoneSnap.empty) {
      riskScore += 50;
      reasons.push("رقم الهاتف موجود بالفعل في النظام");
    }

    // التحقق من البريد الإلكتروني المكرر
    try {
      await auth.getUserByEmail(userData.email);
      riskScore += 50;
      reasons.push("البريد الإلكتروني موجود بالفعل في النظام");
    } catch (e) {}

    return {
      riskScore,
      isSuspicious: riskScore >= 60,
      reasons
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "الطريقة غير مدعومة - استخدم POST فقط" });
  }

  const { email, password, confirmPassword, name, phone, deviceId, fingerprint } = req.body;
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress || "unknown_ip";
  const userAgent = req.headers["user-agent"] || "unknown";

  console.log(`[تسجيل جديد] محاولة تسجيل جديدة من ${ip} - ${email}`);

  try {
    // التحقق من وجود جميع الحقول المطلوبة
    if (!email || !password || !phone || !name || !deviceId) {
      return res.status(400).json({ error: "❌ بيانات ناقصة - يجب ملء جميع الحقول المطلوبة" });
    }

    // التحقق من الاسم الثلاثي خلفياً في الـ Backend لحماية إضافية
    const nameParts = name.trim().split(/\s+/).filter(part => part.length > 0);
    if (nameParts.length < 3) {
      return res.status(400).json({ error: "❌ الاسم يجب أن يكون ثلاثياً على الأقل (الاسم الأول - اسم الأب - الاسم الأخير)" });
    }

    // التحقق من صيغة رقم الهاتف المصري
    if (!/^01[0125]\d{8}$/.test(phone)) {
      return res.status(400).json({ error: "❌ صيغة رقم الهاتف غير صحيحة - يجب أن يبدأ بـ 01 ويكون 11 رقم" });
    }

    // التحقق من قوة كلمة المرور
    if (password.length < 6) {
      return res.status(400).json({ error: "❌ كلمة المرور ضعيفة جداً - الحد الأدنى 6 أحرف" });
    }

    // التحقق من تطابق كلمات المرور
    if (password !== confirmPassword) {
      return res.status(400).json({ error: "❌ كلمات المرور غير متطابقة" });
    }

    // تحليل الاحتيال والمخاطر
    const fraudCheck = await FraudDetection.analyzeSignup({ email, phone }, ip, fingerprint);
    
    if (fraudCheck.isSuspicious) {
      console.warn(`[تنبيه احتيال] محاولة تسجيل عالية المخاطر من ${ip}:`, fraudCheck.reasons);
      
      // تسجيل محاولة الاحتيال في قاعدة البيانات
      await db.collection("fraudLogs").add({
        ip,
        fingerprint,
        email,
        phone,
        reasons: fraudCheck.reasons,
        riskScore: fraudCheck.riskScore,
        timestamp: FieldValue.serverTimestamp()
      });

      return res.status(403).json({ 
        error: "❌ تم حظر التسجيل لأسباب أمنية - يرجى التواصل مع فريق الدعم" 
      });
    }

    // تحديد معدل الطلبات (Rate Limiting)
    const rateLimitRef = db.collection("rateLimits").doc(ip.replace(/\./g, "_"));
    const rateLimitSnap = await rateLimitRef.get();
    const now = Date.now();

    if (rateLimitSnap.exists) {
      const data = rateLimitSnap.data();
      if (data.count >= 5 && (now - data.lastAttempt < 3600000)) {
        return res.status(429).json({ error: "❌ عدد محاولات التسجيل كثير جداً - يرجى المحاولة بعد ساعة" });
      }
      if (now - data.lastAttempt > 3600000) {
        await rateLimitRef.set({ count: 1, lastAttempt: now });
      } else {
        await rateLimitRef.update({ count: FieldValue.increment(1), lastAttempt: now });
      }
    } else {
      await rateLimitRef.set({ count: 1, lastAttempt: now });
    }

    // التحقق المتوازي من تكرار البيانات
    const [deviceSnap, phoneSnap, emailSnap] = await Promise.all([
      db.collection("userDevices").where("deviceId", "==", deviceId).limit(1).get(),
      db.collection("users").where("phone", "==", phone).limit(1).get(),
      db.collection("users").where("email", "==", email.toLowerCase()).limit(1).get()
    ]);

    if (!deviceSnap.empty) {
      return res.status(403).json({ error: "❌ هذا الجهاز مسجل بالفعل - حساب واحد فقط لكل جهاز" });
    }

    if (!phoneSnap.empty) {
      return res.status(400).json({ error: "❌ رقم الهاتف مسجل بالفعل في النظام" });
    }

    if (!emailSnap.empty) {
      return res.status(400).json({ error: "❌ البريد الإلكتروني مسجل بالفعل في النظام" });
    }

    // إنشاء حساب في Firebase Authentication
    let userRecord;
    try {
      userRecord = await auth.createUser({
        email: email.toLowerCase(),
        password,
        displayName: name
      });
    } catch (authError) {
      if (authError.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: "❌ البريد الإلكتروني مسجل بالفعل" });
      }
      throw authError;
    }

    const uid = userRecord.uid;

    // حفظ بيانات المستخدم في Firestore باستخدام Transaction
    await db.runTransaction(async (tr) => {
      // حفظ بيانات المستخدم الأساسية
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
        trustLevel: 'new',
        profileComplete: false,
        role: 'user'
      });

      // حفظ معلومات الجهاز للأمان
      tr.set(db.collection("userDevices").doc(), {
        uid,
        deviceId,
        fingerprint: fingerprint || "legacy",
        ip,
        userAgent,
        createdAt: FieldValue.serverTimestamp(),
        lastUsed: FieldValue.serverTimestamp(),
        isVerified: false
      });

      // حفظ سجل التسجيل
      tr.set(db.collection("registrations").doc(), {
        uid,
        email: email.toLowerCase(),
        phone,
        ip,
        fingerprint,
        deviceId,
        timestamp: FieldValue.serverTimestamp(),
        status: "success"
      });
    });

    console.log(`[نجاح] تم تسجيل المستخدم: ${uid} - ${email}`);

    return res.status(200).json({
      success: true,
      message: "✅ تم إنشاء الحساب بنجاح! يرجى تسجيل الدخول"
    });

  } catch (err) {
    console.error("[خطأ] خطأ في التسجيل:", err);
    return res.status(500).json({ error: "❌ حدث خطأ أثناء التسجيل - يرجى المحاولة لاحقاً" });
  }
}
