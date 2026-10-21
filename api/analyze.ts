import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { analyzeImage } from "../lib/analyze.js";
import { db, requireUid } from "../lib/firebase.js";
import { toHttpError } from "../lib/gemini.js";
import { HttpError, route } from "../lib/http.js";
import { DAILY_VISION_LIMIT } from "../lib/limits.js";
import { recordSection } from "../lib/weaknesses.js";

const dayTR = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });

// Günlük görsel analiz sınırı (sunucuda tutulur, istemci değiştiremez)
async function reserveDaily(uid: string): Promise<void> {
  const ref = db().doc(`users/${uid}`);
  const today = dayTR();
  await db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    const count = d.visionDay === today ? Number(d.visionCount ?? 0) : 0;
    if (count >= DAILY_VISION_LIMIT) {
      throw new HttpError(429, `Günlük görsel analiz sınırına (${DAILY_VISION_LIMIT}) ulaştın. Yarın tekrar dene.`, "QUOTA_DAILY");
    }
    tx.set(ref, { visionDay: today, visionCount: count + 1 }, { merge: true });
  });
}

async function refundDaily(uid: string): Promise<void> {
  const ref = db().doc(`users/${uid}`);
  const today = dayTR();
  await db().runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() ?? {};
    if (d.visionDay === today && Number(d.visionCount) > 0) tx.set(ref, { visionCount: Number(d.visionCount) - 1 }, { merge: true });
  });
}

// Karne / çözülmüş test fotoğrafını Gemini Vision ile analiz eder
export default route(["POST"], async (req, res) => {
  const uid = await requireUid(req);
  const b = (req.body ?? {}) as Record<string, unknown>;

  const imageBase64 = typeof b.imageBase64 === "string" ? b.imageBase64 : "";
  if (!imageBase64) throw new HttpError(400, "Fotoğraf eksik.", "NO_IMAGE");
  if (imageBase64.length > 4_000_000) throw new HttpError(413, "Fotoğraf çok büyük. Daha küçük bir fotoğraf dene.", "IMAGE_TOO_BIG");
  const mimeType = /^image\/(png|jpeg|webp)$/.test(String(b.mimeType)) ? String(b.mimeType) : "image/jpeg";
  const exam = b.examContext === "AYT" ? "AYT" : "TYT";

  const hash = createHash("sha256").update(Buffer.from(imageBase64, "base64")).digest("hex");
  const col = db().collection(`users/${uid}/analyses`);

  // Aynı görsel daha önce analiz edildiyse tekrar harcama yapma
  const dup = await col.where("source.imageHash", "==", hash).limit(1).get();
  if (!dup.empty) {
    const { createdAt, ...rest } = dup.docs[0].data();
    res.status(200).json({ duplicate: true, id: dup.docs[0].id, recorded: rest.recorded === true, analysis: rest });
    return;
  }

  await reserveDaily(uid);

  let result;
  try {
    result = await analyzeImage({ base64: imageBase64, mimeType, hash, bytes: imageBase64.length }, { exam });
  } catch (e) {
    await refundDaily(uid).catch(() => {});
    throw toHttpError(e);
  }

  const ref = col.doc();
  const recordable = !result.needsReview;
  await ref.set({
    ...result,
    origin: "upload",
    recorded: recordable, // false ise onay bekler
    source: { imageHash: hash, uploadedAt: new Date().toISOString() },
    createdAt: FieldValue.serverTimestamp(),
  });

  if (recordable) {
    for (const s of result.sections) await recordSection(uid, s).catch((e) => console.error("Zayıflık kaydı:", e));
  }
  res.status(200).json({ duplicate: false, id: ref.id, recorded: recordable, analysis: result });
});
