import type { Req, Res } from "./types.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

// Her endpoint'i saran ortak sarmalayıcı: metot kontrolü + hata yönetimi
export function route(methods: string[], fn: (req: Req, res: Res) => Promise<void>) {
  return async (req: Req, res: Res): Promise<void> => {
    try {
      if (!methods.includes(req.method ?? "")) throw new HttpError(405, "Bu metot desteklenmiyor.");
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) {
        res.status(e.status).json({ error: e.message });
      } else {
        console.error(e); // ayrıntı sadece Vercel loglarında
        res.status(500).json({ error: "Sunucu hatası. Lütfen tekrar dene." });
      }
    }
  };
}

export function bearer(req: Req): string | null {
  const h = req.headers.authorization;
  const v = Array.isArray(h) ? h[0] : h;
  return v?.startsWith("Bearer ") ? v.slice(7) : null;
}
