import { env } from "./env.js";
import { HttpError, sanitize } from "./http.js";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export type GeminiErrorKind = "auth" | "model" | "quota" | "bad_request" | "unavailable" | "empty" | "parse" | "unknown";

export class GeminiError extends Error {
  constructor(public kind: GeminiErrorKind, public status: number, message: string) { super(message); }
}

interface CallOptions {
  system: string;
  parts: Part[];
  schema?: object;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number; // sadece 2.5+ modellerde uygulanır
}

interface RawResult { text: string; finishReason?: string; blockReason?: string; model: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function classify(status: number, body: string): GeminiErrorKind {
  const t = body.toLowerCase();
  if (status === 401 || status === 403 || t.includes("api_key_invalid") || t.includes("api key not valid") ||
      t.includes("leaked") || t.includes("permission_denied")) return "auth";
  if (status === 404) return "model";
  if (status === 429 || t.includes("resource_exhausted")) return "quota";
  if (status >= 500) return "unavailable";
  if (status === 400) return "bad_request";
  return "unknown";
}

function extractMessage(body: string): string {
  try { return (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body; }
  catch { return body; }
}

function buildBody(o: CallOptions, model: string, useThinking: boolean, useSchema: boolean): string {
  const generationConfig: Record<string, unknown> = {
    temperature: o.temperature ?? 0.3,
    maxOutputTokens: o.maxOutputTokens ?? 8192,
  };
  let system = o.system;
  if (o.schema) {
    generationConfig.responseMimeType = "application/json";
    if (useSchema) generationConfig.responseSchema = o.schema;
    else system += `\n\nSADECE geçerli JSON döndür (markdown veya açıklama yok). Şema: ${JSON.stringify(o.schema)}`;
  }
  if (useThinking && o.thinkingBudget !== undefined && /gemini-(2\.5|3)/.test(model)) {
    generationConfig.thinkingConfig = { thinkingBudget: o.thinkingBudget };
  }
  return JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: o.parts }],
    generationConfig,
  });
}

// Tek model için çağrı: geçici hatalarda tekrar dener, 400'de gelişmiş özellikleri kapatıp yeniden dener
async function callModel(model: string, o: CallOptions): Promise<RawResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let useThinking = o.thinkingBudget !== undefined;
  let useSchema = Boolean(o.schema);

  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey },
      body: buildBody(o, model, useThinking, useSchema),
    });

    if (r.ok) {
      const data = (await r.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
        promptFeedback?: { blockReason?: string };
      };
      const cand = data.candidates?.[0];
      return {
        text: (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim(),
        finishReason: cand?.finishReason,
        blockReason: data.promptFeedback?.blockReason,
        model,
      };
    }

    const bodyText = await r.text();
    const kind = classify(r.status, bodyText);
    if ((kind === "quota" || kind === "unavailable") && attempt < 3) { await sleep(1200 * (attempt + 1)); continue; }
    if (kind === "bad_request") {
      if (useThinking) { useThinking = false; continue; }
      if (useSchema) { useSchema = false; continue; }
    }
    throw new GeminiError(kind, r.status, `Gemini ${r.status}: ${sanitize(extractMessage(bodyText))}`);
  }
  throw new GeminiError("unavailable", 503, "Gemini yanıt vermedi.");
}

// Ayarlı model bulunamazsa (404) yedek modellere geç
async function callGemini(o: CallOptions): Promise<RawResult> {
  const models = [...new Set([env.geminiModel, "gemini-2.5-flash", "gemini-2.0-flash"])];
  let lastModelError: GeminiError | null = null;
  for (const m of models) {
    try { return await callModel(m, o); }
    catch (e) {
      if (e instanceof GeminiError && e.kind === "model") { lastModelError = e; continue; }
      throw e;
    }
  }
  throw lastModelError ?? new GeminiError("model", 404, "Model bulunamadı.");
}

export async function generateText(o: Omit<CallOptions, "schema">): Promise<string> {
  const res = await callGemini(o);
  if (!res.text) {
    throw new GeminiError("empty", 502, `Gemini boş yanıt döndü (${res.blockReason ?? res.finishReason ?? "bilinmiyor"}).`);
  }
  return res.text;
}

/* ---- Esnek JSON ayrıştırma: ```json çitleri, çevre metin, kesilmiş çıktı ---- */
function repairTruncated(s: string): string {
  const stack: string[] = [];
  let inString = false, escaped = false;
  for (const ch of s) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = s;
  if (inString) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  return out + stack.reverse().join("");
}

export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch { /* devam */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* devam */ }
  }
  if (start >= 0) {
    try { return JSON.parse(repairTruncated(cleaned.slice(start))); } catch { /* devam */ }
  }
  throw new GeminiError("parse", 502, "Yapay zeka çıktısı JSON olarak okunamadı.");
}

// Şemayla JSON ister, esnek ayrıştırır, kendi doğrulayıcımızdan geçirir; gerekirse bir kez daha dener.
export async function generateJson<T>(
  o: CallOptions & { schema: object; validate: (raw: unknown) => T }
): Promise<T> {
  let opts: CallOptions = o;
  let lastError: unknown;

  for (let i = 0; i < 2; i++) {
    let res: RawResult | null = null;
    try {
      res = await callGemini(opts);
      return o.validate(parseJsonLoose(res.text));
    } catch (e) {
      lastError = e;
      // yetki/kota/model hatalarında tekrar denemenin anlamı yok
      if (e instanceof GeminiError && e.kind !== "parse" && e.kind !== "empty") break;
      if (res?.finishReason === "MAX_TOKENS") {
        // çıktı kesildi: düşünme bütçesini kapat, token sınırını artır
        opts = { ...opts, maxOutputTokens: Math.min(32768, (opts.maxOutputTokens ?? 8192) * 2), thinkingBudget: 0 };
      }
    }
  }
  if (lastError instanceof GeminiError) throw lastError;
  throw new GeminiError("parse", 502, `Yapay zeka çıktısı doğrulanamadı: ${sanitize(lastError instanceof Error ? lastError.message : String(lastError))}`);
}

/* ---- Gemini hatasını kullanıcıya gösterilecek HttpError'a çevir ---- */
export function toHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof GeminiError) {
    const detail = sanitize(e.message);
    switch (e.kind) {
      case "auth":
        return new HttpError(503, "Yapay zeka servisine erişilemiyor: API anahtarı geçersiz, yetkisiz veya iptal edilmiş. Vercel'deki GEMINI_API_KEY değerini yenile.", "AI_AUTH", detail);
      case "model":
        return new HttpError(503, "Yapay zeka modeli bulunamadı. Vercel'deki GEMINI_MODEL değerini kontrol et.", "AI_MODEL", detail);
      case "quota":
        return new HttpError(429, "Yapay zeka şu an yoğun veya kotası dolu. Biraz sonra tekrar dene.", "AI_QUOTA", detail);
      case "unavailable":
        return new HttpError(503, "Yapay zeka servisi geçici olarak yanıt vermiyor. Biraz sonra tekrar dene.", "AI_BUSY", detail);
      case "empty":
        return new HttpError(502, "Yapay zeka bu görsel/istek için yanıt üretemedi (içerik filtresi olabilir).", "AI_EMPTY", detail);
      case "parse":
        return new HttpError(502, "Yapay zeka yanıtı okunamadı. Tekrar dene.", "AI_PARSE", detail);
      default:
        return new HttpError(502, "Yapay zeka isteği başarısız oldu.", "AI_ERROR", detail);
    }
  }
  return new HttpError(500, "Beklenmeyen hata.", "SERVER_ERROR", sanitize(e instanceof Error ? e.message : String(e)));
}
