import { ERROR_LABELS, REMEDIES, dominantCause } from "./causes.js";
import { db } from "./firebase.js";
import type { ErrorType } from "./types.js";
import type { WeaknessDoc } from "./weaknesses.js";

export interface CauseCount { type: ErrorType; label: string; count: number; percent: number }
export interface TopicRow {
  subject: string;
  topic: string;
  correct: number;
  wrong: number;
  blank: number;
  attempted: number;
  missRate: number;
  sessions: number;
  chronic: boolean;
  dominantCause: ErrorType | null;
  dominantLabel: string | null;
  causes: CauseCount[];
  remedy: string;
  examples: { type: string; label: string; description: string }[];
}
export interface ReportData {
  generatedAt: string;
  totals: { topics: number; attempted: number; wrong: number; blank: number; questionsLogged: number };
  causeTotals: CauseCount[];
  topics: TopicRow[];
  weakSubjects: { subject: string; missRate: number; attempted: number }[];
  dataQuality: { analyses: number; pendingConfirm: number };
  advice: string[];
}

const pct = (n: number) => Math.round(n * 1000) / 10;

function causesOf(errorTypes: Record<string, number> | undefined, total?: number): CauseCount[] {
  const entries = Object.entries(errorTypes ?? {}).filter(([, n]) => n > 0) as [ErrorType, number][];
  const sum = total ?? entries.reduce((s, [, n]) => s + n, 0);
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, label: ERROR_LABELS[type] ?? type, count, percent: sum ? pct(count / sum) : 0 }));
}

// Konu konu hata analizi + hata nedeni dağılımı (yapay zekâ gerektirmez, Firestore verisinden hesaplanır)
export async function buildReport(uid: string): Promise<ReportData> {
  const database = db();
  const [wSnap, aSnap, qSnap] = await Promise.all([
    database.collection(`users/${uid}/weaknesses`).limit(200).get(),
    database.collection(`users/${uid}/analyses`).orderBy("createdAt", "desc").limit(100).get(),
    database.collection(`users/${uid}/questions`).limit(500).get(),
  ]);

  const topics: TopicRow[] = [];
  const causeSum: Record<string, number> = {};
  const subj: Record<string, { miss: number; attempted: number }> = {};

  for (const d of wSnap.docs) {
    const w = d.data() as Partial<WeaknessDoc>;
    const correct = w.correct ?? 0, wrong = w.wrong ?? 0, blank = w.blank ?? 0;
    const attempted = correct + wrong + blank;
    if (attempted === 0 || !w.subject) continue;

    const missRate = (wrong + blank) / attempted;
    const dom = dominantCause(w.errorTypes);
    for (const [t, n] of Object.entries(w.errorTypes ?? {})) causeSum[t] = (causeSum[t] ?? 0) + n;
    const s = (subj[w.subject] ??= { miss: 0, attempted: 0 });
    s.miss += wrong + blank; s.attempted += attempted;

    topics.push({
      subject: w.subject, topic: w.topic ?? "Genel",
      correct, wrong, blank, attempted,
      missRate: pct(missRate) / 100,
      sessions: w.sessions ?? 0,
      chronic: (w.wrongSessions ?? 0) >= 3 && missRate >= 0.3,
      dominantCause: dom,
      dominantLabel: dom ? ERROR_LABELS[dom] : null,
      causes: causesOf(w.errorTypes),
      remedy: REMEDIES[dom ?? "belirsiz"],
      examples: (w.recentCauses ?? []).slice(-3).map((c) => ({
        type: c.type, label: ERROR_LABELS[c.type as ErrorType] ?? c.type, description: c.description,
      })),
    });
  }
  topics.sort((a, b) => Number(b.chronic) - Number(a.chronic) || b.missRate - a.missRate || b.attempted - a.attempted);

  const causeTotals = causesOf(causeSum);
  const weakSubjects = Object.entries(subj)
    .map(([subject, v]) => ({ subject, missRate: pct(v.miss / v.attempted) / 100, attempted: v.attempted }))
    .sort((a, b) => b.missRate - a.missRate)
    .slice(0, 5);

  const pendingConfirm = aSnap.docs.filter((d) => d.data().needsReview === true && d.data().recorded !== true).length;
  const totals = {
    topics: topics.length,
    attempted: topics.reduce((s, t) => s + t.attempted, 0),
    wrong: topics.reduce((s, t) => s + t.wrong, 0),
    blank: topics.reduce((s, t) => s + t.blank, 0),
    questionsLogged: qSnap.size,
  };

  const advice: string[] = [];
  const topCause = causeTotals.find((c) => c.type !== "belirsiz") ?? causeTotals[0];
  if (topCause) advice.push(`En sık hata nedenin "${topCause.label}" (%${topCause.percent}). ${REMEDIES[topCause.type]}`);
  const chronic = topics.filter((t) => t.chronic).slice(0, 2);
  if (chronic.length) advice.push(`Kronik eksik konular: ${chronic.map((t) => `${t.subject} - ${t.topic}`).join(", ")}. Haftalık programda öncelik ver.`);
  if (pendingConfirm > 0) advice.push(`${pendingConfirm} analiz onayını bekliyor; sayıları kontrol edip onaylarsan istatistiğe eklenir.`);
  if (topics.length === 0) advice.push("Henüz konu bazlı veri yok. Soru çöz veya deneme karnesi/test fotoğrafı yükle.");

  return {
    generatedAt: new Date().toISOString(),
    totals, causeTotals, topics: topics.slice(0, 40), weakSubjects,
    dataQuality: { analyses: aSnap.size, pendingConfirm },
    advice,
  };
}
