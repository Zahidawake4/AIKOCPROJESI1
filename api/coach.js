import { verifyUser, callGemini, sendError } from "./_lib.js";

const SYSTEM = `Sen YKS öğrencisinin kişisel koçusun. Öğrenciyi önemsiyorsun; sıcak, motive edici ama gerçekçisin.
Sana öğrencinin verileri JSON olarak verilecek: hedefi, günlük çalışma saati, sorduğu sorular (ders/konu bazında hata sayıları) ve net geçmişi.

KURALLAR:
1. LaTeX kullanma, düz Türkçe metin yaz. Başlıkları **kalın** yap.
2. Sadece verilen verilere dayan. Veri azsa bunu dürüstçe söyle ve abartılı çıkarım yapma.
3. Şu bölümleri yaz:
   **Genel Durum** (2-3 cümle)
   **En Zayıf 3 Konu** (neden zayıf görünüyor + nasıl çalışmalı)
   **Bu Haftaki Plan** (günlük çalışma saatine uygun, gün gün kısa plan)
   **Hedefe Uzaklık** (hedef ve net geçmişi varsa)
   **Motivasyon** (1-2 cümle)
4. En fazla 350 kelime kullan.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Sadece POST desteklenir." });
  }

  try {
    const uid = await verifyUser(req);
    if (!uid) return res.status(401).json({ error: "Oturum doğrulanamadı. Lütfen tekrar giriş yap." });

    const { summary } = req.body || {};
    if (!summary || typeof summary !== "object") {
      return res.status(400).json({ error: "Özet veri eksik." });
    }

    const payload = JSON.stringify(summary).slice(0, 6000);

    const text = await callGemini({
      system: SYSTEM,
      parts: [{ text: `Öğrenci verileri (JSON):\n${payload}` }],
      temperature: 0.6,
      maxOutputTokens: 2048,
    });

    res.status(200).json({ advice: text });
  } catch (error) {
    sendError(res, error);
  }
}
