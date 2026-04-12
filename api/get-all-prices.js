import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_KEY.trim());
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    initializeApp({ credential: cert(serviceAccount) });
}

export default async function handler(req, res) {
    try {
        // جلب العملات والكريبتو
        const fxRes = await fetch(`https://open.er-api.com/v6/latest/USD`);
        const fxData = await fxRes.json();
        const cryptoRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
        const cryptoData = await cryptoRes.json();

        const prices = {
            currency: [
                { name: "الدولار الأمريكي", price: fxData.rates.EGP.toFixed(2), symbol: "EGP" },
                { name: "اليورو", price: (fxData.rates.EGP / fxData.rates.EUR).toFixed(2), symbol: "EGP" }
            ],
            gold: [
                { name: "ذهب عيار 24", price: "4050", symbol: "EGP" }, // استرشادي
                { name: "ذهب عيار 21", price: "3550", symbol: "EGP" }
            ],
            crypto: [
                { name: "Bitcoin", price: cryptoData.bitcoin.usd.toLocaleString(), symbol: "$" },
                { name: "Ethereum", price: cryptoData.ethereum.usd.toLocaleString(), symbol: "$" }
            ]
        };
        return res.status(200).json(prices);
    } catch (e) {
        return res.status(500).json({ error: "خطأ في السيرفر" });
    }
}
