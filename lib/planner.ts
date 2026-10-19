import { db } from "./firebase.js";
import { generateJson } from "./gemini.js";
import { PLAN_SCHEMA, PLAN_SYSTEM } from "./prompts.js";
import { topWeaknesses } from "./weaknesses.js";
import type { PlanDay, PlanTask, WeeklyPlan } from "./types.js";

const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const ACTIVITIES = ["konu_calismasi", "soru_cozumu", "tekrar", "deneme", "hata_defteri"];

// Türkiye saatine göre haftanın pazartesi günü (YYYY-MM-DD)
export function weekStartTR(now = new Date()): string {
  const tr = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  tr.setDate(tr.getDate() - ((tr.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tr.getFullYear()}-${p(tr.getMonth() + 1)}-${p(tr.getDate())}`;
}

function validatePlan(raw: unknown, dailyMinutes: number): Omit<WeeklyPlan, "weekStart"> {
  const o = raw as { summary?: unknown; focusTopics?: unknown; days?: unknown };
  if (!o || !Array.isArray(o.days) || o.days.length === 0) throw new Error("Geçersiz plan çıktısı");

  const days: PlanDay[] = DAYS.map((name, i) => {
    const src = (o.days as any[])[i];
    let tasks: PlanTask[] = (Array.isArray(src?.tasks) ? src.tasks : [])
      .filter((t: any) => typeof t?.subject === "string" && ACTIVITIES.includes(t?.activity))
      .map((t: any) => ({
        subject: String(t.subject).slice(0, 60),
        topic: String(t.topic ?? "").slice(0, 80),
        activity: t.activity,
        minutes: Math.min(240, Math.max(10, Math.round(Number(t.minutes) || 30))),
        questionTarget: Number.isFinite(t.questionTarget) ? Math.round(t.questionTarget) : null,
        why: String(t.why ?? "").slice(0, 200),
      }));
    // Modele güvenme: günlük bütçeyi aşan görevleri sondan kırp
    let total = tasks.reduce((s, t) => s + t.minutes, 0);
    while (tasks.length > 1 && total > dailyMinutes) total -= tasks.pop()!.minutes;
    return { day: name, totalMinutes: total, tasks };
  });

  return {
    summary: typeof o.summary === "string" ? o.summary.slice(0, 600) : "",
    focusTopics: Array.isArray(o.focusTopics) ? o.focusTopics.map(String).slice(0, 6) : [],
    days,
  };
}

export async function generateWeeklyPlan(
  uid: string,
  profile: { goal?: string; dailyHours?: number }
): Promise<WeeklyPlan> {
  const dailyMinutes = Math.round(Math.min(16, Math.max(1, profile.dailyHours ?? 4)) * 60);

  const weaknesses = await topWeaknesses(uid, 8);
  const recent = await db().collection(`users/${uid}/analyses`).orderBy("createdAt", "desc").limit(30).get();
  const nets = recent.docs
    .map((d) => d.data())
    .filter((a) => a.imageType === "deneme_karnesi")
    .slice(0, 5)
    .map((a) => ({
      tarih: a.examDate ?? null,
      netler: (a.sections ?? []).map((s: any) => ({ ders: s.subject, net: s.net })),
    }));

  const input = {
    hedef: profile.goal || "belirtilmedi",
    gunlukDakika: dailyMinutes,
    zayifKonular: weaknesses.map((w) => ({
      ders: w.subject, konu: w.topic, hataOrani: w.chronicScore,
      oturum: w.sessions, hataTurleri: w.errorTypes,
    })),
    sonDenemeNetleri: nets,
  };

  const plan = await generateJson({
    system: PLAN_SYSTEM,
    parts: [{ text: `Öğrenci verileri:\n${JSON.stringify(input)}` }],
    schema: PLAN_SCHEMA,
    validate: (raw) => validatePlan(raw, dailyMinutes),
    temperature: 0.5,
    thinkingBudget: 1024,
  });

  const weeklyPlan: WeeklyPlan = { weekStart: weekStartTR(), ...plan };
  await db().doc(`users/${uid}/weeklyPlans/${weeklyPlan.weekStart}`).set({
    ...weeklyPlan,
    generatedAt: new Date().toISOString(),
    basedOn: weaknesses.map((w) => w.id),
  });
  return weeklyPlan;
}
