import { requireUid } from "../../lib/firebase.js";
import { route } from "../../lib/http.js";
import { MANUAL_SYNC_COOLDOWN_MS } from "../../lib/limits.js";
import { syncUser } from "../../lib/syncService.js";

// "Şimdi senkronize et" düğmesi
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const summary = await syncUser(uid, { minIntervalMs: MANUAL_SYNC_COOLDOWN_MS });
  res.status(200).json(summary);
});
