import { db, requireUid } from "../lib/firebase.js";
import { generateText } from "../lib/gemini.js";
import { HttpError, route, sanitize } from "../lib/http.js";
import { env } from "../lib/env.js";

const lastCall = new Map<string, number>();

// Sistem testi: ortam değişkenleri, Firestore ve Gemini bağlantısını doğrular (değer sızdırmaz)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const now = Date.now();
  if (now - (lastCall.get(uid) ?? 0) < 10_000) throw new HttpError(429, "Çok sık test ettin, 10 saniye bekle.", "HEALTH_COOLDOWN");
  lastCall.set(uid, now);

  const flag = (k: string) => Boolean(process.env[k]);
  const envFlags = {
    GEMINI_API_KEY: flag("GEMINI_API_KEY"),
    FIREBASE_SERVICE_ACCOUNT: flag("FIREBASE_SERVICE_ACCOUNT"),
    APP_URL: flag("APP_URL"),
    GOOGLE_CLIENT_ID: flag("GOOGLE_CLIENT_ID"),
    GOOGLE_CLIENT_SECRET: flag("GOOGLE_CLIENT_SECRET"),
    TOKEN_ENC_KEY: flag("TOKEN_ENC_KEY"),
    CRON_SECRET: flag("CRON_SECRET"),
  };

  let firestore: { ok: boolean; error?: string } = { ok: true };
  try { await db().doc(`users/${uid}`).get(); }
  catch (e) { firestore = { ok: false, error: sanitize(e instanceof Error ? e.message : String(e)) }; }

  let gemini: { ok: boolean; model: string; error?: string } = { ok: true, model: env.geminiModel };
  try {
    const t = await generateText({ system: "Sadece 'ok' yaz.", parts: [{ text: "ping" }], maxOutputTokens: 64, thinkingBudget: 0 });
    if (!t) throw new Error("Boş yanıt");
  } catch (e) {
    gemini = { ok: false, model: env.geminiModel, error: sanitize(e instanceof Error ? e.message : String(e)) };
  }

  res.status(200).json({
    ok: firestore.ok && gemini.ok && envFlags.GEMINI_API_KEY && envFlags.FIREBASE_SERVICE_ACCOUNT,
    env: envFlags, firestore, gemini,
  });
});
