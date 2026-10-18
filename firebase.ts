import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "./env.js";
import { bearer, HttpError } from "./http.js";
import type { Req } from "./types.js";

function app() {
  return getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(env.serviceAccount)) });
}

export const db = () => getFirestore(app());

// Firebase ID token'ı doğrular, uid döndürür
export async function requireUid(req: Req): Promise<string> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "Oturum bulunamadı.");
  try {
    return (await getAuth(app()).verifyIdToken(token)).uid;
  } catch {
    throw new HttpError(401, "Oturum doğrulanamadı. Lütfen tekrar giriş yap.");
  }
}
