import { db, requireUid } from "../lib/firebase.js";
import { GeminiError } from "../lib/gemini.js";
import { HttpError, route } from "../lib/http.js";
import { generateWeeklyPlan, weekStartTR } from "../lib/planner.js";

// Google Docs bağlı olmasa da haftalık program üretir (veriler Firestore'dan okunur)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const database = db();

  const existing = (await database.doc(`users/${uid}/weeklyPlans/${weekStartTR()}`).get()).data();
  if (existing?.generatedAt && Date.now() - Date.parse(existing.generatedAt) < 60_000) {
    res.status(200).json({ plan: existing, cached: true });
    return;
  }

  const profile = (await database.doc(`users/${uid}`).get()).data() ?? {};
  try {
    const plan = await generateWeeklyPlan(uid, { goal: profile.goal, dailyHours: profile.dailyHours });
    res.status(200).json({ plan, cached: false });
  } catch (e) {
    console.error("Plan hatası:", e);
    throw new HttpError(e instanceof GeminiError && e.status === 429 ? 429 : 502, "Haftalık program şu an üretilemedi, biraz sonra tekrar dene.");
  }
});
