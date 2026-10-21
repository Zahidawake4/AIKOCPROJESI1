import { db, requireUid } from "../lib/firebase.js";
import { route } from "../lib/http.js";
import { generateWeeklyPlan, weekStartTR } from "../lib/planner.js";

// Haftalık program: AI başarısız olsa bile yedek planla HER ZAMAN bir plan döner.
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const database = db();

  // 60 sn içinde tekrar istenirse mevcut planı döndür (gereksiz AI çağrısı olmasın)
  try {
    const existing = (await database.doc(`users/${uid}/weeklyPlans/${weekStartTR()}`).get()).data();
    if (existing?.generatedAt && Date.now() - Date.parse(existing.generatedAt) < 60_000) {
      res.status(200).json({ plan: existing, source: existing.source ?? "ai", note: existing.note ?? null, cached: true });
      return;
    }
  } catch (e) { console.error("Plan önbellek okuma:", e); }

  let profile: Record<string, unknown> = {};
  try { profile = (await database.doc(`users/${uid}`).get()).data() ?? {}; }
  catch (e) { console.error("Profil okuma:", e); }

  const result = await generateWeeklyPlan(uid, {
    goal: typeof profile.goal === "string" ? profile.goal : undefined,
    dailyHours: Number(profile.dailyHours) || 4,
  });
  res.status(200).json({ ...result, cached: false });
});
