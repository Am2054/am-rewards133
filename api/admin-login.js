import jwt from "jsonwebtoken";
import { serialize } from "cookie";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  const { email, password, fingerprint } = req.body;

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    // دمج بصمة الجهاز داخل التوكن لضمان عدم تشغيله من جهاز آخر
    const token = jwt.sign(
      { email, role: "admin", device: fingerprint }, 
      JWT_SECRET, 
      { expiresIn: "2h" }
    );

    // إرسال الكوكي بإعدادات أمان قصوى
    res.setHeader("Set-Cookie", serialize("adminToken", token, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 7200
    }));

    return res.status(200).json({ success: true });
  }

  return res.status(401).json({ message: "بيانات غير صحيحة" });
}
