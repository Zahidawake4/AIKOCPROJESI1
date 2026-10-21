// Vercel tipleri için ek paket gerektirmeyen minimal istek/yanıt arayüzleri
export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  redirect(status: number, url: string): void;
}

export const IMAGE_TYPES = [
  "deneme_karnesi", "test_sayfasi", "soru_bankasi_sayfasi",
  "calisma_cizelgesi", "diger", "okunamadi",
] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const ERROR_TYPES = [
  "bilgi_eksigi", "kavram_eksigi", "formul_unutma", "islem_hatasi",
  "dikkat_hatasi", "yorum_hatasi", "sure_yetmedi", "belirsiz",
] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export interface ErrorPattern { type: ErrorType; description: string }

export interface SectionResult {
  subject: string;
  subjectKey: string;
  topic: string;
  topicKey: string;
  correct: number | null;
  wrong: number | null;
  blank: number | null;
  totalQuestions: number | null;
  net: number | null;
  wrongQuestionNumbers: number[];
  blankQuestionNumbers: number[];
  errorPatterns: ErrorPattern[];
  evidence: string;
}

export interface VisionResult {
  imageType: ImageType;
  confidence: number;
  needsReview: boolean;
  examType: "TYT" | "AYT" | "bilinmiyor";
  examDate: string | null;
  sections: SectionResult[];
  issues: string[];
}

export type AnalysisOrigin = "upload" | "docs";

export interface ExtractedImage { inlineObjectId: string; contentUri: string; index: number }
export interface DownloadedImage { base64: string; mimeType: string; hash: string; bytes: number }

export interface PlanTask {
  subject: string;
  topic: string;
  activity: "konu_calismasi" | "soru_cozumu" | "tekrar" | "deneme" | "hata_defteri";
  minutes: number;
  questionTarget: number | null;
  why: string;
}
export interface PlanDay { day: string; totalMinutes: number; tasks: PlanTask[] }
export interface WeeklyPlan {
  weekStart: string;
  summary: string;
  focusTopics: string[];
  days: PlanDay[];
  source?: "ai" | "fallback";
  note?: string | null;
}

export interface DocLine { text: string; style: "H1" | "H2" | "H3" | "P" | "BULLET" }
