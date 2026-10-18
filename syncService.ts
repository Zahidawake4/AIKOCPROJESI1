import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { analyzeImage } from "./analyze.js";
import { decrypt } from "./crypto.js";
import { appendSection, downloadImage, extractImages, getDocument } from "./docs.js";
import { db } from "./firebase.js";
import { refreshAccessToken, TokenRevokedError } from "./googleAuth.js";
import { HttpError } from "./http.js";
import { generateWeeklyPlan } from "./planner.js";
import { renderSyncSection } from "./render.js";
import type { ExtractedImage, VisionResult, WeeklyPlan } from "./types.js";
import { recordSection, topWeaknesses } from "./weaknesses.js";

export interface SyncSummary {
  found: number;
  analyzed: number;
  duplicates: number;
  failed: number;
  needsReview: number;
  planCreated: boolean;
  wroteToDoc: boolean;
}

interface Options { maxImages?: number; minIntervalMs?: number }

const chunks = <T,>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export async function syncUser(uid: string, opts: Options = {}): Promise<SyncSummary> {
  const database = db();
  const linkRef = database.doc(`googleLinks/${uid}`);
  const stateRef = database.doc(`users/${uid}/docSync/state`);
  const maxImages = opts.maxImages ?? 6;

  // 1) Kilit: aynı kullanıcı için eşzamanlı senkronu engelle
  await database.runTransaction(async (tx) => {
    const snap = await tx.get(linkRef);
    if (!snap.exists) throw new HttpError(404, "Google Docs bağlantısı bulunamadı.");
    const d = snap.data()!;
    if (d.status === "reauth_required") throw new HttpError(409, "Google iznini yeniden vermen gerekiyor.");
    if ((d.lock?.until?.toMillis?.() ?? 0) > Date.now()) throw new HttpError(409, "Senkronizasyon zaten sürüyor.");
    const last = d.lastSyncAt?.toMillis?.() ?? 0;
    if (opts.minIntervalMs && Date.now() - last < opts.minIntervalMs) {
      throw new HttpError(429, "Çok sık denedin. Bir dakika sonra tekrar dene.");
    }
    tx.update(linkRef, { lock: { until: Timestamp.fromMillis(Date.now() + 5 * 60_000) } });
  });

  const summary: SyncSummary = { found: 0, analyzed: 0, duplicates: 0, failed: 0, needsReview: 0, planCreated: false, wroteToDoc: false };
  let lastError: string | null = null;
  let status = "active";

  try {
    const link = (await linkRef.get()).data()!;
    const accessToken = await refreshAccessToken(decrypt(link.encryptedRefreshToken));
    const doc = await getDocument(accessToken, link.docId);

    // 2) Yeni görselleri bul (işlenmiş olanları ve 3+ kez başarısız olanları atla)
    const images = extractImages(doc);
    summary.found = images.length;
    const refs = images.map((i) => database.doc(`users/${uid}/syncedImages/${i.inlineObjectId}`));
    const snaps = refs.length ? await database.getAll(...refs) : [];
    const pending = images
      .filter((_, i) => {
        const s = snaps[i];
        if (!s.exists) return true;
        const d = s.data()!;
        return d.status === "failed" && (d.attempts ?? 0) < 3;
      })
      .slice(0, maxImages);

    // 3) Görselleri işle (3'erli paralel)
    const analyses: VisionResult[] = [];
    const processOne = async (img: ExtractedImage) => {
      const syncRef = database.doc(`users/${uid}/syncedImages/${img.inlineObjectId}`);
      try {
        const file = await downloadImage(accessToken, img.contentUri);

        const dup = await database.collection(`users/${uid}/syncedImages`).where("hash", "==", file.hash).limit(1).get();
        if (!dup.empty && dup.docs[0].id !== img.inlineObjectId) {
          await syncRef.set({ hash: file.hash, status: "duplicate", at: FieldValue.serverTimestamp() });
          summary.duplicates++;
          return;
        }

        const result = await analyzeImage(file);
        const analysisRef = database.collection(`users/${uid}/analyses`).doc();
        await analysisRef.set({
          ...result,
          source: { docId: link.docId, inlineObjectId: img.inlineObjectId, imageHash: file.hash, position: img.index },
          createdAt: FieldValue.serverTimestamp(),
        });
        // Zayıflık istatistiği sadece güveni yeterli satırlardan beslenir
        if (!result.needsReview) for (const s of result.sections) await recordSection(uid, s);

        await syncRef.set({ hash: file.hash, status: "done", analysisId: analysisRef.id, at: FieldValue.serverTimestamp() });
        analyses.push(result);
        summary.analyzed++;
        if (result.needsReview) summary.needsReview++;
      } catch (e) {
        summary.failed++;
        const prev = (await syncRef.get()).data();
        await syncRef.set({
          status: "failed",
          attempts: (prev?.attempts ?? 0) + 1,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
          at: FieldValue.serverTimestamp(),
        });
      }
    };
    for (const group of chunks(pending, 3)) await Promise.all(group.map(processOne));

    // 4) Yeni veri geldiyse haftalık planı üret ve Docs'a yaz
    if (analyses.some((a) => a.sections.length > 0)) {
      const profile = (await database.doc(`users/${uid}`).get()).data() ?? {};
      let plan: WeeklyPlan | null = null;
      try {
        plan = await generateWeeklyPlan(uid, { goal: profile.goal, dailyHours: profile.dailyHours });
        summary.planCreated = true;
      } catch (e) {
        lastError = `Plan üretilemedi: ${e instanceof Error ? e.message : e}`;
      }
      try {
        const weak = await topWeaknesses(uid, 5);
        await appendSection(accessToken, link.docId, renderSyncSection(analyses, weak, plan));
        summary.wroteToDoc = true;
      } catch (e) {
        // Analizler Firestore'da güvende; sadece Docs'a yazım başarısız
        lastError = `Docs'a yazılamadı: ${e instanceof Error ? e.message : e}`;
      }
    }
  } catch (e) {
    if (e instanceof TokenRevokedError) {
      status = "reauth_required";
      lastError = "Google izni iptal edilmiş veya süresi dolmuş. Yeniden bağlan.";
    } else {
      lastError = e instanceof Error ? e.message.slice(0, 300) : "Bilinmeyen hata";
    }
    throw e;
  } finally {
    // 5) Durumu kaydet ve kilidi bırak (istemci okuyabilsin diye users/ altına aynala)
    await linkRef.update({ lock: null, status, lastSyncAt: FieldValue.serverTimestamp(), lastError });
    await stateRef.set(
      { status, lastSyncAt: FieldValue.serverTimestamp(), lastError, lastSummary: summary },
      { merge: true }
    );
  }
  return summary;
}
