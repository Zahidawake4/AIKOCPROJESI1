/* =====================================================================
   YKS 2027 Pro - istemci kodu
   ===================================================================== */

/* ---------- Durum ---------- */
let selectedLevel = 1;
let currentImageBase64 = null;
let currentImageMimeType = "image/jpeg";
let activeUid = null;
let recognition = null;
let isListening = false;
let netKind = "TYT";

let profile = { goal: "", dailyHours: 4, freeQuestionsLeft: 4, isProUser: false, netHistory: [] };
let questions = [];     // users/{uid}/questions
let analyses = [];      // users/{uid}/analyses (Google Docs)
let weaknesses = [];    // users/{uid}/weaknesses
let latestPlan = null;  // users/{uid}/weeklyPlans (en yeni)
let docSync = null;     // users/{uid}/docSync/state
let reportData = null;  // /api/report çıktısı
let analyzeFiles = [];  // Deneme Analizi kuyruğu

const NET_CONFIG = {
  TYT: [
    { id: "tr", name: "Türkçe", max: 40 },
    { id: "sos", name: "Sosyal Bilimler", max: 20 },
    { id: "mat", name: "Temel Matematik", max: 40 },
    { id: "fen", name: "Fen Bilimleri", max: 20 },
  ],
  AYT: [
    { id: "mat", name: "Matematik", max: 40 },
    { id: "fiz", name: "Fizik", max: 14 },
    { id: "kim", name: "Kimya", max: 13 },
    { id: "biy", name: "Biyoloji", max: 13 },
    { id: "edb", name: "Edebiyat", max: 24 },
    { id: "tar1", name: "Tarih-1", max: 10 },
    { id: "cog1", name: "Coğrafya-1", max: 6 },
    { id: "tar2", name: "Tarih-2", max: 11 },
    { id: "cog2", name: "Coğrafya-2", max: 11 },
    { id: "fel", name: "Felsefe Grubu", max: 12 },
    { id: "din", name: "Din Kültürü", max: 6 },
  ],
};

const OUTCOME_LABELS = { yanlis: "Yanlış", bos: "Boş", bilmiyor: "Bilmiyor", bilmiyorum: "Bilmiyor", yavas: "Yavaş", merak: "Merak" };
const IMAGE_TYPE_LABELS = {
  deneme_karnesi: "Deneme karnesi", test_sayfasi: "Test sayfası", soru_bankasi_sayfasi: "Soru bankası",
  calisma_cizelgesi: "Çalışma çizelgesi", diger: "Diğer", okunamadi: "Okunamadı",
};
const ERROR_LABELS = {
  bilgi_eksigi: "Bilgi eksikliği", kavram_eksigi: "Kavram yanılgısı", formul_unutma: "Formül unutma / yanlış formül",
  islem_hatasi: "İşlem hatası", dikkat_hatasi: "Dikkat hatası", yorum_hatasi: "Soru yorumlama hatası",
  sure_yetmedi: "Süre yetmedi", belirsiz: "Neden belirlenemedi",
};
const ACTIVITY_LABELS = { konu_calismasi: "Konu çalışması", soru_cozumu: "Soru çözümü", tekrar: "Tekrar", deneme: "Deneme", hata_defteri: "Hata defteri" };

/* ---------- Yardımcılar ---------- */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Önce HTML'i kaçır (XSS koruması), sonra **kalın** ve satır sonlarını çevir
function formatText(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}
function tsToDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}
function fmtDate(v, withTime = true) {
  const d = tsToDate(v);
  if (!d) return "-";
  return d.toLocaleString("tr-TR", withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" });
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 4000);
}

async function getIdToken() {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Oturum bulunamadı, lütfen tekrar giriş yap.");
  return user.getIdToken();
}

async function postApi(path, body = {}) {
  const token = await getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch { /* boş gövde */ }
  if (!response.ok) {
    const err = new Error(data.error || `Sunucu hatası: ${response.status}`);
    err.code = data.code; err.detail = data.detail; err.requestId = data.requestId;
    throw err;
  }
  return data;
}

function errText(e) {
  let m = e?.message || "Bilinmeyen hata";
  if (e?.detail) m += ` (${e.detail})`;
  if (e?.requestId) m += ` [ref: ${e.requestId}]`;
  return m;
}

const safe = async (promise, fallback) => { try { return await promise; } catch (e) { console.error(e); return fallback; } };

/* ---------- Başlangıç / Giriş ---------- */
window.addEventListener("load", () => {
  const auth = firebase.auth();
  const provider = new firebase.auth.GoogleAuthProvider();

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      activeUid = user.uid;
      $("auth-modal").style.display = "none";
      $("sidebar-user-email").innerText = user.email || user.displayName || "Kullanıcı";
      await loadAll();
      handleGoogleRedirect();
    } else {
      activeUid = null;
      questions = []; analyses = []; weaknesses = []; latestPlan = null; docSync = null;
      $("auth-modal").style.display = "flex";
    }
  });

  $("google-login-btn").onclick = async () => {
    try { await auth.signInWithPopup(provider); }
    catch (e) { toast("Giriş hatası: " + e.message); }
  };

  setupDragDrop();
  setupAnalyzeDrop();
  initVoiceRecognition();
  renderNetTable();
  calculateNet();
});

