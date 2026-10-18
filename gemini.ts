import { env } from "./env.js";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface Options<T> {
  system: string;
  parts: Part[];
  schema: object;
  validate: (raw: unknown) => T;
  temperature?: number;
  maxOutputTokens?: number;
}

async function callOnce(o: Options<unknown>): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: o.parts }],
    generationConfig: {
      temperature: o.temperature ?? 0.2,
      maxOutputTokens: o.maxOutputTokens ?? 8192,
      responseMimeType: "application/json",
      responseSchema: o.schema,
    },
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey },
      body,
    });
    if (r.ok) {
      const data = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        promptFeedback?: { blockReason?: string };
      };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!text) throw new Error(`Gemini boş yanıt döndü (${data.promptFeedback?.blockReason ?? "bilinmiyor"}).`);
      return text;
    }
    if ((r.status === 429 || r.status === 503) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Gemini hatası (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("Gemini yanıt vermedi.");
}

// JSON çıktısını şemayla ister, ayrıca kendi doğrulayıcımızdan geçirir; bozuksa bir kez daha dener.
export async function generateJson<T>(o: Options<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return o.validate(JSON.parse(await callOnce(o)));
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini çıktısı doğrulanamadı.");
}
