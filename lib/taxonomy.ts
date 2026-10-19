// Konu adlarının parçalanmasını (Üslü Sayılar / üslü sayılar / Üslü Ifadeler...) önlemek için
// kontrollü sözlük. Modelden bu listeden seçmesi istenir. Zamanla genişlet.
export const TAXONOMY: Record<string, string[]> = {
  "Matematik": ["Temel Kavramlar", "Sayı Basamakları", "Bölme ve Bölünebilme", "EBOB-EKOK", "Rasyonel Sayılar", "Basit Eşitsizlikler", "Mutlak Değer", "Üslü Sayılar", "Köklü Sayılar", "Çarpanlara Ayırma", "Oran-Orantı", "Denklem Çözme", "Problemler", "Kümeler", "Fonksiyonlar", "Polinomlar", "İkinci Dereceden Denklemler", "Permütasyon-Kombinasyon-Olasılık", "Logaritma", "Diziler", "Limit", "Türev", "İntegral", "Trigonometri"],
  "Geometri": ["Açılar", "Üçgenler", "Çokgenler ve Dörtgenler", "Çember ve Daire", "Katı Cisimler", "Analitik Geometri"],
  "Fizik": ["Fizik Bilimine Giriş", "Madde ve Özellikleri", "Hareket", "Kuvvet ve Newton Yasaları", "İş-Güç-Enerji", "Isı ve Sıcaklık", "Elektrostatik", "Elektrik Akımı", "Manyetizma", "Optik", "Dalgalar"],
  "Kimya": ["Kimya Bilimi", "Atom ve Periyodik Sistem", "Kimyasal Türler Arası Etkileşimler", "Maddenin Halleri", "Karışımlar", "Mol Kavramı", "Kimyasal Hesaplamalar", "Asitler-Bazlar-Tuzlar", "Kimyasal Tepkimelerde Enerji", "Tepkime Hızı", "Kimyasal Denge", "Organik Kimya"],
  "Biyoloji": ["Canlıların Ortak Özellikleri", "Hücre", "Canlıların Sınıflandırılması", "Hücre Bölünmeleri", "Kalıtım", "Ekosistem", "İnsan Fizyolojisi", "Genetik Mühendisliği", "Bitki Biyolojisi"],
  "Türkçe": ["Sözcükte Anlam", "Cümlede Anlam", "Paragraf", "Ses Bilgisi", "Yazım Kuralları", "Noktalama", "Sözcük Türleri", "Cümle Bilgisi", "Anlatım Bozukluğu", "Sözel Mantık"],
  "Edebiyat": ["Şiir Bilgisi", "Edebi Sanatlar", "Edebiyat Akımları", "Divan Edebiyatı", "Halk Edebiyatı", "Tanzimat Dönemi", "Cumhuriyet Dönemi"],
  "Tarih": ["İslamiyet Öncesi Türk Tarihi", "Osmanlı Devleti", "Kurtuluş Savaşı", "Atatürk İlke ve İnkılapları", "Çağdaş Türk ve Dünya Tarihi"],
  "Coğrafya": ["Doğal Sistemler", "Beşeri Sistemler", "Mekansal Sentez", "Türkiye'nin Coğrafi Özellikleri", "Harita Bilgisi"],
  "Felsefe": ["Felsefeye Giriş", "Bilgi Felsefesi", "Varlık Felsefesi", "Ahlak Felsefesi", "Mantık"],
  "Din Kültürü": ["İnanç", "İbadet", "Ahlak ve Değerler", "Hz. Muhammed'in Hayatı"],
};

export function taxonomyForPrompt(): string {
  return Object.entries(TAXONOMY).map(([s, t]) => `- ${s}: ${t.join("; ")}`).join("\n");
}

export function slug(s: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/[çğıöşü]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "genel";
}
