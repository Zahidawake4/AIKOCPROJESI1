import { env } from "../../lib/env.js";
import { db } from "../../lib/firebase.js";
import { HttpError, route } from "../../lib/http.js";
import { syncUser } from "../../lib/syncService.js";

// Vercel Cron: CRON_SECRET tanımlıysa "Authorization: Bearer <secret>" ile çağırır
export default route(["GET"], async (req, res) => {
  if (req.headers.authorization !== `Bearer ${env.cronSecret}`) throw new HttpError(401, "Yetkisiz.");

  const snap = await db().collection("googleLinks").where("status", "==", "active").limit(50).get();
  // En uzun süredir senkronlanmayan önce (bileşik indeks gerektirmesin diye bellekte sırala)
  const ordered = snap.docs.sort(
    (a, b) => (a.data().lastSyncAt?.toMillis?.() ?? 0) - (b.data().lastSyncAt?.toMillis?.() ?? 0)
  );

  const started = Date.now();
  let ok = 0, failed = 0, skipped = 0;
  for (const d of ordered) {
    if (Date.now() - started > 240_000) { skipped++; continue; } // süre bütçesi
    try { await syncUser(d.id, { maxImages: 4 }); ok++; }
    catch (e) { failed++; console.error(`Sync hatası (${d.id}):`, e instanceof Error ? e.message : e); }
  }
  res.status(200).json({ users: ordered.length, ok, failed, skipped });
});
