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

  // إشعار طلب سحب مالي
  async withdraw(data) {
    await sendTelegramNotification(`
💸 <b>طلب سحب مالي جديد</b>

👤 <b>الاسم:</b> ${data.name || "غير محدد"}
💰 <b>المبلغ المطلوب:</b> ${Number(data.amount || 0).toLocaleString()} ج.م
💳 <b>وسيلة السحب:</b> ${data.method || "غير محددة"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار رسالة جديدة في الشات
  async newMessage(data) {
    await sendTelegramNotification(`
💬 <b>رسالة جديدة داخل غرفة تفاوض</b>

🏠 <b>العقار:</b> ${data.property || "غير محدد"}
👤 <b>المرسل:</b> ${data.sender || "غير محدد"}

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  },

  // إشعار تقديم بلاغ
  async report(data) {
    await sendTelegramNotification(`
🚨 <b>بلاغ جديد عن مخالفة</b>

🏠 <b>العقار:</b> ${data.property || "غير محدد"}
👤 <b>المبلغ:</b> ${data.user || "غير معروف"}
📄 <b>السبب:</b>
<i>${data.reason || "لا يوجد"}</i>

🕒 ${new Date().toLocaleString("ar-EG")}
`);
  }
};
