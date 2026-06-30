import { pipeline } from "stream/promises";
import { put } from "@vercel/blob";
import formidable from "formidable";
import fs from "fs";
import crypto from "crypto";

export const config = {
  api: {
    bodyParser: false,
  },
};

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

          const stream = fs.createReadStream(file.filepath);

          const filename =
            `properties/images/${Date.now()}-${crypto.randomUUID()}-${file.originalFilename}`;

          const blob = await put(filename, stream, {
  access: "public",
  contentType: mime,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
          images.push(blob.url);

        }

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

          const stream = fs.createReadStream(file.filepath);

          const filename =
            `properties/videos/${Date.now()}-${crypto.randomUUID()}-${file.originalFilename}`;

          const blob = await put(filename, stream, {
  access: "public",
  contentType: mime,
  token: process.env.BLOB_READ_WRITE_TOKEN,
});
          video = blob.url;
        }

      }

      if (images.length < 5) {
        return res.status(400).json({
          error: "You must upload at least 5 images.",
        });
      }

      if (images.length > 15) {
        return res.status(400).json({
          error: "Maximum allowed images is 15.",
        });
      }

      return res.status(200).json({

        success: true,

        coverImage: images[0],

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
