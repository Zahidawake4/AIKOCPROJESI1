import { env as processEnv } from "process";

function need(key: string): string {
  const v = processEnv[key];
  if (!v) throw new Error(`Eksik ortam değişkeni: ${key}`);
  return v;
}

// Getter'lar tembel çalışır: değişken sadece kullanıldığında zorunlu olur.
export const env = {
  get appUrl() { 
    // Vercel otomatik URL sağlar (VERCEL_URL), manuel unuttuysan çökmeyi önler
    const url = processEnv.APP_URL || (processEnv.VERCEL_URL ? `https://${processEnv.VERCEL_URL}` : "http://localhost:3000");
    return url.replace(/\/\$/, ""); 
  },
  get googleClientId() { return need("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return need("GOOGLE_CLIENT_SECRET"); },
  get tokenEncKey() { return need("TOKEN_ENC_KEY"); },          // openssl rand -base64 32
  get serviceAccount() { return need("FIREBASE_SERVICE_ACCOUNT"); }, // servis hesabı JSON'u (tek satır)
  get geminiKey() { return need("GEMINI_API_KEY"); },
  get cronSecret() { return need("CRON_SECRET"); },
  get geminiModel() { return processEnv.GEMINI_MODEL || "gemini-3.8-flash"; },
};