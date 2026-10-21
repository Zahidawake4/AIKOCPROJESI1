import { db, requireUid } from "../lib/firebase.js";
import { HttpError, route } from "../lib/http.js";
import type { SectionResult } from "../lib/types.js";
import { recordSection } from "../lib/weaknesses.js";

const clean = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 500 ? Math.round(v) : null;

// Güveni düşük analizde öğrenci sayıları düzeltip onaylar; ancak o zaman istatistiğe eklenir.
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const b = (req.body ?? {}) as { analysisId?: unknown; sections?: unknown };
  const id = typeof b.analysisId === "string" ? b.analysisId : "";
  if (!id || id.includes("/")) throw new HttpError(400, "Geçersiz analiz kimliği.", "BAD_ID");
  const edits = Array.isArray(b.sections) ? (b.sections as Record<string, unknown>[]) : [];

  const ref = db().doc(`users/${uid}/analyses/${id}`);
  let toRecord: SectionResult[] = [];

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpError(404, "Analiz bulunamadı.", "NOT_FOUND");
    const data = snap.data()!;
    if (data.recorded === true) throw new HttpError(409, "Bu analiz zaten istatistiğe eklenmiş.", "ALREADY_RECORDED");

    const sections = (data.sections ?? []) as SectionResult[];
    const fixed = sections.map((s, i) => {
      const e = edits.find((x) => x.index === i);
      if (!e) return s;
      const correct = clean(e.correct), wrong = clean(e.wrong), blank = clean(e.blank);
      return {
        ...s, correct, wrong, blank,
        net: correct !== null && wrong !== null ? Math.round((correct - wrong / 4) * 100) / 100 : null,
      };
    });

    toRecord = fixed;
    tx.update(ref, { sections: fixed, needsReview: false, recorded: true, confirmed: true });
  });

  let recorded = 0;
  for (const s of toRecord) {
    try { await recordSection(uid, s); if (s.correct !== null && s.wrong !== null) recorded++; }
    catch (e) { console.error("Onay/zayıflık kaydı:", e); }
  }
  res.status(200).json({ ok: true, recorded });
});
