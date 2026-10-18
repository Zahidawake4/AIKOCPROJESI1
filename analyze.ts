import { generateJson } from "./gemini.js";
import { VISION_SCHEMA, VISION_SYSTEM } from "./prompts.js";
import { slug } from "./taxonomy.js";
import {
  ERROR_TYPES, IMAGE_TYPES,
  type DownloadedImage, type ErrorPattern, type ErrorType,
  type ImageType, type SectionResult, type VisionResult,
} from "./types.js";

const toInt = (v: unknown, max = 500): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null;

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeSection(raw: Record<string, unknown>, issues: string[]): SectionResult | null {
  const subject = typeof raw.subject === "string" ? raw.subject.trim().slice(0, 60) : "";
  if (!subject) return null;
  const topic = (typeof raw.topic === "string" && raw.topic.trim() ? raw.topic.trim() : "Genel").slice(0, 80);

  const correct = toInt(raw.correct);
  const wrong = toInt(raw.wrong);
  const blank = toInt(raw.blank);
  const totalQuestions = toInt(raw.totalQuestions);

  if (totalQuestions !== null && (correct ?? 0) + (wrong ?? 0) + (blank ?? 0) > totalQuestions) {
    issues.push(`${subject}: doğru+yanlış+boş toplam soru sayısını aşıyor.`);
  }

  const patterns: ErrorPattern[] = (Array.isArray(raw.errorPatterns) ? raw.errorPatterns : [])
    .map((p: any) => ({
      type: (ERROR_TYPES as readonly string[]).includes(p?.type) ? (p.type as ErrorType) : "belirsiz",
      description: typeof p?.description === "string" ? p.description.slice(0, 200) : "",
    }))
    .filter((p) => p.description)
    .slice(0, 5);

  const numbers = (Array.isArray(raw.wrongQuestionNumbers) ? raw.wrongQuestionNumbers : [])
    .map((n) => toInt(n, 200))
    .filter((n): n is number => n !== null && n > 0)
    .slice(0, 60);

  return {
    subject,
    subjectKey: slug(subject),
    topic,
    topicKey: slug(topic),
    correct, wrong, blank, totalQuestions,
    // Net'i modele bırakmayız: sayılardan biz hesaplarız
    net: correct !== null && wrong !== null ? round2(correct - wrong / 4) : null,
    wrongQuestionNumbers: numbers,
    errorPatterns: patterns,
    evidence: typeof raw.evidence === "string" ? raw.evidence.slice(0, 300) : "",
  };
}

export function normalizeVision(raw: unknown): VisionResult {
  if (typeof raw !== "object" || raw === null) throw new Error("Geçersiz Gemini çıktısı");
  const o = raw as Record<string, unknown>;

  const issues: string[] = (Array.isArray(o.issues) ? o.issues : [])
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.slice(0, 200))
    .slice(0, 8);

  const imageType: ImageType = (IMAGE_TYPES as readonly string[]).includes(o.imageType as string)
    ? (o.imageType as ImageType) : "diger";
  const confidence = typeof o.confidence === "number" ? Math.min(1, Math.max(0, o.confidence)) : 0;

  const sections = (Array.isArray(o.sections) ? o.sections : [])
    .map((s) => normalizeSection(s as Record<string, unknown>, issues))
    .filter((s): s is SectionResult => s !== null)
    .slice(0, 20);

  const examType = o.examType === "TYT" || o.examType === "AYT" ? o.examType : "bilinmiyor";
  const examDate = typeof o.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.examDate) ? o.examDate : null;

  return {
    imageType, confidence, examType, examDate, sections, issues,
    needsReview: o.needsReview === true || confidence < 0.6 || issues.some((i) => i.includes("aşıyor")),
  };
}

export function analyzeImage(img: DownloadedImage): Promise<VisionResult> {
  return generateJson<VisionResult>({
    system: VISION_SYSTEM,
    parts: [
      { text: "Bu görseli kurallara göre analiz et." },
      { inlineData: { mimeType: img.mimeType, data: img.base64 } },
    ],
    schema: VISION_SCHEMA,
    validate: normalizeVision,
    temperature: 0.1,
  });
}
