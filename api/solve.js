export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST istekleri kabul edilir.' });
  }

  const { prompt, mimeType, imageBase64 } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API anahtarı Vercel ortamında bulunamadı.' });
  }

  try {
    // Fotoğraf varsa parts içine ekliyoruz, yoksa sadece metin gidiyor
    const parts = [{ text: prompt }];
    if (imageBase64) {
      parts.push({
        inline_data: {
          mime_type: mimeType || 'image/png',
          data: imageBase64
        }
      });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: parts }]
      })
    });

    const data = await response.json();

    // Google'dan gelen yanıtı kontrol edip script.js'in beklediği formata (data.solution) çeviriyoruz
    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
      const solutionText = data.candidates[0].content.parts[0].text;
      return res.status(200).json({ solution: solutionText });
    } else {
      return res.status(500).json({ error: 'Gemini API geçerli bir yanıt döndürmedi.' });
    }

  } catch (error) {
    console.error('Sunucu Hatası:', error);
    return res.status(500).json({ error: 'Sunucu hatası oluştu: ' + error.message });
  }
}