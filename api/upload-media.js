import { put } from '@vercel/blob';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
  api: {
    bodyParser: false, // تعطيل المعالج الافتراضي لاستقبال ميديا كبيرة الحجم عبر Formidable
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const form = formidable({ multiples: true });

  return new Promise((resolve) => {
    form.parse(req, async (err, fields, files) => {
      if (err) {
        res.status(500).json({ error: 'Error processing form media files' });
        return resolve();
      }

      try {
        let incomingFiles = files.files;
        if (!incomingFiles) {
          res.status(400).json({ error: 'No media files were received' });
          return resolve();
        }

        // جعل الملفات مصفوفة دائماً للتأقلم مع المفرد والجمع
        if (!Array.isArray(incomingFiles)) {
          incomingFiles = [incomingFiles];
        }

        const imageUrls = [];
        let videoUrl = null;

        for (const file of incomingFiles) {
          const fileStream = fs.createReadStream(file.filepath);
          const uniqueFilename = `${Date.now()}_${file.originalFilename}`;

          if (file.mimetype.startsWith('image/')) {
            // رفع الصورة إلى Vercel Blob
            const blob = await put(`properties/images/${uniqueFilename}`, fileStream, {
              access: 'public',
              contentType: file.mimetype
            });
            imageUrls.push(blob.url);
          } else if (file.mimetype === 'video/mp4') {
            // التحقق من الحجم الأقصى للفيديو وهو 100 ميجابايت على الخادم
            if (file.size > 100 * 1024 * 1024) {
              res.status(400).json({ error: 'Video file size exceeds the 100MB policy limit' });
              return resolve();
            }
            const blob = await put(`properties/videos/${uniqueFilename}`, fileStream, {
              access: 'public',
              contentType: 'video/mp4'
            });
            videoUrl = blob.url;
          }
        }

        if (imageUrls.length < 5) {
          res.status(400).json({ error: 'Validation failed: Minimum 5 images required' });
          return resolve();
        }

        // إرجاع مخرجات الرفع المنظمة؛ أول صورة في الألبوم تصبح تلقائياً Cover Image للعقار
        res.status(200).json({
          images: imageUrls,
          coverImage: imageUrls[0],
          video: videoUrl
        });
        return resolve();

      } catch (uploadError) {
        console.error("Vercel Blob Upload Error:", uploadError);
        res.status(500).json({ error: 'Failed to stream files to Vercel Blob service' });
        return resolve();
      }
    });
  });
}
