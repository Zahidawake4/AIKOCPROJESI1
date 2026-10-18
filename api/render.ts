import type { DocLine, VisionResult, WeeklyPlan } from "../types.js";
import type { WeaknessDoc } from "./weaknesses.js";

const ACTIVITY_LABEL: Record<string, string> = {
  konu_calismasi: "Konu çalışması", soru_cozumu: "Soru çözümü", tekrar: "Tekrar",
  deneme: "Deneme", hata_defteri: "Hata defteri",
};

// Senkron sonucunu Google Docs'a yazılacak satırlara çevirir
export function renderSyncSection(
  analyses: VisionResult[],
  weaknesses: (WeaknessDoc & { id: string })[],
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
      const err = s.errorPatterns[0] ? ` | Hata kalıbı: ${s.errorPatterns[0].description}` : "";
      lines.push({ style: "BULLET", text: `${s.subject} / ${s.topic}: ${counts}${err}` });
    }
    if (a.needsReview) lines.push({ style: "BULLET", text: `Görsel ${i + 1} için kontrol önerilir: okuma güveni düşük, sayıları doğrula.` });
  });

  if (weaknesses.length > 0) {
    lines.push({ style: "H2", text: "Kronik eksikler" });
    for (const w of weaknesses.slice(0, 5)) {
      lines.push({ style: "BULLET", text: `${w.subject} / ${w.topic}: hata oranı %${Math.round(w.chronicScore * 100)} (${w.sessions} oturum)` });
    }
  }

  if (plan) {
    lines.push({ style: "H2", text: `Haftalık program (hafta başı: ${plan.weekStart})` });
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
