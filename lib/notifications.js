// lib/notifications.js
import { sendTelegramNotification } from "./telegram.js";

/**
 * مركز الإشعارات الموحد
 * استدعِ:
 * await notify("new_user", {...});
 */

export async function notify(type, data = {}) {
  try {
    switch (type) {

      // ==========================
      // مستخدم جديد
      // ==========================
      case "new_user":
        return await sendTelegramNotification(`
🎉 <b>مستخدم جديد</b>

👤 <b>الاسم:</b> ${data.name}
📧 <b>البريد:</b> ${data.email}
📱 <b>الهاتف:</b> ${data.phone}

🆔 <b>UID:</b> ${data.uid}

🌍 <b>IP:</b> ${data.ip || "غير معروف"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);

      // ==========================
      // إضافة عقار
      // ==========================
      case "new_property":
        return await sendTelegramNotification(`
🏠 <b>عقار جديد</b>

📌 <b>العنوان:</b> ${data.title}

💰 <b>السعر:</b> ${data.price}

🏡 <b>النوع:</b> ${data.type}

👤 <b>المالك:</b> ${data.owner}

🆔 <b>Property ID:</b> ${data.propertyId}

🕒 ${new Date().toLocaleString("ar-EG")}
`);

      // ==========================
      // رسالة دعم
      // ==========================
      case "new_ticket":
        return await sendTelegramNotification(`
📩 <b>رسالة دعم جديدة</b>

👤 ${data.name}

📧 ${data.email}

📝 ${data.subject || ""}

🕒 ${new Date().toLocaleString("ar-EG")}
`);

      // ==========================
      // بلاغ
      // ==========================
      case "new_report":
        return await sendTelegramNotification(`
🚨 <b>بلاغ جديد</b>

🏠 ${data.property}

👤 ${data.reporter}

📄 ${data.reason}

🕒 ${new Date().toLocaleString("ar-EG")}
`);

      // ==========================
      // تسجيل دخول الأدمن
      // ==========================
      case "admin_login":
        return await sendTelegramNotification(`
🔐 <b>تم تسجيل دخول الأدمن</b>

👤 ${data.admin || "Admin"}

🌍 ${data.ip || "Unknown"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);

      default:
        console.log("Unknown notification type:", type);
        return;
    }
  } catch (err) {
    console.error("Notification Error:", err.message);
  }
  }
