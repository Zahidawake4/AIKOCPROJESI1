import { signState } from "../../lib/crypto.js";
import { requireUid } from "../../lib/firebase.js";
import { buildAuthUrl } from "../../lib/googleAuth.js";
import { route } from "../../lib/http.js";

// İstemci Bearer token ile çağırır, dönen URL'ye yönlenir (tarayıcı yönlendirmesi header taşıyamaz)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  res.status(200).json({ url: buildAuthUrl(signState(uid)) });
});
