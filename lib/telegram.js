// lib/telegram.js

export async function sendTelegramNotification(message) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    // إذا لم تكن المتغيرات مسجلة في البيئة، يتم تجاهل الإرسال لتجنب توقف السيرفر
    if (!token || !chatId) {
      console.warn("Telegram warning: Bot Token or Chat ID is missing.");
      return;
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML"
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error("Telegram API Error Response:", errData);
    }
  } catch (err) {
    console.error("Telegram Connection Error:", err.message);
  }
}
