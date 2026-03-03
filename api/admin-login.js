// api/admin-login.js
import jwt from "jsonwebtoken";

export default function handler(req, res) {
  // 1. السماح فقط بطلبات POST
  if (req.method !== "POST") {
    return res.status(405).json({ message: "الطريقة غير مسموحة" });
  }

  // --- التعديل الجوهري هنا لضمان قراءة البيانات ---
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      return res.status(400).json({ message: "خطأ في تنسيق البيانات المرسلة" });
    }
  }

  const { email, password } = body;

  // 2. جلب البيانات من البيئة المؤمنة
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // 3. التحقق من صحة البيانات (مع استخدام trim لإزالة أي مسافات مخفية)
  if (email && password && email.trim() === ADMIN_EMAIL && password.trim() === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { email: ADMIN_EMAIL, role: "admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.status(200).json({ token });
  }

  // 4. في حالة البيانات خطأ
  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