window.logoutFirebase = async function () {
  try { await firebase.auth().signOut(); } catch (e) { console.error(e); }
};

function handleGoogleRedirect() {
  const g = new URLSearchParams(location.search).get("google");
  if (!g) return;
  history.replaceState({}, "", location.pathname);
  switchTab("docs");
  toast(g === "connected" ? "Google Docs bağlandı. Belgene fotoğraf ekleyip senkronize edebilirsin." : "Google bağlantısı kurulamadı, tekrar dene.");
}

window.switchTab = function (tabId, btn) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".menu-btn").forEach((el) => el.classList.remove("active"));
  $(`tab-${tabId}`).classList.add("active");
  (btn || document.querySelector(`.menu-btn[data-tab="${tabId}"]`))?.classList.add("active");
  const titles = {
    solver: "AI Soru Çözücü", wizard: "Net Sihirbazı", history: "Çözülen Sorular",
    docs: "Google Docs & Analiz", coach: "AI Koç & Program", report: "Aylık Rapor",
    analyze: "Deneme Analizi", topics: "Konu & Hata Analizi",
  };
  $("headerTitle").innerText = titles[tabId] || "YKS 2027 Pro";
  if (tabId === "topics" && activeUid) loadReport();
};

window.selectLevel = function (level) {
  selectedLevel = level;
  document.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("active"));
  document.querySelector(`[data-level="${level}"]`)?.classList.add("active");
};

/* ---------- Veri yükleme ---------- */
async function loadAll() {
  if (!activeUid) return;
  const db = firebase.firestore();
  const base = `users/${activeUid}`;

  const [userSnap, qSnap, aSnap, wSnap, pSnap, sSnap] = await Promise.all([
    safe(db.doc(base).get(), null),
    safe(db.collection(`${base}/questions`).orderBy("date", "desc").limit(300).get(), null),
    safe(db.collection(`${base}/analyses`).orderBy("createdAt", "desc").limit(30).get(), null),
    safe(db.collection(`${base}/weaknesses`).orderBy("chronicScore", "desc").limit(20).get(), null),
    safe(db.collection(`${base}/weeklyPlans`).orderBy("weekStart", "desc").limit(1).get(), null),
    safe(db.doc(`${base}/docSync/state`).get(), null),
  ]);

  if (userSnap?.exists) profile = { ...profile, ...userSnap.data() };
  if (!Array.isArray(profile.netHistory)) profile.netHistory = [];
  questions = qSnap ? qSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  analyses = aSnap ? aSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  weaknesses = wSnap ? wSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
  latestPlan = pSnap && !pSnap.empty ? pSnap.docs[0].data() : null;
  docSync = sSnap?.exists ? sSnap.data() : null;

  $("goalInput").value = profile.goal || "";
  $("hoursInput").value = profile.dailyHours ?? 4;
  renderAll();
}

function renderAll() {
  renderBadge();
  renderHistory();
  renderWeaknesses();
  renderDocs();
  renderUploadAnalyses();
  renderPlan();
  renderReportStats();
  renderNetExtras();
}

function renderBadge() {
  const badge = $("free-badge");
  if (profile.isProUser) badge.innerHTML = `<i class="fa-solid fa-crown" style="color:var(--warning);"></i> Pro üye`;
  else badge.innerHTML = `Kalan hak: <strong>${Number.isFinite(profile.freeQuestionsLeft) ? profile.freeQuestionsLeft : 4}</strong>`;
}

/* ---------- Fotoğraf ---------- */
function setupDragDrop() {
  const area = $("uploadArea");
  ["dragenter", "dragover"].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.remove("dragover"); }));
  area.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) processImageFile(f); });
}

window.handleFileSelect = function (event) {
  const file = event.target.files[0];
  if (file) processImageFile(file);
};

// Fotoğrafı küçültüp JPEG'e çevirir (istek limiti + hız için)
function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Lütfen bir resim dosyası seç."));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      URL.revokeObjectURL(url);
      resolve({ base64: dataUrl.split(",")[1], dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Fotoğraf okunamadı (HEIC ise JPEG/PNG olarak dene).")); };
    img.src = url;
  });
}

async function processImageFile(file) {
  try {
    const { base64, dataUrl } = await compressImage(file);
    currentImageMimeType = "image/jpeg";
    currentImageBase64 = base64;
    const preview = $("imagePreview");
    preview.src = dataUrl;
    preview.style.display = "block";
  } catch (e) { toast(e.message); }
}

