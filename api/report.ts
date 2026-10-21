import { requireUid } from "../lib/firebase.js";
import { route } from "../lib/http.js";
import { buildReport } from "../lib/report.js";

// Konu konu analiz + hata nedeni raporu (Firestore verisinden hesaplanır)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  res.status(200).json(await buildReport(uid));
});
