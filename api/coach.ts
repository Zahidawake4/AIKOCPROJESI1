import { db, requireUid } from "../lib/firebase.js";
import { generateText, toHttpError } from "../lib/gemini.js";
import { HttpError, route } from "../lib/http.js";
import { COACH_SYSTEM } from "../lib/prompts.js";
import { topWeaknesses } from "../lib/weaknesses.js";

// Veriyi istemciden almaz, Firestore'dan kendisi okur (güvenilir kaynak)
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const database = db();

  const [userSnap, weak, qSnap] = await Promise.all([
    database.doc(`users/${uid}`).get(),
    topWeaknesses(uid, 10),
    database.collection(`users/${uid}/questions`).limit(200).get(),
  ]);
  if (weak.length === 0 && qSnap.empty) {
    throw new HttpError(400, "Koç yorumu için önce birkaç soru çöz veya bir deneme fotoğrafı analiz ettir.", "NO_DATA");
  }

  const user = userSnap.data() ?? {};
  const input = {
    hedef: user.goal || "belirtilmedi",
    gunlukCalismaSaati: user.dailyHours ?? null,
    cozulenSoru: qSnap.size,
    zayifKonular: weak.map((w) => ({
      ders: w.subject, konu: w.topic, hataOrani: w.chronicScore, oturum: w.sessions,
      doğru: w.correct, yanlis: w.wrong, bos: w.blank,
      hataNedenleri: w.errorTypes, sonNedenler: (w.recentCauses ?? []).slice(-3),
    })),
    sonNetKayitlari: Array.isArray(user.netHistory) ? user.netHistory.slice(-6) : [],
  };

  try {
    const advice = await generateText({
      system: COACH_SYSTEM,
      parts: [{ text: `Öğrenci verileri (JSON):\n${JSON.stringify(input).slice(0, 8000)}` }],
      temperature: 0.6,
      maxOutputTokens: 4096,
      thinkingBudget: 512,
    });
    res.status(200).json({ advice });
  } catch (e) {
    throw toHttpError(e);
  }
});
