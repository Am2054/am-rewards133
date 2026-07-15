// lib/notifications.js
import { sendTelegramNotification } from "./telegram.js";

export const notify = {
  // إشعار مستخدم جديد
  async newUser(data) {
    await sendTelegramNotification(`
🎉 <b>مستخدم جديد مسجل في الموقع</b>

👤 <b>الاسم:</b> ${data.name || "غير محدد"}
📧 <b>البريد:</b> ${data.email || "غير محدد"}
📱 <b>الهاتف:</b> ${data.phone || "غير محدد"}

🆔 <b>UID:</b> <code>${data.uid || "لا يوجد"}</code>
🌍 <b>IP:</b> ${data.ip || "غير معروف"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار إضافة عقار جديد
  async newProperty(data) {
    await sendTelegramNotification(`
🏠 <b>إضافة عقار جديد</b>

📌 <b>العنوان:</b> ${data.title || "غير محدد"}
🏡 <b>النوع:</b> ${data.type || "غير محدد"}
💰 <b>السعر:</b> ${Number(data.price || 0).toLocaleString()} ج.م
👤 <b>المالك:</b> ${data.owner || "غير محدد"}

🆔 <b>رقم العقار:</b> <code>${data.propertyId || "لا يوجد"}</code>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار تعديل عقار قائم
  async editProperty(data) {
    await sendTelegramNotification(`
✏️ <b>تعديل بيانات عقار</b>

📌 <b>العنوان المحدث:</b> ${data.title || "غير محدد"}
🏡 <b>النوع:</b> ${data.type || "غير محدد"}
💰 <b>السعر الجديد:</b> ${Number(data.price || 0).toLocaleString()} ج.م
👤 <b>المالك:</b> ${data.owner || "غير محدد"}

🆔 <b>رقم العقار:</b> <code>${data.propertyId || "لا يوجد"}</code>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار تذكرة دعم فني جديدة
  async newTicket(data) {
    await sendTelegramNotification(`
📩 <b>رسالة دعم جديدة</b>

👤 <b>المرسل:</b> ${data.name || "غير محدد"}
📧 <b>البريد:</b> ${data.email || "غير محدد"}
📝 <b>الرسالة:</b>
<i>${data.message || "فارغة"}</i>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار رسالة جديدة في الشات
  async newMessage(data) {
    await sendTelegramNotification(`
💬 <b>رسالة جديدة داخل غرفة تفاوض</b>

🏠 <b>العقار:</b> ${data.property || "غير محدد"}
👤 <b>المرسل:</b> ${data.sender || "غير حدد"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار تقديم بلاغ
  async report(data) {
    await sendTelegramNotification(`
🚨 <b>بلاغ جديد عن مخالفة</b>

🏠 <b>العقار:</b> ${data.property || "غير حدد"}
👤 <b>المبلغ:</b> ${data.user || "غير معروف"}
📄 <b>السبب:</b>
<i>${data.reason || "لا يوجد"}</i>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار تسجيل دخول المسؤول (الأدمن) والأمان
  async adminLogin(data) {
    let icon = "🔐";
    let statusText = "<b>تم تسجيل دخول المسؤول بنجاح</b>";
    
    if (data.status === "failed") {
      icon = "⚠️";
      statusText = "<b>فشل محاولة تسجيل دخول الأدمن!</b>";
    } else if (data.status === "locked") {
      icon = "🚨";
      statusText = "<b>تم حظر محاولة دخول للأدمن لتجاوز الحد الأقصى للمحاولات!</b>";
    }

    await sendTelegramNotification(`
${icon} ${statusText}

👤 <b>البريد المستخدم:</b> ${data.admin || "غير معروف"}
🌍 <b>عنوان الـ IP:</b> <code>${data.ip || "غير معروف"}</code>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // 🗑️ إشعار تصفية وحذف حساب مستخدم نهائياً
  async deleteAccount(data) {
    await sendTelegramNotification(`
🗑️ <b>تم حذف حساب مستخدم نهائياً من المنصة</b>

👤 <b>الاسم:</b> ${data.name || "غير محدد"}
📧 <b>البريد:</b> ${data.email || "غير معروف"}
📱 <b>الهاتف:</b> ${data.phone || "غير معروف"}

🆔 <b>معرف المستخدم UID:</b> <code>${data.uid || "لا يوجد"}</code>
🌍 <b>IP:</b> ${data.ip || "غير معروف"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  }
};