/* ---------- Soru çözümü ---------- */
window.solveQuestion = async function () {
  if (!currentImageBase64) return toast("Lütfen önce bir soru fotoğrafı yükle!");
  if (!activeUid) return toast("Önce giriş yapmalısın.");

  const exam = document.querySelector('input[name="examContext"]:checked').value;
  const btn = $("solveBtn");
  $("solutionSection").style.display = "block";
  $("detectedTopic").innerText = "Konu: analiz ediliyor...";
  $("solutionText").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <em>Soru ve hata analizi yapılıyor...</em>`;
  btn.disabled = true;

  try {
    const data = await postApi("/api/solve", {
      examContext: exam,
      level: selectedLevel,
      outcome: $("outcomeSelect").value,
      note: $("studentNote").value.trim(),
      mimeType: currentImageMimeType,
      imageBase64: currentImageBase64,
    });
    $("detectedTopic").innerText = `${data.subject} • ${data.topic} (${exam})`;
    $("solutionText").innerHTML = formatText(data.solution);
    $("studentNote").value = "";
    if (data.freeQuestionsLeft >= 0) profile.freeQuestionsLeft = data.freeQuestionsLeft;
    await loadAll();
  } catch (e) {
    $("detectedTopic").innerText = "Bir sorun oluştu";
    $("solutionText").innerHTML = `<strong class="error-text">Hata:</strong> ${esc(errText(e))}`;
  } finally {
    btn.disabled = false;
  }
};

/* ---------- Geçmiş ---------- */
function renderHistory() {
  const box = $("historyListContainer");
  if (questions.length === 0) { box.innerHTML = `<p class="muted">Henüz kayıtlı soru yok.</p>`; return; }
  box.innerHTML = questions.map((q, i) => `
    <div class="history-item clickable" onclick="openHistoryItem(${i})">
      <div>
        <strong>${esc(q.subject || "Genel")} • ${esc(q.topic)}</strong>
        <div class="muted" style="font-size:.75rem;margin-top:.2rem;">
          ${esc(OUTCOME_LABELS[q.outcome] || "")} | Kademe ${esc(q.level || 1)} | ${esc(fmtDate(q.date))}
        </div>
      </div>
      <span class="badge">${esc(q.exam)}</span>
    </div>`).join("");
}

window.openHistoryItem = function (i) {
  const q = questions[i];
  if (!q) return;
  switchTab("solver");
  $("solutionSection").style.display = "block";
  $("detectedTopic").innerText = `${q.subject || "Genel"} • ${q.topic} (${q.exam})`;
  $("solutionText").innerHTML = formatText(q.solution || "Bu soru için kayıtlı çözüm yok.");
  window.scrollTo({ top: 0, behavior: "smooth" });
};

/* ---------- Net sihirbazı ---------- */
window.setNetKind = function (kind) {
  netKind = kind;
  $("pill-TYT").classList.toggle("active", kind === "TYT");
  $("pill-AYT").classList.toggle("active", kind === "AYT");
  $("netKindLabel").innerText = kind;
  renderNetTable();
  calculateNet();
  renderNetExtras();
};

function renderNetTable() {
  $("netTableBody").innerHTML = NET_CONFIG[netKind].map((l) => `
    <tr>
      <td>${esc(l.name)} (${l.max})</td>
      <td><input type="number" min="0" max="${l.max}" id="d-${l.id}" value="0" oninput="calculateNet()"></td>
      <td><input type="number" min="0" max="${l.max}" id="y-${l.id}" value="0" oninput="calculateNet()"></td>
      <td id="n-${l.id}">0.00</td>
    </tr>`).join("");
}

function lessonNet(l) {
  const d = Math.max(0, parseFloat($(`d-${l.id}`).value) || 0);
  let y = Math.max(0, parseFloat($(`y-${l.id}`).value) || 0);
  if (d + y > l.max) y = Math.max(0, l.max - d); // doğru+yanlış soru sayısını aşamaz
  return Math.max(0, d - y * 0.25);
}

window.calculateNet = function () {
  let total = 0;
  NET_CONFIG[netKind].forEach((l) => {
    const n = lessonNet(l);
    $(`n-${l.id}`).innerText = n.toFixed(2);
    total += n;
  });
  $("totalNet").innerText = total.toFixed(2);
};

window.saveNetResult = async function () {
  if (!activeUid) return toast("Önce giriş yapmalısın.");
  const nets = {};
  NET_CONFIG[netKind].forEach((l) => { nets[l.id] = Math.round(lessonNet(l) * 100) / 100; });
  const total = Math.round(Object.values(nets).reduce((a, b) => a + b, 0) * 100) / 100;
  if (total <= 0) return toast("Önce doğru/yanlış sayılarını gir.");

  const history = [...profile.netHistory, { kind: netKind, date: new Date().toISOString(), nets, total }].slice(-60);
  try {
    await firebase.firestore().doc(`users/${activeUid}`).set({ netHistory: history }, { merge: true });
    profile.netHistory = history;
    renderNetExtras();
    toast("Deneme kaydedildi.");
  } catch (e) { toast("Kayıt hatası: " + e.message); }
};

function renderNetExtras() {
  const list = profile.netHistory.filter((n) => n.kind === netKind);
  const chart = $("netChart");
  const box = $("netHistoryBox");

  if (list.length < 2) {
    chart.innerHTML = list.length ? "" : "";
  } else {
    const pts = list.slice(-10);
    const w = 600, h = 140, pad = 24;
    const max = Math.max(...pts.map((p) => p.total)) || 1;
    const min = Math.min(...pts.map((p) => p.total));
    const span = Math.max(1, max - min);
    const x = (i) => pad + (i * (w - 2 * pad)) / (pts.length - 1);
    const y = (v) => h - pad - ((v - min) / span) * (h - 2 * pad);
    const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
    chart.innerHTML = `
      <h4 style="margin-bottom:.5rem;">${esc(netKind)} net gelişimi</h4>
      <svg viewBox="0 0 ${w} ${h}" style="width:100%;background:var(--bg-dark);border:1px solid var(--border);border-radius:.5rem;">
        <polyline fill="none" stroke="#6366f1" stroke-width="3" points="${line}"/>
        ${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="4" fill="#6366f1"/>
          <text x="${x(i).toFixed(1)}" y="${(y(p.total) - 9).toFixed(1)}" font-size="11" fill="#94a3b8" text-anchor="middle">${p.total}</text>`).join("")}
      </svg>`;
  }

  box.innerHTML = list.length
    ? `<h4 style="margin-bottom:.75rem;">Kayıtlı ${esc(netKind)} denemeleri</h4>` +
      list.slice().reverse().slice(0, 8).map((n) => `<div class="history-item"><span>${esc(fmtDate(n.date, false))}</span><strong>${esc(n.total)} net</strong></div>`).join("")
    : "";
}

