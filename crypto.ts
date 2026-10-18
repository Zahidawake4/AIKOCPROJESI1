import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env.js";

function key(): Buffer {
  const k = Buffer.from(env.tokenEncKey, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY base64 formatında 32 byte olmalı.");
  return k;
}

// AES-256-GCM: refresh token'ı Firestore'a şifreli yazmak için
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

// OAuth "state" parametresi: kullanıcıyı callback'e güvenle taşır (CSRF koruması)
export function signState(uid: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid, exp: Date.now() + 10 * 60_000, n: randomBytes(8).toString("hex") })
  ).toString("base64url");
  const sig = createHmac("sha256", key()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(state: string | undefined): string {
  const [payload, sig] = (state ?? "").split(".");
  if (!payload || !sig) throw new Error("Geçersiz state");
  const expected = createHmac("sha256", key()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("State imzası hatalı");
  const { uid, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (Date.now() > exp) throw new Error("State süresi dolmuş");
  return uid as string;
}
