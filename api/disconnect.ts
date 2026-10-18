import { decrypt } from "../crypto.js";
import { db, requireUid } from "../firebase.js";
import { revokeToken } from "./googleAuth.js";
import { route } from "../http.js";

// Bağlantıyı keser: izni Google'da iptal eder, şifreli token'ı siler. Docs belgesi ve analizler silinmez.
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const ref = db().doc(`googleLinks/${uid}`);
  const data = (await ref.get()).data();
  if (data?.encryptedRefreshToken) {
    try { await revokeToken(decrypt(data.encryptedRefreshToken)); } catch (e) { console.error(e); }
  }
  await ref.delete();
  await db().doc(`users/${uid}/docSync/state`).set({ status: "disconnected" }, { merge: true });
  res.status(200).json({ ok: true });
});
