import { decrypt } from "../../lib/crypto.js";
import { db, requireUid } from "../../lib/firebase.js";
import { revokeToken } from "../../lib/googleAuth.js";
import { route } from "../../lib/http.js";

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
