import { requireUid } from "../firebase.js";
import { route } from "../http.js";
import { syncUser } from "../syncService.js";

// "Şimdi senkronize et" düğmesi
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const summary = await syncUser(uid, { maxImages: 6, minIntervalMs: 60_000 });
  res.status(200).json(summary);
});