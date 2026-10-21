import type { Req, Res } from "./types.js";

// Hata mesajlarından anahtar/token benzeri metinleri temizler
export function sanitize(msg: string): string {
  return msg
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[gizli]")
    .replace(/AQ\.[0-9A-Za-z_-]{20,}/g, "[gizli]")
    .replace(/Bearer\s+[0-9A-Za-z._~+/=-]{10,}/g, "Bearer [gizli]")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public detail?: string
  ) {
    super(message);
  }
}

// Her endpoint'i saran ortak sarmalayıcı: metot kontrolü + tutarlı hata yanıtı
export function route(methods: string[], fn: (req: Req, res: Res) => Promise<void>) {
  return async (req: Req, res: Res): Promise<void> => {
    try {
      if (!methods.includes(req.method ?? "")) throw new HttpError(405, "Bu metot desteklenmiyor.", "METHOD");
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status >= 500) console.error(`[${e.code ?? "HTTP"}] ${e.message} | ${e.detail ?? ""}`);
        res.status(e.status).json({ error: e.message, code: e.code, detail: e.detail });
        return;
      }
      const requestId = Math.random().toString(36).slice(2, 10);
      console.error(`[${requestId}] Beklenmeyen hata:`, e);
      res.status(500).json({
        error: "Sunucu hatası. Lütfen tekrar dene.",
        code: "SERVER_ERROR",
        requestId,
        // DEBUG_ERRORS=1 ise ayrıntı da döner (sorun ayıklarken geçici aç)
        detail: process.env.DEBUG_ERRORS === "1" ? sanitize(e instanceof Error ? e.message : String(e)) : undefined,
      });
    }
  };
}

export function bearer(req: Req): string | null {
  const h = req.headers.authorization;
  const v = Array.isArray(h) ? h[0] : h;
  return v?.startsWith("Bearer ") ? v.slice(7) : null;
}
