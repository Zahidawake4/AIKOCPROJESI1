import { ERROR_LABELS, dominantCause } from "./causes.js";
import { db } from "./firebase.js";
import { generateJson } from "./gemini.js";
import { sanitize } from "./http.js";
import { PLAN_SCHEMA, PLAN_SYSTEM } from "./prompts.js";
import { slug } from "./taxonomy.js";
import type { ErrorType, PlanDay, PlanTask, WeeklyPlan } from "./types.js";
import { topWeaknesses, type WeaknessDoc } from "./weaknesses.js";

type Weak = WeaknessDoc & { id: string };
type Activity = PlanTask["activity"];
type PlanBody = Omit<WeeklyPlan, "weekStart" | "source" | "note">;

export interface PlanResult { plan: WeeklyPlan; source: "ai" | "fallback"; note: string | null }

export const DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
const ACTIVITIES: Activity[] = ["konu_calismasi", "soru_cozumu", "tekrar", "deneme", "hata_defteri"];
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

// Türkiye saatine göre haftanın pazartesi günü (YYYY-MM-DD)
export function weekStartTR(now = new Date()): string {
  const tr = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  tr.setDate(tr.getDate() - ((tr.getDay() + 6) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${tr.getFullYear()}-${p(tr.getMonth() + 1)}-${p(tr.getDate())}`;
}

/* ====================== Yedek (kural tabanlı) plan ====================== */
interface Item { key: string; subject: string; topic: string; cause: ErrorType | null; why: string }

const STARTER: Item[] = [
  { key: "mat", subject: "Matematik", topic: "Problemler", cause: null, why: "Başlangıç planı: henüz analiz verin yok, dengeli bir başlangıç yapıldı." },
  { key: "tur", subject: "Türkçe", topic: "Paragraf", cause: null, why: "Başlangıç planı: paragraf her denemede en çok soru çıkan alanlardan biri." },
  { key: "geo", subject: "Geometri", topic: "Üçgenler", cause: null, why: "Başlangıç planı: temel geometri konularını pekiştirmek için." },
  { key: "fen", subject: "Fizik", topic: "Kuvvet ve Newton Yasaları", cause: null, why: "Başlangıç planı: fen derslerine düzenli temas için." },
];

function toItems(weak: Weak[]): Item[] {
  return weak.slice(0, 6).map((w) => {
    const cause = dominantCause(w.errorTypes);
    const attempted = w.correct + w.wrong + w.blank;
    const pct = attempted > 0 ? Math.round(((w.wrong + w.blank) / attempted) * 100) : 0;
    return {
      key: w.id,
      subject: w.subject,
      topic: w.topic,
      cause,
      why: `Hata oranın %${pct} (${w.sessions} oturum)${cause ? `, baskın neden: ${ERROR_LABELS[cause]}` : ""}.`,
    };
  });
}

function activityFor(cause: ErrorType | null): Activity {
  switch (cause) {
    case "bilgi_eksigi":
    case "kavram_eksigi": return "konu_calismasi";
    case "formul_unutma": return "tekrar";
    default: return "soru_cozumu";
  }
}

function task(it: Item, activity: Activity, minutes: number): PlanTask {
  return {
    subject: it.subject, topic: it.topic, activity, minutes: round5(minutes),
    questionTarget: activity === "soru_cozumu" ? Math.max(5, Math.round(minutes / 2.5 / 5) * 5) : null,
    why: it.why,
  };
}

function fallbackDays(items: Item[], dailyMinutes: number): PlanDay[] {
  // En zayıf konu havuzda daha sık görünür (3x, 2x, 1x...)
  const pool: Item[] = [];
  items.forEach((it, i) => { for (let k = 0; k < (i === 0 ? 3 : i === 1 ? 2 : 1); k++) pool.push(it); });

  const perDay = dailyMinutes >= 150 ? 3 : dailyMinutes >= 75 ? 2 : 1;
  const SHARES = [0.45, 0.35, 0.2];
  let ptr = 0;

  return DAYS.map((day, d) => {
    let tasks: PlanTask[] = [];

    if (d === 6) { // Pazar: hafif gün, tekrar + hata defteri
      const total = dailyMinutes * 0.6;
      const a = items[0], b = items[1] ?? items[0];
      tasks = [task(a, "tekrar", total * 0.55), task(b, "hata_defteri", total * 0.45)];
    } else if (d === 5 && dailyMinutes >= 180) { // Cumartesi: haftalık mini deneme
      const exam = round5(Math.min(120, dailyMinutes * 0.6));
      tasks = [
        { subject: "Genel", topic: "Mini deneme", activity: "deneme", minutes: exam, questionTarget: null, why: "Haftalık ilerleme kontrolü." },
        task(items[0], "hata_defteri", dailyMinutes - exam),
      ];
    } else {
      const chosen: Item[] = [];
      for (let j = 0; j < perDay; j++) {
        let it = pool[ptr % pool.length];
        for (let t = 0; chosen.includes(it) && t < pool.length; t++) { ptr++; it = pool[ptr % pool.length]; }
        ptr++;
        if (!chosen.includes(it)) chosen.push(it);
      }
      const shares = SHARES.slice(0, chosen.length);
      const sum = shares.reduce((a, b) => a + b, 0);
      tasks = chosen.map((it, j) => {
        const activity: Activity = j === 0 ? activityFor(it.cause) : j === 1 ? "soru_cozumu" : "tekrar";
        return task(it, activity, (dailyMinutes * shares[j]) / sum);
      });
    }

    // Günlük bütçeyi aşma
    let total = tasks.reduce((s, t) => s + t.minutes, 0);
    while (tasks.length > 1 && total > dailyMinutes) total -= tasks.pop()!.minutes;
    return { day, totalMinutes: total, tasks };
  });
}

export function buildFallbackPlan(weak: Weak[], dailyMinutes: number): PlanBody {
  const real = weak.filter((w) => w.wrong + w.blank > 0);
  const items = real.length > 0 ? toItems(real) : STARTER;
  const hours = Math.round((dailyMinutes / 60) * 10) / 10;
  return {
    summary: real.length > 0
      ? `Bu program, ${items.length} zayıf konuna ve günlük ${hours} saatlik çalışma sürene göre hazırlandı. En çok hata yaptığın konular hafta içine yayıldı.`
      : `Henüz analiz verin olmadığı için günlük ${hours} saate göre dengeli bir başlangıç planı hazırlandı. Soru çözdükçe ve deneme ekledikçe kişiselleşecek.`,
    focusTopics: items.slice(0, 3).map((i) => `${i.subject} - ${i.topic}`),
    days: fallbackDays(items, dailyMinutes),
  };
}

/* ====================== AI planı (esnek doğrulama) ====================== */
function normalizePlan(raw: unknown, dailyMinutes: number, backup: PlanDay[]): PlanBody {
  const o = raw as { summary?: unknown; focusTopics?: unknown; days?: unknown };
  if (!o || !Array.isArray(o.days) || o.days.length === 0) throw new Error("Plan çıktısında gün listesi yok");
  const rawDays = o.days as any[];

  let aiDayCount = 0;
  const days: PlanDay[] = DAYS.map((name, i) => {
    const src = rawDays.find((d) => typeof d?.day === "string" && slug(d.day) === slug(name)) ?? rawDays[i];
    const tasks: PlanTask[] = (Array.isArray(src?.tasks) ? src.tasks : [])
      .filter((t: any) => typeof t?.subject === "string" && t.subject.trim())
      .map((t: any) => ({
        subject: String(t.subject).trim().slice(0, 60),
        topic: String(t.topic ?? "").slice(0, 80),
        activity: ACTIVITIES.includes(t.activity) ? t.activity : "soru_cozumu",
        minutes: Math.min(240, Math.max(10, Math.round(Number(t.minutes)) || 30)),
        questionTarget: Number.isFinite(t.questionTarget) ? Math.round(t.questionTarget) : null,
        why: String(t.why ?? "").slice(0, 200),
      }));

    if (tasks.length === 0) return backup[i]; // eksik günü yedek plandan doldur
    aiDayCount++;
    let total = tasks.reduce((s, t) => s + t.minutes, 0);
    while (tasks.length > 1 && total > dailyMinutes) total -= tasks.pop()!.minutes; // bütçeyi aşma
    return { day: name, totalMinutes: total, tasks };
  });

  if (aiDayCount < 3) throw new Error("AI planı yetersiz (3 günden az)");
  return {
    summary: typeof o.summary === "string" ? o.summary.slice(0, 600) : "",
    focusTopics: Array.isArray(o.focusTopics) ? o.focusTopics.map((x) => String(x).slice(0, 80)).slice(0, 6) : [],
    days,
  };
}

/* ====================== Ana fonksiyon: asla "üretilemedi" ile bitmez ====================== */
export async function generateWeeklyPlan(
  uid: string,
  profile: { goal?: string; dailyHours?: number }
): Promise<PlanResult> {
  const dailyMinutes = Math.round(Math.min(16, Math.max(1, Number(profile.dailyHours) || 4)) * 60);
  const warnings: string[] = [];

  // 1) Veriyi oku (okuma hatası planı durdurmaz)
  let weak: Weak[] = [];
  try { weak = await topWeaknesses(uid, 8); }
  catch (e) { warnings.push("Zayıflık verisi okunamadı"); console.error("Planner/weaknesses:", e); }

  let nets: unknown[] = [];
  try {
    const recent = await db().collection(`users/${uid}/analyses`).orderBy("createdAt", "desc").limit(30).get();
    nets = recent.docs.map((d) => d.data()).filter((a) => a.imageType === "deneme_karnesi").slice(0, 5)
      .map((a) => ({ tarih: a.examDate ?? null, netler: (a.sections ?? []).map((s: any) => ({ ders: s.subject, net: s.net })) }));
  } catch (e) { console.error("Planner/analyses:", e); }

  const backupBody = buildFallbackPlan(weak, dailyMinutes);
  let body: PlanBody = backupBody;
  let source: "ai" | "fallback" = "fallback";

  // 2) AI planı dene; herhangi bir sorunda yedek plana düş
  const hasData = weak.some((w) => w.wrong + w.blank > 0);
  if (hasData) {
    try {
      const input = {
        hedef: profile.goal || "belirtilmedi",
        gunlukDakika: dailyMinutes,
        zayifKonular: weak.map((w) => ({
          ders: w.subject, konu: w.topic, hataOrani: w.chronicScore,
          oturum: w.sessions, hataTurleri: w.errorTypes, sonNedenler: (w.recentCauses ?? []).slice(-3),
        })),
        sonDenemeNetleri: nets,
      };
      body = await generateJson<PlanBody>({
        system: PLAN_SYSTEM,
        parts: [{ text: `Öğrenci verileri:\n${JSON.stringify(input).slice(0, 8000)}` }],
        schema: PLAN_SCHEMA,
        validate: (raw) => normalizePlan(raw, dailyMinutes, backupBody.days),
        temperature: 0.5,
        maxOutputTokens: 8192,
        thinkingBudget: 1024,
      });
      source = "ai";
    } catch (e) {
      const why = sanitize(e instanceof Error ? e.message : String(e));
      console.error("AI plan hatası, yedek plana geçildi:", why);
      warnings.push(`Yapay zeka planı üretilemedi, kural tabanlı yedek plan kullanıldı (${why.slice(0, 120)})`);
    }
  } else {
    warnings.push("Henüz yeterli analiz verin olmadığı için başlangıç planı hazırlandı");
  }

  const plan: WeeklyPlan = { weekStart: weekStartTR(), ...body, source, note: warnings.length ? warnings.join(". ") : null };

  // 3) Kaydet (kayıt hatası kullanıcıya planı göstermeyi engellemez)
  try {
    await db().doc(`users/${uid}/weeklyPlans/${plan.weekStart}`).set({
      ...plan,
      generatedAt: new Date().toISOString(),
      basedOn: weak.map((w) => w.id),
    });
  } catch (e) {
    console.error("Planner/kayıt:", e);
    plan.note = [plan.note, "Plan kaydedilemedi, sayfayı yenileyince görünmeyebilir"].filter(Boolean).join(". ");
  }
  return { plan, source, note: plan.note ?? null };
}
