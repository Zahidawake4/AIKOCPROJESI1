// @ts-ignore
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase.js";
import type { SectionResult } from "../types.js";

export interface WeaknessDoc {
  subject: string;
  topic: string;
  correct: number;
  wrong: number;
  blank: number;
  sessions: number;
  wrongSessions: number;
  errorTypes: Record<string, number>;
  chronicScore: number;
}

// Her analizdeki her ders/konu satırını kümülatif zayıflık kaydına işler (transaction ile)
export async function recordSection(uid: string, s: SectionResult): Promise<void> {
  if (s.correct === null || s.wrong === null) return; // eksik sayıyla istatistik bozulmasın
  const ref = db().doc(`users/${uid}/weaknesses/${s.subjectKey}__${s.topicKey}`);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = (snap.data() as Partial<WeaknessDoc> | undefined) ?? {};

    const correct = (d.correct ?? 0) + s.correct!;
    const wrong = (d.wrong ?? 0) + s.wrong!;
    const blank = (d.blank ?? 0) + (s.blank ?? 0);
    const sessions = (d.sessions ?? 0) + 1;
    const wrongSessions = (d.wrongSessions ?? 0) + (s.wrong! > 0 ? 1 : 0);
    const errorTypes = { ...(d.errorTypes ?? {}) };
    for (const p of s.errorPatterns) errorTypes[p.type] = (errorTypes[p.type] ?? 0) + 1;

    const attempted = correct + wrong + blank;
    const missRate = attempted > 0 ? (wrong + blank) / attempted : 0;
    // Kronik: hata oranı yüksek VE birden çok oturumda tekrarlanıyor
    const chronicScore = Math.round(missRate * Math.min(1, wrongSessions / 3) * 1000) / 1000;

    tx.set(ref, {
      subject: s.subject, topic: s.topic,
      correct, wrong, blank, sessions, wrongSessions, errorTypes, chronicScore,
      lastSeen: FieldValue.serverTimestamp(),
    });
  });
}

export async function topWeaknesses(uid: string, limit = 8): Promise<(WeaknessDoc & { id: string })[]> {
  const snap = await db().collection(`users/${uid}/weaknesses`).orderBy("chronicScore", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as WeaknessDoc) }));
}
