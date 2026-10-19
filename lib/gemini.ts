import { env } from "./env.js";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export class GeminiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

interface CallOptions {
  system: string;
  parts: Part[];
  schema?: object;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number; // sadece 2.5+ modellerde uygulanır
}

async function callGemini(o: CallOptions): Promise<string> {
  const model = env.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const supportsThinking = /gemini-(2\.5|3)/.test(model);

  const generationConfig: Record<string, unknown> = {
    temperature: o.temperature ?? 0.3,
    maxOutputTokens: o.maxOutputTokens ?? 8192,
  };
  if (o.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = o.schema;
  }
  if (supportsThinking && o.thinkingBudget !== undefined) {
    generationConfig.thinkingConfig = { thinkingBudget: o.thinkingBudget };
  }

  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: o.system }] },
    contents: [{ role: "user", parts: o.parts }],
    generationConfig,
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey },
      body,
    });
    if (r.ok) {
      const data = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };
      const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      if (!text) {
        const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "bilinmiyor";
        throw new GeminiError(502, `Gemini boş yanıt döndü (${why}).`);
      }
      return text;
    }
    if ((r.status === 429 || r.status === 503) && attempt < 2) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    throw new GeminiError(r.status, `Gemini hatası (${r.status}): ${(await r.text()).slice(0, 300)}`);
  }
  throw new GeminiError(502, "Gemini yanıt vermedi.");
}

export function generateText(o: Omit<CallOptions, "schema">): Promise<string> {
  return callGemini(o);
}

// JSON çıktısını şemayla ister, kendi doğrulayıcımızdan geçirir; bozuksa bir kez daha dener.
export async function generateJson<T>(
  o: CallOptions & { schema: object; validate: (raw: unknown) => T }
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 2; i++) {
    try {
      return o.validate(JSON.parse(await callGemini(o)));
    } catch (e) {
      lastError = e;
      if (e instanceof GeminiError && e.status !== 502) break; // kota/yetki hatasında tekrar deneme
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Gemini çıktısı doğrulanamadı.");
}
