import type { ErrorType } from "./types.js";

export const ERROR_LABELS: Record<ErrorType, string> = {
  bilgi_eksigi: "Bilgi eksikliği",
  kavram_eksigi: "Kavram yanılgısı",
  formul_unutma: "Formül unutma / yanlış formül",
  islem_hatasi: "İşlem hatası",
  dikkat_hatasi: "Dikkat hatası",
  yorum_hatasi: "Soru yorumlama hatası",
  sure_yetmedi: "Süre yetmedi",
  belirsiz: "Neden belirlenemedi",
};

export const REMEDIES: Record<ErrorType, string> = {
  bilgi_eksigi: "Konu anlatımını tekrar oku veya izle, tek sayfalık özet çıkar, ardından 10 temel soru çöz.",
  kavram_eksigi: "Kavramı bir örnekle çalış ve 'neden böyle?' sorusunu kendi cümlenle yaz; sonra benzer 5 soru çöz.",
  formul_unutma: "Formül kartı hazırla ve 1-3-7 günlük aralıklarla tekrar et; her çözümden önce ilgili formülü yaz.",
  islem_hatasi: "İşlemleri adım adım yaz, ara sonuçları kontrol et; günlük 10 dakika sadece işlem hızı çalış.",
  dikkat_hatasi: "Soruyu iki kez oku, verilenleri ve istenenleri altını çizerek işaretle, şıkka geçmeden sonucu kontrol et.",
  yorum_hatasi: "Önce soru kökünü oku, sonra metni/şekli incele; çeldiricileri neden yanlış olduğunu yazarak ele.",
  sure_yetmedi: "Konuyu süreli soru çözümüyle çalış; kolay soruları önce çöz, takılınca geç.",
  belirsiz: "Yanlış yaptığında hatanın nedenini bir cümleyle not et; koç daha doğru analiz yapar.",
};

// En çok görülen neden (belirsiz dışındakiler öncelikli)
export function dominantCause(errorTypes: Record<string, number> | undefined): ErrorType | null {
  const entries = Object.entries(errorTypes ?? {}).filter(([, n]) => n > 0) as [ErrorType, number][];
  if (entries.length === 0) return null;
  const known = entries.filter(([t]) => t !== "belirsiz");
  const pool = known.length > 0 ? known : entries;
  return pool.sort((a, b) => b[1] - a[1])[0][0];
}
