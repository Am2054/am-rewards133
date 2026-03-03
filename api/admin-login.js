import jwt from "jsonwebtoken";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "الطريقة غير مسموحة" });
  }

  // التعديل السحري هنا: التأكد من تحويل النص لكائن (Object)
  let data = req.body;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch (e) {
      console.error("خطأ في تحليل البيانات:", e);
    }
  }

  const { email, password } = data;

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // سطر للفحص في Vercel Logs
  console.log(`محاولة دخول: ${email} | النتيجة المتوقعة: ${ADMIN_EMAIL === email}`);

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { email: ADMIN_EMAIL, role: "admin" },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    return res.status(200).json({ token });
  }

  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
