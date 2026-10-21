# YKS 2027 Pro - AI Koç

## Klasör yapısı (GitHub'daki repo kökü TAM OLARAK böyle olmalı)

```
package.json          tsconfig.json        vercel.json
firestore.rules       .gitignore           .env.example
public/               index.html  style.css  script.js      <- web sitesi (404'ü bu çözer)
api/                  solve.ts  coach.ts  plan.ts  analyze.ts  confirm.ts  report.ts  health.ts
api/google/           auth.ts  callback.ts  disconnect.ts
api/sync/             run.ts
api/cron/             sync-all.ts
lib/                  17 dosya (env, types, causes, http, firebase, crypto, limits, gemini, prompts,
                      taxonomy, analyze, weaknesses, planner, report, render, docs, googleAuth, syncService)
```

KURALLAR
- `lib/` dosyaları `api/` içine GİRMEZ (api/ altındaki her dosya bir endpoint olur).
- Repoda eski `index.html`, `style.css`, `script.js`, `api/solve.js`, `api/coach.js`, `api/_lib.js`
  ve `package-lock.json` varsa SİL. Aynı adlı .js/.ts dosyaları çakışır.
- Repo kökünde (alt klasörde değil) `package.json` ve `vercel.json` bulunmalı.

## Vercel ayarları
- Settings > General > Root Directory: boş (repo kökü).
- Settings > Build & Development: Framework Preset = Other; Output Directory = override KAPALI
  (vercel.json zaten `public` diyor); Build Command = override KAPALI.
- Node.js Version: 22.x

## Ortam değişkenleri (Vercel > Settings > Environment Variables)
| Ad | Açıklama |
|---|---|
| GEMINI_API_KEY | Yeni oluşturduğun Gemini anahtarı (eskisini iptal et) |
| GEMINI_MODEL | İsteğe bağlı, varsayılan gemini-2.5-flash |
| APP_URL | https://SENIN-ALAN-ADIN.vercel.app (sonda / yok) |
| GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | Google Cloud > OAuth Web istemcisi |
| TOKEN_ENC_KEY | `openssl rand -base64 32` çıktısı |
| FIREBASE_SERVICE_ACCOUNT | Firebase > Proje ayarları > Hizmet hesapları > Yeni özel anahtar (JSON, tek satır) |
| CRON_SECRET | Rastgele uzun metin |

## Kurulum kontrol listesi
1. Firebase > Authentication > Settings > Authorized domains: Vercel alan adını ekle.
2. Firebase > Firestore > Rules: `firestore.rules` içeriğini yapıştır, Publish.
3. Google Cloud (aikocprojesi projesi): Docs API + Drive API etkinleştir.
   OAuth istemcisi (Web) > Yetkili yönlendirme URI: `APP_URL/api/google/callback`.
   OAuth izin ekranı yayın durumu: Production.
4. Ortam değişkenlerini gir, Redeploy.

## Sorun giderme
- 404 NOT_FOUND: repo kökünde `public/index.html` var mı? vercel.json kökte mi?
- "Eksik ortam değişkeni": ilgili değişkeni ekleyip Redeploy.
- Giriş açılmıyor: Authorized domains listesini kontrol et.
- Firestore "missing or insufficient permissions": firestore.rules yayınlandı mı?

## Bu sürümde eklenenler
- **Deneme Analizi sekmesi:** karne / çözülmüş test fotoğrafı yükle (en fazla 10 görsel kuyruğu, günde 20 analiz).
  Backend: `api/analyze.ts` -> `lib/analyze.ts` (Gemini Vision) -> Firestore `analyses` + `weaknesses`.
- **Onay akışı:** okuma güveni düşük analizler istatistiğe otomatik girmez; öğrenci sayıları düzeltip onaylar (`api/confirm.ts`).
- **Konu & Hata Analizi sekmesi:** `api/report.ts` + `lib/report.ts`. Konu bazlı doğru/yanlış/boş, hata nedeni dağılımı
  (bilgi eksikliği, kavram yanılgısı, formül unutma, işlem, dikkat, yorumlama, süre) ve neden başına öneri.
- **Haftalık program hatası çözümü:** `lib/planner.ts` artık asla "üretilemedi" ile bitmez. Sıra:
  1) AI planı (esnek JSON ayrıştırma, eksik günleri tamamlama, süre bütçesi kontrolü)
  2) Olmazsa kural tabanlı yedek plan (zayıf konulara ve günlük saate göre)
  Plan `source: ai | fallback` ve `note` alanlarıyla neyin kullanıldığını söyler.
- **Hata teşhisi:** her API hatası `code` (AI_AUTH, AI_MODEL, AI_QUOTA, AI_PARSE...) ve kısa `detail` döner.
  Sol alttaki **Sistem testi** düğmesi ortam değişkenlerini, Firestore'u ve Gemini'yi tek tek sınar.
  Ayrıntılı sunucu hatası için geçici olarak `DEBUG_ERRORS=1` ekleyebilirsin (işin bitince kaldır).
- **Gemini istemcisi:** model bulunamazsa yedek modele geçer, şema/düşünme ayarı reddedilirse bunlarsız yeniden dener,
  kesilen JSON'u onarır, 429/503'te bekleyip tekrar dener.
