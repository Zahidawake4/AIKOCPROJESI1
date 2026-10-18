import { signState } from "../crypto.js";
import { requireUid } from "../firebase.js";
import { buildAuthUrl } from "./googleAuth.js";
import { route } from "../http.js";

// İstemci Bearer token ile çağırır, dönen URL'ye yönlenir (tarayıcı yönlendirmesi header taşıyamaz)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  res.status(200).json({ url: buildAuthUrl(signState(uid)) });
});
