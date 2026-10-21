import { ERROR_LABELS, REMEDIES } from "./causes.js";
import type { ReportData } from "./report.js";
import type { DocLine, VisionResult, WeeklyPlan } from "./types.js";

const ACTIVITY_LABEL: Record<string, string> = {
  konu_calismasi: "Konu çalışması", soru_cozumu: "Soru çözümü", tekrar: "Tekrar",
  deneme: "Deneme", hata_defteri: "Hata defteri",
};

const nums = (a: number[]) => a.slice(0, 15).join(", ");

// Senkron sonucunu Google Docs'a yazılacak satırlara çevirir
export function renderSyncSection(
  analyses: VisionResult[],
  report: ReportData | null,
  plan: WeeklyPlan | null
): DocLine[] {
  const date = new Date().toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
  const lines: DocLine[] = [{ style: "H1", text: `Koç Analizi - ${date}` }];

  lines.push({ style: "H2", text: "Okunan görseller" });
  analyses.forEach((a, i) => {
    if (a.sections.length === 0) {
      lines.push({ style: "BULLET", text: `Görsel ${i + 1}: veri okunamadı (${a.issues[0] ?? "neden belirtilmedi"}).` });
      return;
    }
    for (const s of a.sections) {
      const counts = s.correct !== null && s.wrong !== null
        ? `${s.correct}D ${s.wrong}Y ${s.blank ?? "-"}B, net ${s.net}`
        : "doğru/yanlış sayısı belirlenemedi";
      lines.push({ style: "BULLET", text: `${s.subject} / ${s.topic}: ${counts}` });
      if (s.wrongQuestionNumbers.length) lines.push({ style: "BULLET", text: `   Yanlış sorular: ${nums(s.wrongQuestionNumbers)}` });
      if (s.blankQuestionNumbers.length) lines.push({ style: "BULLET", text: `   Boş bırakılan sorular: ${nums(s.blankQuestionNumbers)}` });
      for (const p of s.errorPatterns.slice(0, 2)) {
        lines.push({ style: "BULLET", text: `   Hata nedeni (${ERROR_LABELS[p.type]}): ${p.description}` });
      }
    }
    if (a.needsReview) lines.push({ style: "BULLET", text: `Görsel ${i + 1}: okuma güveni düşük, uygulamada sayıları kontrol edip onayla.` });
  });

  if (report && report.causeTotals.length > 0) {
    lines.push({ style: "H2", text: "Hata nedenlerin (genel)" });
    for (const c of report.causeTotals.slice(0, 5)) {
      lines.push({ style: "BULLET", text: `${c.label}: ${c.count} kez (%${c.percent})` });
    }
    const top = report.causeTotals.find((c) => c.type !== "belirsiz") ?? report.causeTotals[0];
    lines.push({ style: "P", text: `Öneri (${top.label}): ${REMEDIES[top.type]}` });
  }

  if (report && report.topics.length > 0) {
    lines.push({ style: "H2", text: "Konu konu eksikler" });
    for (const t of report.topics.slice(0, 6)) {
      const cause = t.dominantLabel ? `, baskın neden: ${t.dominantLabel}` : "";
      lines.push({ style: "BULLET", text: `${t.subject} / ${t.topic}: %${Math.round(t.missRate * 100)} hata (${t.wrong}Y ${t.blank}B / ${t.attempted})${t.chronic ? ", KRONİK" : ""}${cause}` });
    }
  }

  if (plan) {
    lines.push({ style: "H2", text: `Haftalık program (hafta başı: ${plan.weekStart})` });
    if (plan.source === "fallback") lines.push({ style: "P", text: "Bu program kural tabanlı yedek planlayıcıyla hazırlandı." });
    if (plan.summary) lines.push({ style: "P", text: plan.summary });
    for (const d of plan.days) {
      lines.push({ style: "H3", text: `${d.day} - ${d.totalMinutes} dk` });
      for (const t of d.tasks) {
        const q = t.questionTarget ? `, ${t.questionTarget} soru` : "";
        lines.push({ style: "BULLET", text: `${t.subject} / ${t.topic}: ${ACTIVITY_LABEL[t.activity]} (${t.minutes} dk${q}). ${t.why}` });
      }
    }
  }
  return lines;
}