/* ---------- Zayıflıklar ve koç ---------- */
function renderWeaknesses() {
  const box = $("weakTopicList");
  const rows = weaknesses.filter((w) => w.chronicScore > 0);
  if (rows.length === 0) { box.innerHTML = `<p class="muted">Yeterli veri yok.</p>`; return; }
  box.innerHTML = rows.slice(0, 8).map((w) => `
    <div class="weak-item">
      <div><strong>${esc(w.subject)} • ${esc(w.topic)}</strong>
        <span class="muted" style="float:right;">%${Math.round(w.chronicScore * 100)} · ${esc(w.sessions)} oturum</span></div>
      <div class="bar"><span style="width:${Math.min(100, Math.round(w.chronicScore * 100))}%"></span></div>
    </div>`).join("");
}

window.saveProfile = async function () {
  if (!activeUid) return toast("Önce giriş yapmalısın.");
  const goal = $("goalInput").value.trim().slice(0, 120);
  const dailyHours = Math.min(16, Math.max(1, parseFloat($("hoursInput").value) || 4));
  try {
    await firebase.firestore().doc(`users/${activeUid}`).set({ goal, dailyHours }, { merge: true });
    profile.goal = goal; profile.dailyHours = dailyHours;
    toast("Hedefin kaydedildi.");
  } catch (e) { toast("Kayıt hatası: " + e.message); }
};

window.generateCoachAdvice = async function () {
  const btn = $("coachBtn"), box = $("coachAdviceBox");
  btn.disabled = true;
  box.classList.add("muted");
  box.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Koçun verilerini inceliyor...`;
  try {
    const data = await postApi("/api/coach");
    box.classList.remove("muted");
    box.innerHTML = formatText(data.advice);
  } catch (e) {
    box.innerHTML = `<strong class="error-text">Hata:</strong> ${esc(errText(e))}`;
  } finally { btn.disabled = false; }
};

window.generatePlan = async function () {
  const btn = $("planBtn");
  btn.disabled = true;
  $("planBox").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Program hazırlanıyor...`;
  try {
    const data = await postApi("/api/plan");
    latestPlan = data.plan;
    renderPlan();
    if (data.source === "fallback") toast("Yapay zeka şu an kullanılamadı; kural tabanlı yedek plan hazırlandı.");
  } catch (e) {
    $("planBox").innerHTML = `<strong class="error-text">Hata:</strong> ${esc(errText(e))}`;
  } finally { btn.disabled = false; }
};

function renderPlan() {
  const box = $("planBox");
  if (!latestPlan) { box.innerHTML = `<p class="muted">Henüz program yok.</p>`; return; }
  const p = latestPlan;
  box.innerHTML = `
    <p class="muted" style="margin-bottom:.75rem;">Hafta başı: ${esc(p.weekStart)}${p.source === "fallback" ? " · <span class=\"badge warn\">Yedek plan</span>" : ""}</p>
    ${p.note ? `<div class="note-box">${esc(p.note)}</div>` : ""}
    ${p.summary ? `<p class="solution-text" style="margin-bottom:1rem;">${esc(p.summary)}</p>` : ""}
    ${(p.days || []).map((d) => `
      <details class="plan-day">
        <summary>${esc(d.day)} · ${esc(d.totalMinutes)} dk</summary>
        <ul>${(d.tasks || []).map((t) => `<li><strong>${esc(t.subject)} • ${esc(t.topic)}</strong>: ${esc(ACTIVITY_LABELS[t.activity] || t.activity)} (${esc(t.minutes)} dk${t.questionTarget ? `, ${esc(t.questionTarget)} soru` : ""}). ${esc(t.why)}</li>`).join("")}</ul>
      </details>`).join("")}`;
}

