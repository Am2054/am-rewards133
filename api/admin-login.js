import jwt from "jsonwebtoken";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ message: "POST only" });

  let data = req.body;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (e) { }
  }

  const email = (data.email || "").trim();
  const password = (data.password || "").trim();

  // القراءة من متغيرات Vercel
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const JWT_SECRET = process.env.JWT_SECRET;

  // التحقق
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign(
      { email: email, role: "admin" }, 
      JWT_SECRET, 
      { expiresIn: "2h" }
    );
    return res.status(200).json({ token });
  }

  return res.status(401).json({ message: "بيانات الدخول غير صحيحة" });
}
