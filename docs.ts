import { createHash } from "node:crypto";
import type { DocLine, DownloadedImage, ExtractedImage } from "./types.js";

const DOCS = "https://docs.googleapis.com/v1/documents";

/* ---- Docs API'nin ihtiyacımız olan kısmının minimal tipleri ---- */
interface StructuralElement {
  startIndex?: number;
  endIndex?: number;
  paragraph?: { elements?: { startIndex?: number; inlineObjectElement?: { inlineObjectId?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: StructuralElement[] }[] }[] };
}
export interface GDoc {
  documentId: string;
  title: string;
  body: { content: StructuralElement[] };
  inlineObjects?: Record<
    string,
    { inlineObjectProperties?: { embeddedObject?: { imageProperties?: { contentUri?: string } } } }
  >;
}

async function docsFetch<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!r.ok) throw new Error(`Google Docs hatası (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return (await r.json()) as T;
}

export const getDocument = (accessToken: string, documentId: string) =>
  docsFetch<GDoc>(accessToken, `${DOCS}/${documentId}`);

/* ---- 1) Belgedeki görselleri sırasıyla çıkar (tablo hücreleri dahil) ---- */
function* walk(content: StructuralElement[] = []): Generator<StructuralElement> {
  for (const el of content) {
    yield el;
    for (const row of el.table?.tableRows ?? [])
      for (const cell of row.tableCells ?? []) yield* walk(cell.content);
  }
}

export function extractImages(doc: GDoc): ExtractedImage[] {
  const found: ExtractedImage[] = [];
  for (const el of walk(doc.body?.content)) {
    for (const pe of el.paragraph?.elements ?? []) {
      const id = pe.inlineObjectElement?.inlineObjectId;
      if (!id) continue;
      // contentUri ~30 dk geçerli ve isteği yapan hesaba bağlıdır -> her senkronda taze alınır
      const uri = doc.inlineObjects?.[id]?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
      if (uri) found.push({ inlineObjectId: id, contentUri: uri, index: pe.startIndex ?? 0 });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/* ---- 2) Görseli indir (OAuth token ile) -> base64 + SHA-256 ---- */
const ALLOWED = /^image\/(png|jpeg|webp|heic|heif)$/;

export async function downloadImage(
  accessToken: string,
  contentUri: string,
  maxBytes = 7 * 1024 * 1024
): Promise<DownloadedImage> {
  const r = await fetch(contentUri, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Görsel indirilemedi (${r.status})`);
  const mimeType = (r.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!ALLOWED.test(mimeType)) throw new Error(`Desteklenmeyen görsel türü: ${mimeType || "bilinmiyor"}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw new Error("Görsel çok büyük (7 MB üstü).");
  return {
    base64: buf.toString("base64"),
    mimeType,
    hash: createHash("sha256").update(buf).digest("hex"),
    bytes: buf.length,
  };
}

/* ---- 3) Belgenin sonuna biçimlendirilmiş bölüm ekle (tek batchUpdate) ---- */
const NAMED: Record<DocLine["style"], string> = {
  H1: "HEADING_1", H2: "HEADING_2", H3: "HEADING_3", P: "NORMAL_TEXT", BULLET: "NORMAL_TEXT",
};

export async function appendSection(accessToken: string, documentId: string, lines: DocLine[]): Promise<void> {
  if (lines.length === 0) return;
  const doc = await getDocument(accessToken, documentId);
  const last = doc.body.content[doc.body.content.length - 1];
  const base = (last.endIndex ?? 2) - 1; // son paragrafın sonundaki "\n"'den hemen önce

  // Docs indeksleri UTF-16'dır; JS string uzunluğu da öyledir
  let cursor = base;
  const ranges = lines.map((l) => {
    const start = cursor;
    cursor += l.text.length + 1;
    return { l, start, end: cursor };
  });

  const requests: object[] = [
    { insertText: { location: { index: base }, text: lines.map((l) => l.text + "\n").join("") } },
    // Eklenen metin önceki paragrafın stilini/madde işaretini devralabilir -> temizle
    { deleteParagraphBullets: { range: { startIndex: base, endIndex: cursor } } },
    ...ranges.map(({ l, start, end }) => ({
      updateParagraphStyle: {
        range: { startIndex: start, endIndex: end },
        paragraphStyle: { namedStyleType: NAMED[l.style] },
        fields: "namedStyleType",
      },
    })),
  ];

  // Ardışık BULLET satırlarını tek madde listesi yap
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].l.style !== "BULLET") continue;
    let j = i;
    while (j + 1 < ranges.length && ranges[j + 1].l.style === "BULLET") j++;
    requests.push({
      createParagraphBullets: {
        range: { startIndex: ranges[i].start, endIndex: ranges[j].end },
        bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
      },
    });
    i = j;
  }

  await docsFetch(accessToken, `${DOCS}/${documentId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

/* ---- Öğrenci defterini oluştur ---- */
export async function createNotebook(accessToken: string, title: string): Promise<string> {
  const doc = await docsFetch<{ documentId: string }>(accessToken, DOCS, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  await appendSection(accessToken, doc.documentId, [
    { style: "H1", text: title },
    { style: "P", text: "Çözdüğün test, deneme karnesi veya soru bankası sayfalarının fotoğrafını bu belgeye ekle (Docs uygulaması > Ekle > Resim)." },
    { style: "P", text: "Koçun fotoğrafları okur, analizi ve haftalık programını bu belgenin altına yazar. Bu satırların altına yazma; sadece görsel ekle." },
  ]);
  return doc.documentId;
}