/* ---------- Google Docs ---------- */
function renderDocs() {
  const box = $("docsStatus");
  const st = docSync?.status;
  const connected = st === "active" || st === "reauth_required";

  if (!connected) {
    box.innerHTML = `
      <p class="muted">Durum: <span class="badge">Bağlı değil</span></p>
      <label class="check"><input type="checkbox" id="docsConsent">
        <span>Sınav görsellerimin (test, deneme karnesi vb.) analiz amacıyla yapay zekâ servisine gönderilip işlenmesine ve sonuçların hesabımda saklanmasına onay veriyorum. Bağlantıyı istediğim zaman kesebilirim.</span></label>
      <button class="btn" onclick="connectGoogleDocs()"><i class="fa-brands fa-google"></i> Google Docs'u bağla</button>
      <p class="muted" style="margin-top:.75rem;font-size:.8rem;">Sadece uygulamanın oluşturduğu "YKS Koç Defterim" belgesine erişilir; Drive'ındaki diğer dosyalara erişilmez.</p>`;
  } else {
    const badge = st === "reauth_required" ? `<span class="badge bad">Yeniden bağlan</span>` : `<span class="badge ok">Bağlı</span>`;
    const s = docSync.lastSummary;
    box.innerHTML = `
      <p class="muted">Durum: ${badge} &nbsp; Son senkron: ${esc(fmtDate(docSync.lastSyncAt))}</p>
      <p style="margin:.75rem 0;"><a href="${esc(docSync.docUrl)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Defterimi aç</a></p>
      ${s ? `<p class="muted">Son sonuç: ${esc(s.analyzed)} analiz, ${esc(s.duplicates)} tekrar, ${esc(s.failed)} hata${s.needsReview ? `, ${esc(s.needsReview)} kontrol gerekli` : ""}${s.remaining ? `, ${esc(s.remaining)} görsel sırada` : ""}.</p>` : ""}
      ${docSync.lastError ? `<p class="error-text" style="font-size:.85rem;margin-top:.5rem;">${esc(docSync.lastError)}</p>` : ""}
      <div class="btn-row" style="margin-top:1rem;">
        ${st === "reauth_required"
          ? `<button class="btn" onclick="connectGoogleDocs(true)"><i class="fa-brands fa-google"></i> Yeniden bağlan</button>`
          : `<button class="btn" id="syncBtn" onclick="syncNow()"><i class="fa-solid fa-rotate"></i> Şimdi senkronize et</button>`}
        <button class="btn btn-danger" onclick="disconnectGoogle()"><i class="fa-solid fa-link-slash"></i> Bağlantıyı kes</button>
      </div>`;
  }

  const docsList = analyses.filter((x) => x.origin === "docs" || (!x.origin && x.source?.docId));
  $("docsAnalyses").innerHTML = docsList.length ? docsList.map(analysisCardHtml).join("") : `<p class="muted">Henüz analiz yok.</p>`;
}

window.connectGoogleDocs = async function (skipConsent = false) {
  if (!skipConsent && !$("docsConsent")?.checked) return toast("Devam etmek için onay kutusunu işaretle.");
  try {
    const { url } = await postApi("/api/google/auth");
    window.location.href = url;
  } catch (e) { toast("Bağlantı hatası: " + e.message); }
};

