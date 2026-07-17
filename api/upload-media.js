// /api/upload-media.js
import { v2 as cloudinary } from "cloudinary";
import formidable from "formidable";

export const config = {
  api: {
    bodyParser: false,
  },
};

// تهيئة إعدادات كلاوديناري من متغيرات بيئة Vercel الأربعة
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed",
    });
  }

  const form = formidable({
    multiples: true,
    keepExtensions: true,
    maxFileSize: 100 * 1024 * 1024,      // 100MB لكل ملف
    maxTotalFileSize: 250 * 1024 * 1024, // إجمالي الملفات
  });

  form.parse(req, async (err, fields, files) => {

    if (err) {
      console.error(err);
      return res.status(500).json({
        error: "Failed to parse request.",
      });
    }

    let uploadedFiles = files.files;

    if (!uploadedFiles) {
      return res.status(400).json({
        error: "No files uploaded.",
      });
    }

    if (!Array.isArray(uploadedFiles)) {
      uploadedFiles = [uploadedFiles];
    }

    const images = [];
    let video = null;

    try {

      for (const file of uploadedFiles) {

        const mime = file.mimetype || "";

        if (
          !mime.startsWith("image/") &&
          !mime.startsWith("video/")
        ) {
          return res.status(400).json({
            error: "Only images and one video are allowed.",
          });
        }

        // ============================================
        // معالجة صور العقارات
        // ============================================
        if (mime.startsWith("image/")) {

          if (
            ![
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/jpg"
            ].includes(mime)
          ) {
            return res.status(400).json({
              error: "Unsupported image format.",
            });
          }

          if (file.size > 10 * 1024 * 1024) {
            return res.status(400).json({
              error: "Each image must be less than 10MB.",
            });
          }

          // خيارات رفع الصور السحابية ومجلد الحفظ
          const uploadOptions = {
            folder: "properties/images",
            resource_type: "image"
          };

          if (process.env.CLOUDINARY_UPLOAD_PRESET) {
            uploadOptions.upload_preset = process.env.CLOUDINARY_UPLOAD_PRESET;
          }

          const uploadResult = await cloudinary.uploader.upload(file.filepath, uploadOptions);
          images.push(uploadResult.secure_url);
        }

        // ============================================
        // معالجة فيديو جولة العقار التوضيحية
        // ============================================
        else if (mime.startsWith("video/")) {

          if (video) {
            return res.status(400).json({
              error: "Only one video is allowed.",
            });
          }

          if (mime !== "video/mp4") {
            return res.status(400).json({
              error: "Only MP4 videos are supported.",
            });
          }

          if (file.size > 100 * 1024 * 1024) {
            return res.status(400).json({
              error: "Video must be less than 100MB.",
            });
          }

          // خيارات رفع الفيديوهات السحابية ومجلد الحفظ (مهم جداً تحديد النوع كـ video)
          const uploadOptions = {
            folder: "properties/videos",
            resource_type: "video"
          };

          if (process.env.CLOUDINARY_UPLOAD_PRESET) {
            uploadOptions.upload_preset = process.env.CLOUDINARY_UPLOAD_PRESET;
          }

          const uploadResult = await cloudinary.uploader.upload(file.filepath, uploadOptions);
          video = uploadResult.secure_url;
        }

      }

      // إرجاع مخرجات متطابقة كلياً مع كود الإضافة والتعديل لديك بالـ Frontend
      return res.status(200).json({
        success: true,
        coverImage: images[0] || null,
        images,
        video,
      });

    } catch (e) {
      console.error("UPLOAD ERROR:", e);
      return res.status(500).json({
        error: e.message,
        stack: e.stack
      });
    }

  });

    }
