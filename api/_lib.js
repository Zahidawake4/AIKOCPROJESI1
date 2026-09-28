// Ortak yardımcılar (dosya adı "_" ile başladığı için Vercel bunu endpoint yapmaz)

const FIREBASE_WEB_API_KEY =
  process.env.FIREBASE_WEB_API_KEY || "AIzaSyCKnWNJ7klhbhPpnieqy55WNag-PaOYrUc";

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Firebase ID token'ı doğrular, geçerliyse kullanıcının uid'sini döndürür.
// Böylece giriş yapmamış biri API anahtarını kullanamaz.
export async function verifyUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  try {
    const r = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return data.users?.[0]?.localId || null;
  } catch {
    return null;
  }
}

// Gemini REST çağrısı (harici paket yok, sadece fetch)
export async function callGemini({ system, parts, temperature = 0.4, maxOutputTokens = 4096 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("Sunucuda GEMINI_API_KEY tanımlı değil (Vercel > Settings > Environment Variables).");
    err.status = 500;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature, maxOutputTokens },
  };

  // Geçici hatalarda (429/503) bir kez tekrar dene
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });

    if (r.ok) {
      const data = await r.json();
      const text = (data.candidates?.[0]?.content?.parts || [])
        .map((p) => p.text || "")
        .join("")
        .trim();
      if (!text) {
        const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || "boş yanıt";
        const err = new Error(`Gemini yanıt üretmedi (${reason}).`);
        err.status = 502;
        throw err;
      }
      return text;
    }

    if ((r.status === 429 || r.status === 503) && attempt === 0) {
      await new Promise((res) => setTimeout(res, 1500));
      continue;
    }

    let detail = "";
    try {
      detail = (await r.json()).error?.message || "";
    } catch {}
    const err = new Error(`Gemini hatası (${r.status}): ${detail}`);
    err.status = r.status === 429 ? 429 : 502;
    throw err;
  }
}

export function sendError(res, error) {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || "Bilinmeyen sunucu hatası" });
}