window.syncNow = async function () {
  const btn = $("syncBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Senkronize ediliyor...`; }
  try {
    const s = await postApi("/api/sync/run");
    let msg = s.analyzed ? `${s.analyzed} görsel analiz edildi.` : "Yeni görsel bulunamadı.";
    if (s.needsReview) msg += ` ${s.needsReview} tanesi kontrol gerektiriyor.`;
    if (s.remaining) msg += ` ${s.remaining} görsel daha sırada, tekrar senkronize et.`;
    toast(msg);
  } catch (e) { toast(errText(e)); }
  await loadAll();
};

window.disconnectGoogle = async function () {
  if (!confirm("Google Docs bağlantısı kesilsin mi? Belgen ve mevcut analizlerin silinmez.")) return;
  try {
    await postApi("/api/google/disconnect");
    toast("Bağlantı kesildi.");
  } catch (e) { toast(errText(e)); }
  await loadAll();
};

/* ---------- Rapor ---------- */
function monthlyData() {
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return {
    recent: questions.filter((q) => (tsToDate(q.date)?.getTime() || 0) >= monthAgo),
    docs: analyses.filter((a) => (tsToDate(a.createdAt)?.getTime() || 0) >= monthAgo),
  };
}

function renderReportStats() {
  const { recent, docs } = monthlyData();
  $("reportTotalCount").innerText = recent.length;
  $("reportDocsCount").innerText = docs.length;
  const worst = weaknesses.find((w) => w.chronicScore > 0);
  $("reportTopTopic").innerText = worst ? `${worst.subject} • ${worst.topic}` : "Veri yok";
}

window.generateMonthlyReport = function () {
  const { recent, docs } = monthlyData();
  if (recent.length === 0 && docs.length === 0 && weaknesses.length === 0) return toast("Raporlanacak veri yok.");
  const nets = profile.netHistory.filter((n) => (tsToDate(n.date)?.getTime() || 0) >= Date.now() - 30 * 864e5);
  const lines = [
    "YKS 2027 PRO - AYLIK İLERLEME RAPORU",
    `Tarih: ${new Date().toLocaleDateString("tr-TR")}`,
    `Hedef: ${profile.goal || "belirtilmedi"}`,
    "",
    `Son 30 günde çözülen soru: ${recent.length}`,
    `Google Docs'tan okunan görsel: ${docs.length}`,
    "",
    "KRONİK EKSİKLER (hata oranına göre):",
    ...(weaknesses.filter((w) => w.chronicScore > 0).slice(0, 10).map((w) => `- ${w.subject} / ${w.topic}: %${Math.round(w.chronicScore * 100)} (${w.sessions} oturum)`)),
    "",
    "DENEME NETLERİ:",
    ...(nets.length ? nets.map((n) => `- ${new Date(n.date).toLocaleDateString("tr-TR")} ${n.kind}: ${n.total} net`) : ["- Kayıtlı deneme yok"]),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "yks-aylik-rapor.txt";
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ---------- Sesli komut ---------- */
function initVoiceRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.lang = "tr-TR";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    $("voiceStatus").innerHTML = `<i class="fa-solid fa-microphone-lines"></i> Komut: "${esc(text)}"`;
    processVoiceCommand(text);
  };
  recognition.onerror = () => stopVoiceInput();
  recognition.onend = () => stopVoiceInput();
}

window.toggleVoiceInput = function () {
  if (!recognition) return toast("Tarayıcın sesli komutu desteklemiyor.");
  isListening ? stopVoiceInput() : startVoiceInput();
};

function startVoiceInput() {
  try { recognition.start(); } catch { return; }
  isListening = true;
  $("micBtn").classList.add("listening");
  $("voiceStatus").innerHTML = `<i class="fa-solid fa-microphone-lines" style="color:var(--danger);"></i> Dinleniyor...`;
}

function stopVoiceInput() {
  if (recognition && isListening) { try { recognition.stop(); } catch { /* yok say */ } }
  isListening = false;
  $("micBtn")?.classList.remove("listening");
}

function processVoiceCommand(raw) {
  const t = raw.toLocaleLowerCase("tr-TR");
  if (t.includes("ayt")) { document.querySelector('input[name="examContext"][value="AYT"]').checked = true; toast("Bağlam AYT seçildi."); }
  else if (t.includes("tyt")) { document.querySelector('input[name="examContext"][value="TYT"]').checked = true; toast("Bağlam TYT seçildi."); }
  else if (t.includes("birinci kademe")) selectLevel(1);
  else if (t.includes("ikinci kademe")) selectLevel(2);
  else if (t.includes("üçüncü kademe")) selectLevel(3);
  else if (t.includes("çöz")) solveQuestion();
}

/* =====================================================================
   Fotoğraf analizi, konu/hata raporu, sistem testi
   ===================================================================== */

/* ---------- Analiz kartı (hem Docs hem Deneme Analizi için) ---------- */
function analysisCardHtml(a) {
  const sections = a.sections || [];
  const rows = sections.map((s) => {
    const counts = s.correct != null && s.wrong != null
      ? `${s.correct}D ${s.wrong}Y ${s.blank ?? "-"}B · net ${s.net}` : "sayılar belirlenemedi";
    const wrongN = (s.wrongQuestionNumbers || []).length ? `<div class="muted" style="font-size:.78rem;">Yanlış sorular: ${esc(s.wrongQuestionNumbers.join(", "))}</div>` : "";
    const blankN = (s.blankQuestionNumbers || []).length ? `<div class="muted" style="font-size:.78rem;">Boş sorular: ${esc(s.blankQuestionNumbers.join(", "))}</div>` : "";
    const causes = (s.errorPatterns || []).map((p) =>
      `<div style="font-size:.78rem;color:var(--warning);">${esc(ERROR_LABELS[p.type] || p.type)}: ${esc(p.description)}</div>`).join("");
    return `<div style="margin-top:.55rem;"><div style="font-size:.85rem;"><strong>${esc(s.subject)} • ${esc(s.topic)}</strong>: ${esc(counts)}</div>${wrongN}${blankN}${causes}</div>`;
  }).join("") || `<div class="muted" style="font-size:.85rem;margin-top:.3rem;">Veri okunamadı.</div>`;

  const pending = a.needsReview && a.recorded !== true && sections.length > 0;
  const confirm = pending ? `
    <div class="note-box" style="margin-top:.75rem;">Okuma güveni düşük: sayıları kontrol edip onaylayana kadar istatistiğe eklenmez.</div>
    <div class="confirm-grid"><span></span><span class="muted">D</span><span class="muted">Y</span><span class="muted">B</span>
      ${sections.map((s, i) => `<span>${esc(s.subject)} • ${esc(s.topic)}</span>
        <input type="number" min="0" id="cf-${esc(a.id)}-${i}-d" value="${s.correct ?? ""}">
        <input type="number" min="0" id="cf-${esc(a.id)}-${i}-y" value="${s.wrong ?? ""}">
        <input type="number" min="0" id="cf-${esc(a.id)}-${i}-b" value="${s.blank ?? ""}">`).join("")}
    </div>
    <button class="mini-btn" onclick="confirmAnalysis('${esc(a.id)}')">Onayla ve istatistiğe ekle</button>` : "";

  return `
    <div class="history-item" style="align-items:flex-start;">
      <div style="flex:1;min-width:0;">
        <strong>${esc(IMAGE_TYPE_LABELS[a.imageType] || "Görsel")}</strong>
        <span class="muted" style="font-size:.75rem;"> · ${esc(fmtDate(a.createdAt))} · güven %${Math.round((a.confidence || 0) * 100)}</span>
        ${rows}
        ${(a.issues || []).length ? `<div class="muted" style="font-size:.78rem;margin-top:.4rem;">${esc(a.issues.join(" · "))}</div>` : ""}
        ${confirm}
      </div>
      ${pending ? `<span class="badge warn">Kontrol et</span>` : a.confirmed ? `<span class="badge ok">Onaylandı</span>` : ""}
    </div>`;
}

function renderUploadAnalyses() {
  const list = analyses.filter((x) => x.origin === "upload");
  $("uploadAnalyses").innerHTML = list.length ? list.map(analysisCardHtml).join("") : `<p class="muted">Henüz analiz yok.</p>`;
}

window.confirmAnalysis = async function (id) {
  const a = analyses.find((x) => x.id === id);
  if (!a) return;
  const val = (suffix, i) => {
    const v = $(`cf-${id}-${i}-${suffix}`)?.value;
    return v === "" || v == null ? null : Number(v);
  };
  const sections = (a.sections || []).map((_, i) => ({ index: i, correct: val("d", i), wrong: val("y", i), blank: val("b", i) }));
  try {
    const r = await postApi("/api/confirm", { analysisId: id, sections });
    toast(r.recorded > 0 ? `${r.recorded} konu istatistiğe eklendi.` : "Doğru ve yanlış sayılarını girmelisin; bu analiz kaydedilemedi.");
  } catch (e) { toast(errText(e)); }
  await loadAll();
};

/* ---------- Deneme Analizi kuyruğu ---------- */
function setupAnalyzeDrop() {
  const area = $("analyzeArea");
  if (!area) return;
  ["dragenter", "dragover"].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.remove("dragover"); }));
  area.addEventListener("drop", (e) => addAnalyzeFiles([...e.dataTransfer.files]));
}

