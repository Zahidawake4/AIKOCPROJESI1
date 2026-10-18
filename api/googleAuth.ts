import { env } from "./env.js";

// Sadece drive.file: uygulamanın KENDİ oluşturduğu dosyalara erişir.
// Docs API de bu kapsamı kabul eder, böylece öğrencinin tüm Drive'ına erişmeyiz.
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const redirectUri = () => `${env.appUrl}/api/google/callback`;

export class TokenRevokedError extends Error {}

export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline", // refresh token için şart
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse { access_token: string; refresh_token?: string; scope?: string; error?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      ...params,
    }),
  });
  const data = (await r.json()) as TokenResponse;
  if (!r.ok) {
    if (data.error === "invalid_grant") throw new TokenRevokedError("Google izni geçersiz.");
    throw new Error(`Google token hatası: ${data.error ?? r.status}`);
  }
  return data;
}

export const exchangeCode = (code: string) =>
  tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  return (await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token;
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
}
