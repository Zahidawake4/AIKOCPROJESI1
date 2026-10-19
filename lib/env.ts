function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Eksik ortam değişkeni: ${key}`);
  return v;
}

// Getter'lar tembel çalışır: değişken sadece kullanıldığında zorunlu olur.
export const env = {
  get appUrl() { return need("APP_URL").replace(/\/$/, ""); },
  get googleClientId() { return need("GOOGLE_CLIENT_ID"); },
  get googleClientSecret() { return need("GOOGLE_CLIENT_SECRET"); },
  get tokenEncKey() { return need("TOKEN_ENC_KEY"); },           // openssl rand -base64 32
  get serviceAccount() { return need("FIREBASE_SERVICE_ACCOUNT"); }, // servis hesabı JSON'u (tek satır)
  get geminiKey() { return need("GEMINI_API_KEY"); },
  get cronSecret() { return need("CRON_SECRET"); },
  get geminiModel() { return process.env.GEMINI_MODEL || "gemini-2.5-flash"; },
};
