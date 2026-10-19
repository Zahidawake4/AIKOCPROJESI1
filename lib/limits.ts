// Vercel fonksiyon süresi 60 sn ile sınırlı varsayıldı (Fluid compute / Pro ile artırılabilir).
export const FREE_QUESTION_LIMIT = 4;
export const SYNC_IMAGES_PER_RUN = 3;          // bir senkronda en fazla kaç görsel
export const CRON_BUDGET_MS = 40_000;          // cron toplam süre bütçesi
export const MANUAL_SYNC_COOLDOWN_MS = 20_000; // düğmeye art arda basmayı sınırla