window.handleAnalyzeFiles = function (event) {
  addAnalyzeFiles([...event.target.files]);
  event.target.value = "";
};

function addAnalyzeFiles(files) {
  // Bitmiş öğeleri temizle, kuyruk en fazla 10 görsel
  analyzeFiles = analyzeFiles.filter((f) => f.state === "bekliyor" || f.state === "hata");
  const room = 10 - analyzeFiles.length;
  files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room)).forEach((file) => {
    analyzeFiles.push({ file, name: file.name, state: "bekliyor", msg: "", thumb: URL.createObjectURL(file) });
  });
  renderAnalyzeQueue();
}

function renderAnalyzeQueue() {
  const icons = { bekliyor: "⏳", calisiyor: "🔄", tamam: "✅", tekrar: "♻️", hata: "❌" };
  $("analyzeQueue").innerHTML = analyzeFiles.map((f, i) => `
    <div class="thumb-row">
      <img src="${esc(f.thumb)}" alt="">
      <div class="grow">${icons[f.state] || ""} ${esc(f.name)}<div class="muted" style="font-size:.75rem;">${esc(f.msg || (f.state === "bekliyor" ? "Sırada" : ""))}</div></div>
      ${f.state === "bekliyor" || f.state === "hata" ? `<button class="icon-btn" onclick="removeAnalyzeFile(${i})" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>` : ""}
    </div>`).join("");
  $("analyzeBtn").disabled = !analyzeFiles.some((f) => f.state === "bekliyor" || f.state === "hata");
}

window.removeAnalyzeFile = function (i) {
  URL.revokeObjectURL(analyzeFiles[i]?.thumb);
  analyzeFiles.splice(i, 1);
  renderAnalyzeQueue();
};

window.runAnalysisBatch = async function () {
  if (!activeUid) return toast("Önce giriş yapmalısın.");
  const exam = document.querySelector('input[name="examContext"]:checked').value;
  const btn = $("analyzeBtn");
  btn.disabled = true;

  for (const item of analyzeFiles) {
    if (item.state !== "bekliyor" && item.state !== "hata") continue;
    item.state = "calisiyor"; item.msg = "Fotoğraf hazırlanıyor ve analiz ediliyor..."; renderAnalyzeQueue();
    try {
      const { base64 } = await compressImage(item.file);
      const r = await postApi("/api/analyze", { imageBase64: base64, mimeType: "image/jpeg", examContext: exam });
      if (r.duplicate) { item.state = "tekrar"; item.msg = "Bu görsel daha önce analiz edilmiş."; }
      else {
        const n = r.analysis?.sections?.length || 0;
        item.state = "tamam";
        item.msg = n ? `${n} ders/konu okundu${r.analysis.needsReview ? " · kontrol et" : ""}` : "Veri okunamadı (görsel net değil olabilir)";
      }
    } catch (e) { item.state = "hata"; item.msg = errText(e); }
    renderAnalyzeQueue();
  }
  await loadAll();
  if (!$("tab-topics").classList.contains("active")) reportData = null; // konu raporu yeniden hesaplansın
  renderAnalyzeQueue();
};

/* ---------- Konu & Hata Analizi ---------- */
window.loadReport = async function () {
  const box = $("reportBox");
  if (!reportData) box.innerHTML = `<div class="card"><p class="muted"><i class="fa-solid fa-spinner fa-spin"></i> Rapor hazırlanıyor...</p></div>`;
  $("reportBtn").disabled = true;
  try {
    reportData = await postApi("/api/report");
    renderReport();
  } catch (e) {
    box.innerHTML = `<div class="card"><strong class="error-text">Hata:</strong> ${esc(errText(e))}</div>`;
  } finally { $("reportBtn").disabled = false; }
};

