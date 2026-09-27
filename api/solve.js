export default async function handler(req, res) {
  // CORS ve Method kontrolü
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST istekleri kabul edilir.' });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Sistem Hatası: GEMINI_API_KEY bulunamadı.' });
    }

    const { prompt, mimeType, imageBase64 } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt eksik.' });
    }

    // İstek gövdesini hazırla
    const contents = [{ text: prompt }];
    if (imageBase64) {
      contents.push({
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: imageBase64
        }
      });
    }

    // Doğrudan Google REST API çağrısı (Ek kütüphane gerektirmez, %100 kararlıdır)
    const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: contents }] })
    });

    const data = await apiResponse.json();

    if (data.error) {
      return res.status(500).json({ error: 'Google API Hatası: ' + (data.error.message || JSON.stringify(data.error)) });
    }

    if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
      const solutionText = data.candidates[0].content.parts[0].text;
      return.status(200).json({ solution: solutionText });
    } else {
      return.status(500).json({ error: 'Google API boş veya geçersiz format döndürdü: ' + JSON.stringify(data) });
    }

  } catch (err) {
    return.status(500).json({ error: 'Sunucu İşlem Hatası: ' + err.message });
  }
}