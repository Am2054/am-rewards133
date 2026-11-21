// /api/upload-media.js — رفع صور العقارات إلى Cloudinary (للمستخدمين المسجلين فقط)
import { v2 as cloudinary } from "cloudinary";
import formidable from "formidable";
import { verifyUser } from "../lib/verifyUser.js";

export const config = {
  api: { bodyParser: false },
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const ALLOWED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_IMAGE = 10 * 1024 * 1024; // 10MB لكل صورة

function parseForm(req) {
  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFiles: 15,
    maxFileSize: MAX_IMAGE,
    maxTotalFileSize: 40 * 1024 * 1024,
  });
  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => (err ? reject(err) : resolve(files)));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // 1) لازم مستخدم مسجل دخول (غير كده أي حد يقدر يرفع على حسابك)
  const user = await verifyUser(req);
  if (!user) {
    return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
  }

  // 2) قراءة الملفات
  let files;
  try {
    files = await parseForm(req);
  } catch (err) {
    console.error("Parse error:", err.message);
    return res.status(400).json({ error: "تعذّر قراءة الصور. تأكد أن حجم كل صورة أقل من 10MB." });
  }

  let list = files.files;
  if (!list) return res.status(400).json({ error: "لم يتم إرسال أي صورة" });
  if (!Array.isArray(list)) list = [list];

  for (const file of list) {
    if (!ALLOWED.includes(file.mimetype || "")) {
      return res.status(400).json({ error: "صيغة الصورة غير مدعومة (JPG أو PNG أو WebP فقط)" });
    }
    if (file.size > MAX_IMAGE) {
      return res.status(400).json({ error: "حجم الصورة أكبر من 10MB" });
    }
  }

  // 3) الرفع إلى Cloudinary
  try {
    const images = [];
    for (const file of list) {
      const options = {
        folder: "properties/images",
        resource_type: "image",
        tags: [user.uid], // لتتبع من رفع الصورة لو حصلت إساءة استخدام
      };
      if (process.env.CLOUDINARY_UPLOAD_PRESET) {
        options.upload_preset = process.env.CLOUDINARY_UPLOAD_PRESET;
      }
      const result = await cloudinary.uploader.upload(file.filepath, options);
      images.push(result.secure_url);
    }

    // نفس شكل الرد القديم عشان الصفحات الحالية تفضل شغالة
    return res.status(200).json({
      success: true,
      coverImage: images[0] || null,
      images,
      video: null,
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    // بدون إرسال تفاصيل الخطأ للمتصفح
    return res.status(500).json({ error: "فشل رفع الصورة، حاول مرة أخرى" });
  }
}