function renderReport() {
  const r = reportData;
  if (!r) return;
  const t = r.totals;
  const pct = (x) => Math.round(x * 100);

  const summary = `
    <div class="card">
      <h4>Genel görünüm</h4>
      <div class="grid-2" style="margin:1rem 0 0;">
        <div class="stat-row"><span>Denenen soru</span><strong>${esc(t.attempted)}</strong></div>
        <div class="stat-row"><span>Yanlış / Boş</span><strong style="color:var(--warning);">${esc(t.wrong)} / ${esc(t.blank)}</strong></div>
        <div class="stat-row"><span>Takip edilen konu</span><strong>${esc(t.topics)}</strong></div>
        <div class="stat-row"><span>Okunan analiz</span><strong>${esc(r.dataQuality.analyses)}</strong></div>
      </div>
      ${(r.advice || []).map((x) => `<div class="note-box" style="margin-top:.75rem;margin-bottom:0;">${esc(x)}</div>`).join("")}
    </div>`;

  const causes = r.causeTotals.length ? `
    <div class="card">
      <h4><i class="fa-solid fa-magnifying-glass"></i> Hatalar neden kaynaklanıyor?</h4>
      <div style="margin-top:1rem;">
        ${r.causeTotals.map((c) => `
          <div class="cause-bar"><div>${esc(c.label)} <span class="muted" style="float:right;">${esc(c.count)} kez · %${esc(c.percent)}</span></div>
            <div class="bar"><span style="width:${Math.min(100, c.percent)}%"></span></div></div>`).join("")}
      </div>
    </div>` : "";

  const subjects = r.weakSubjects.length ? `
    <div class="card"><h4>Derslere göre hata oranı</h4><div style="margin-top:1rem;">
      ${r.weakSubjects.map((s) => `
        <div class="weak-item"><div><strong>${esc(s.subject)}</strong><span class="muted" style="float:right;">%${pct(s.missRate)} · ${esc(s.attempted)} soru</span></div>
          <div class="bar"><span style="width:${pct(s.missRate)}%"></span></div></div>`).join("")}
    </div></div>` : "";

  const topics = r.topics.length ? `
    <div class="card"><h4>Konu konu detay</h4><div style="margin-top:1rem;">
      ${r.topics.map((x) => `
        <details class="topic-card">
          <summary><span><strong>${esc(x.subject)} • ${esc(x.topic)}</strong>${x.chronic ? ' <span class="badge bad">Kronik</span>' : ""}</span>
            <span class="muted">%${pct(x.missRate)} hata${x.dominantLabel ? " · " + esc(x.dominantLabel) : ""}</span></summary>
          <div class="inner">
            <div>${esc(x.correct)} doğru · ${esc(x.wrong)} yanlış · ${esc(x.blank)} boş (${esc(x.attempted)} soru, ${esc(x.sessions)} oturum)</div>
            ${x.causes.length ? `<div style="margin-top:.5rem;"><strong style="color:var(--text-main);">Neden dağılımı:</strong> ${x.causes.map((c) => `${esc(c.label)} (${esc(c.count)})`).join(", ")}</div>` : ""}
            <div style="margin-top:.5rem;"><strong style="color:var(--text-main);">Ne yapmalı:</strong> ${esc(x.remedy)}</div>
            ${x.examples.length ? `<div style="margin-top:.5rem;"><strong style="color:var(--text-main);">Son gözlemler:</strong><ul style="margin:.3rem 0 0 1.1rem;">${x.examples.map((e) => `<li>${esc(e.label)}: ${esc(e.description)}</li>`).join("")}</ul></div>` : ""}
          </div>
        </details>`).join("")}
    </div></div>` : `<div class="card"><p class="muted">Henüz konu bazlı veri yok. Bir soru çöz veya Deneme Analizi sekmesinden fotoğraf yükle.</p></div>`;

  $("reportBox").innerHTML = summary + causes + subjects + topics;
}

window.generateReportAdvice = async function () {
  const btn = $("aiReportBtn"), card = $("reportAiCard"), text = $("reportAiText");
  btn.disabled = true;
  card.style.display = "block";
  text.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Koç verilerini yorumluyor...`;
  try {
    const data = await postApi("/api/coach");
    text.innerHTML = formatText(data.advice);
  } catch (e) {
    text.innerHTML = `<strong class="error-text">Hata:</strong> ${esc(errText(e))}`;
  } finally { btn.disabled = false; }
};

/* ---------- Sistem testi ---------- */
window.closeHealth = function () { $("healthModal").style.display = "none"; };

window.runHealthCheck = async function () {
  if (!activeUid) return toast("Önce giriş yapmalısın.");
  $("healthModal").style.display = "flex";
  $("healthBody").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Test ediliyor...`;
  const row = (name, ok, extra = "") => `<div class="chk-row"><span>${esc(name)}${extra ? `<div class="muted" style="font-size:.75rem;">${esc(extra)}</div>` : ""}</span><span>${ok ? "✅" : "❌"}</span></div>`;
  try {
    const h = await postApi("/api/health");
    $("healthBody").innerHTML =
      `<p style="margin-bottom:.75rem;">${h.ok ? "<strong style='color:var(--success);'>Temel sistemler çalışıyor.</strong>" : "<strong class='error-text'>Sorun bulundu.</strong>"}</p>` +
      Object.entries(h.env).map(([k, v]) => row(k, v)).join("") +
      row("Firestore bağlantısı", h.firestore.ok, h.firestore.error || "") +
      row(`Gemini (${h.gemini.model})`, h.gemini.ok, h.gemini.error || "");
  } catch (e) {
    $("healthBody").innerHTML = `<strong class="error-text">Test çalıştırılamadı:</strong> ${esc(errText(e))}`;
  }
};
