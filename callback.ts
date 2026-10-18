import { encrypt, verifyState } from "../../lib/crypto.js";
import { createNotebook } from "../../lib/docs.js";
import { db } from "../../lib/firebase.js";
import { exchangeCode } from "../../lib/googleAuth.js";
import type { Req, Res } from "../../lib/types.js";

const q = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function handler(req: Req, res: Res): Promise<void> {
  try {
    if (q(req.query.error)) throw new Error(`Kullanıcı izni reddetti: ${q(req.query.error)}`);
    const uid = verifyState(q(req.query.state));
    const code = q(req.query.code);
    if (!code) throw new Error("Yetkilendirme kodu yok");

    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Refresh token alınamadı (izni Google hesabından kaldırıp tekrar dene).");

    const database = db();
    const linkRef = database.doc(`googleLinks/${uid}`);
    let docId = (await linkRef.get()).data()?.docId as string | undefined;
    if (!docId) docId = await createNotebook(tokens.access_token, "YKS Koç Defterim");

    await linkRef.set(
      {
        encryptedRefreshToken: encrypt(tokens.refresh_token),
        docId,
        status: "active",
        scopes: tokens.scope ?? "",
        connectedAt: new Date().toISOString(),
        lastSyncAt: null,
        lastError: null,
        lock: null,
      },
      { merge: true }
    );
    await database.doc(`users/${uid}/docSync/state`).set(
      { docId, docUrl: `https://docs.google.com/document/d/${docId}/edit`, status: "active", lastSyncAt: null, lastError: null },
      { merge: true }
    );
    res.redirect(302, "/?google=connected");
  } catch (e) {
    console.error("Google callback hatası:", e);
    res.redirect(302, "/?google=error");
  }
}
