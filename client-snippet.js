// script.js içine ekle (postApi fonksiyonun zaten var: Bearer token gönderiyor)

window.connectGoogleDocs = async function () {
  try {
    const { url } = await postApi("/api/google/auth", {});
    window.location.href = url;
  } catch (e) { toast("Bağlantı hatası: " + e.message); }
};

window.syncNow = async function () {
  const btn = document.getElementById("syncBtn");
  btn.disabled = true;
  try {
    const s = await postApi("/api/sync/run", {});
    toast(`${s.analyzed} görsel analiz edildi${s.needsReview ? `, ${s.needsReview} tanesi kontrol gerektiriyor` : ""}.`);
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
};

// Bağlantı durumunu göster (Firestore: users/{uid}/docSync/state, istemci okuyabilir)
async function loadDocSyncState(db, uid) {
  const snap = await db.doc(`users/${uid}/docSync/state`).get();
  return snap.exists ? snap.data() : null; // {status, docUrl, lastSyncAt, lastError, lastSummary}
}

// Sayfa açılışında ?google=connected | error parametresini yakala
const g = new URLSearchParams(location.search).get("google");
if (g === "connected") toast("Google Docs bağlandı. Belgene fotoğraf ekleyip senkronize edebilirsin.");
if (g === "error") toast("Google bağlantısı kurulamadı, tekrar dene.");
