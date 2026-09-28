/* ============ Durum ============ */
let selectedLevel = 1;
let currentImageBase64 = null;
let currentImageMimeType = "image/jpeg";
let questions = [];          // users/{uid}/questions kayıtları (yeniden eskiye)
let activeUserUid = null;
let recognition = null;
let isListening = false;
let currentUserData = {
  freeQuestionsLeft: 4,
  isProUser: false,
  goal: "",
  dailyHours: 4,
  netHistory: [],
};

const ERROR_OUTCOMES = ["yanlis", "bos", "bilmiyorum"]; // "hata" sayılan durumlar
const OUTCOME_LABELS = {
  yanlis: "Yanlış", bos: "Boş", bilmiyorum: "Bilmiyor", yavas: "Yavaş", merak: "Merak",
};

/* ============ Yardımcılar ============ */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Önce HTML'i kaçır (XSS koruması), sonra **kalın** ve satır sonlarını çevir
function formatText(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 3500);
}

async function getIdToken() {
  const user = firebase.auth().currentUser;
  if (!user) throw new Error("Oturum bulunamadı, lütfen tekrar giriş yap.");
  return user.getIdToken();
}

async function postApi(path, body) {
  const token = await getIdToken();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Sunucu hatası: ${response.status}`);
  return data;
}

/* ============ Başlangıç / Giriş ============ */
window.onload = function () {
  if (typeof firebase !== "undefined") {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const provider = new firebase.auth.GoogleAuthProvider();

    auth.onAuthStateChanged(async (user) => {
      const authModal = $("auth-modal");
      if (user) {
        activeUserUid = user.uid;
        authModal.style.display = "none";
        $("sidebar-user-email").innerText = user.email || user.displayName || "Kullanıcı";
        await loadUserData(db, user.uid);
        updateFreeBadge();
        updateStatsUI();
        renderNetHistory();
      } else {
        activeUserUid = null;
        authModal.style.display = "flex";
      }
    });

    $("google-login-btn").onclick = async () => {
      try { await auth.signInWithPopup(provider); }
      catch (error) { toast("Giriş hatası: " + error.message); }
    };
  }

  setupDragDrop();
  initVoiceRecognition();
  calculateNet();
};

window.logoutFirebase = async function () {
  try {
    await firebase.auth().signOut();
    questions = [];
  } catch (error) { console.error(error); }
};

window.switchTab = function (tabId, btn) {
  document.querySelectorAll(".tab-content").forEach((el) => el.classList.remove("active"));
  document.querySelectorAll(".menu-btn").forEach((el) => el.classList.remove("active"));
  $(`tab-${tabId}`).classList.add("active");
  if (btn) btn.classList.add("active");

  const titles = {
    solver: "AI Soru Çözücü Paneli",
    wizard: "TYT Net Sihirbazı",
    history: "Geçmişte Çözülen Sorular",
    coach: "AI Koç & Hata Analizi",
    report: "Aylık İlerleme Raporu",
  };
  $("headerTitle").innerText = titles[tabId] || "YKS 2027 Pro";
};

window.selectLevel = function (level) {
  selectedLevel = level;
  document.querySelectorAll(".level-btn").forEach((b) => b.classList.remove("active"));
  const target = document.querySelector(`[data-level="${level}"]`);
  if (target) target.classList.add("active");
};

/* ============ Firestore ============ */
async function loadUserData(db, uid) {
  try {
    const userRef = db.collection("users").doc(uid);
    const snap = await userRef.get();
    if (snap.exists) {
      currentUserData = { ...currentUserData, ...snap.data() };
    } else {
      await userRef.set({ ...currentUserData, createdAt: new Date().toISOString() });
    }
    $("goalInput").value = currentUserData.goal || "";
    $("hoursInput").value = currentUserData.dailyHours ?? 4;

    const qSnap = await userRef.collection("questions").orderBy("date", "desc").limit(300).get();
    questions = qSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error("Firestore veri çekme hatası:", e);
    toast("Veriler yüklenemedi: " + e.message);
  }
}

async function saveUserData(fields) {
  if (!activeUserUid) return;
  Object.assign(currentUserData, fields);
  try {
    await firebase.firestore().collection("users").doc(activeUserUid).set(fields, { merge: true });
  } catch (e) {
    console.error("Firestore kayıt hatası:", e);
    toast("Kayıt hatası: " + e.message);
  }
}

async function saveQuestion(record) {
  if (!activeUserUid) return;
  try {
    const ref = await firebase.firestore()
      .collection("users").doc(activeUserUid).collection("questions").add(record);
    questions.unshift({ id: ref.id, ...record });
  } catch (e) {
    console.error("Soru kaydı hatası:", e);
    questions.unshift({ id: "local-" + Date.now(), ...record });
  }
}

function updateFreeBadge() {
  const badge = $("free-badge");
  if (currentUserData.isProUser) {
    badge.innerHTML = `<i class="fa-solid fa-crown" style="color:var(--warning);"></i> Pro Üye`;
  } else {
    badge.innerHTML = `Kalan Hak: <strong id="free-count">${currentUserData.freeQuestionsLeft}</strong>`;
  }
}

window.saveProfile = async function () {
  const goal = $("goalInput").value.trim().slice(0, 120);
  const dailyHours = Math.min(16, Math.max(0, parseFloat($("hoursInput").value) || 0));
  await saveUserData({ goal, dailyHours });
  toast("Hedefin kaydedildi.");
};

/* ============ Fotoğraf ============ */
function setupDragDrop() {
  const area = $("uploadArea");
  ["dragenter", "dragover"].forEach((ev) =>
    area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) =>
    area.addEventListener(ev, (e) => { e.preventDefault(); area.classList.remove("dragover"); }));
  area.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) processImageFile(file);
  });
}

window.handleFileSelect = function (event) {
  const file = event.target.files[0];
  if (file) processImageFile(file);
};

// Fotoğrafı küçültüp JPEG'e çevirir (Vercel istek limiti + hız için)
function processImageFile(file) {
  if (!file.type.startsWith("image/")) return toast("Lütfen bir resim dosyası seç.");
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const maxSide = 1400;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    currentImageMimeType = "image/jpeg";
    currentImageBase64 = dataUrl.split(",")[1];
    const preview = $("imagePreview");
    preview.src = dataUrl;
    preview.style.display = "block";
    URL.revokeObjectURL(url);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast("Fotoğraf okunamadı."); };
  img.src = url;
}

/* ============ Soru Çözümü ============ */
window.solveQuestion = async function () {
  if (!currentImageBase64) return toast("Lütfen önce bir soru fotoğrafı yükle!");
  if (!activeUserUid) return toast("Önce giriş yapmalısın.");
  if (!currentUserData.isProUser && currentUserData.freeQuestionsLeft <= 0) {
    return toast("Ücretsiz soru hakkın bitti!");
  }

  const exam = document.querySelector('input[name="examContext"]:checked').value;
  const outcome = $("outcomeSelect").value;
  const note = $("studentNote").value.trim();
  const btn = $("solveBtn");

  $("solutionSection").style.display = "block";
  $("detectedTopic").innerText = "Konu: Analiz ediliyor...";
  $("solutionText").innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <em>Soru ve hata analizi yapılıyor...</em>`;
  btn.disabled = true;

  try {
    const data = await postApi("/api/solve", {
      examContext: exam,
      level: selectedLevel,
      outcome,
      note,
      mimeType: currentImageMimeType,
      imageBase64: currentImageBase64,
    });

    $("detectedTopic").innerText = `${data.subject} • ${data.topic} (${exam})`;
    $("solutionText").innerHTML = formatText(data.solution);

    const record = {
      subject: data.subject,
      topic: data.topic,
      errorType: data.errorType,
      exam,
      level: selectedLevel,
      outcome,
      note: note.slice(0, 600),
      solution: data.solution.slice(0, 8000),
      date: new Date().toISOString(),
    };
    await saveQuestion(record);

    if (!currentUserData.isProUser) {
      await saveUserData({ freeQuestionsLeft: Math.max(0, currentUserData.freeQuestionsLeft - 1) });
    }
    updateFreeBadge();
    updateStatsUI();
    $("studentNote").value = "";
  } catch (error) {
    console.error("Çözüm hatası:", error);
    $("detectedTopic").innerText = "Bir sorun oluştu";
    $("solutionText").innerHTML = `<strong class="error-text">Hata:</strong> ${esc(error.message)}`;
  } finally {
    btn.disabled = false;
  }
};

/* ============ İstatistik / Hata Analizi ============ */
function computeTopicStats(list) {
  const map = {};
  list.forEach((q) => {
    const key = `${q.subject || "Genel"} • ${q.topic || "Belirsiz"}`;
    if (!map[key]) map[key] = { key, subject: q.subject || "Genel", topic: q.topic || "Belirsiz", count: 0, errors: 0 };
    map[key].count += 1;
    if (ERROR_OUTCOMES.includes(q.outcome)) map[key].errors += 1;
  });
  return Object.values(map).sort((a, b) => b.errors - a.errors || b.count - a.count);
}

function updateStatsUI() {
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = questions.filter((q) => new Date(q.date).getTime() >= monthAgo);
  const stats = computeTopicStats(questions);

  $("reportTotalCount").innerText = recent.length;
  const worst = stats.find((s) => s.errors > 0);
  $("reportTopTopic").innerText = worst ? worst.key : "Veri Yok";

  // Geçmiş listesi
  const container = $("historyListContainer");
  if (questions.length === 0) {
    container.innerHTML = `<p class="muted">Henüz kaydedilmiş soru bulunmuyor.</p>`;
  } else {
    container.innerHTML = questions.map((q, i) => {
      const d = new Date(q.date).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
      return `
        <div class="history-item clickable" onclick="openHistoryItem(${i})">
          <div>
            <strong>${esc(q.subject || "Genel")} • ${esc(q.topic)}</strong>
            <div class="muted" style="font-size:.75rem;margin-top:.2rem;">
              ${esc(OUTCOME_LABELS[q.outcome] || "")} | Kademe ${esc(q.level || 1)} | ${esc(d)}
            </div>
          </div>
          <span class="badge">${esc(q.exam)}</span>
        </div>`;
    }).join("");
  }

  // Hata analizi listesi
  const weakList = $("weakTopicList");
  if (stats.length === 0) {
    weakList.innerHTML = "<p>Yeterli veri yok.</p>";
  } else {
    weakList.innerHTML = "<ul style='padding-left:1.1rem;'>" + stats.slice(0, 8).map((s) =>
      `<li style="margin-bottom:.4rem;"><strong>${esc(s.key)}</strong>: ${s.count} soru, ${s.errors} hata</li>`
    ).join("") + "</ul>";
  }
}

window.openHistoryItem = function (index) {
  const q = questions[index];
  if (!q) return;
  switchTab("solver", document.querySelector(".menu-btn"));
  $("solutionSection").style.display = "block";
  $("detectedTopic").innerText = `${q.subject || "Genel"} • ${q.topic} (${q.exam})`;
  $("solutionText").innerHTML = formatText(q.solution || "Bu soru için kayıtlı çözüm yok.");
};

/* ============ AI Koç ============ */
window.generateCoachAdvice = async function () {
  if (questions.length < 3) {
    return toast("Kişisel plan için en az 3 soru çözmelisin.");
  }
  const btn = $("coachBtn");
  const box = $("coachAdviceBox");
  btn.disabled = true;
  box.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Koçun verilerini inceliyor...`;

  const summary = {
    hedef: currentUserData.goal || "belirtilmedi",
    gunlukCalismaSaati: currentUserData.dailyHours,
    toplamSoru: questions.length,
    konular: computeTopicStats(questions).slice(0, 12).map((s) => ({
      ders: s.subject, konu: s.topic, soru: s.count, hata: s.errors,
    })),
    hataTurleri: questions.reduce((acc, q) => {
      if (ERROR_OUTCOMES.includes(q.outcome) && q.errorType) acc[q.errorType] = (acc[q.errorType] || 0) + 1;
      return acc;
    }, {}),
    sonNetler: (currentUserData.netHistory || []).slice(-6),
  };

  try {
    const data = await postApi("/api/coach", { summary });
    box.classList.remove("muted");
    box.innerHTML = formatText(data.advice);
  } catch (error) {
    box.innerHTML = `<strong class="error-text">Hata:</strong> ${esc(error.message)}`;
  } finally {
    btn.disabled = false;
  }
};

/* ============ Net Sihirbazı ============ */
function getNet(dId, yId, max) {
  let d = Math.max(0, parseFloat($(dId).value) || 0);
  let y = Math.max(0, parseFloat($(yId).value) || 0);
  if (d + y > max) { y = Math.max(0, max - d); }
  return Math.max(0, d - y * 0.25);
}

window.calculateNet = function () {
  const tr = getNet("tr-d", "tr-y", 40);
  const sos = getNet("sos-d", "sos-y", 20);
  const mat = getNet("mat-d", "mat-y", 40);
  const fen = getNet("fen-d", "fen-y", 20);
  $("tr-net").innerText = tr.toFixed(2);
  $("sos-net").innerText = sos.toFixed(2);
  $("mat-net").innerText = mat.toFixed(2);
  $("fen-net").innerText = fen.toFixed(2);
  $("totalTytNet").innerText = (tr + sos + mat + fen).toFixed(2);
};

window.saveNetResult = async function () {
  if (!activeUserUid) return toast("Önce giriş yapmalısın.");
  const entry = {
    date: new Date().toISOString(),
    tr: +$("tr-net").innerText,
    sos: +$("sos-net").innerText,
    mat: +$("mat-net").innerText,
    fen: +$("fen-net").innerText,
    total: +$("totalTytNet").innerText,
  };
  const history = [...(currentUserData.netHistory || []), entry].slice(-30);
  await saveUserData({ netHistory: history });
  renderNetHistory();
  toast("Deneme kaydedildi.");
};

function renderNetHistory() {
  const box = $("netHistoryBox");
  const list = (currentUserData.netHistory || []).slice().reverse().slice(0, 8);
  if (list.length === 0) { box.innerHTML = ""; return; }
  box.innerHTML = `<h4 style="margin-bottom:.75rem;">Kayıtlı Denemeler</h4>` + list.map((n) =>
    `<div class="history-item"><span>${esc(new Date(n.date).toLocaleDateString("tr-TR"))}</span>
     <strong>${esc(n.total.toFixed(2))} net</strong></div>`).join("");
}

/* ============ Aylık Rapor ============ */
window.generateMonthlyReport = function () {
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = questions.filter((q) => new Date(q.date).getTime() >= monthAgo);
  if (recent.length === 0) return toast("Son 30 günde kayıtlı soru yok.");

  const stats = computeTopicStats(recent);
  const nets = (currentUserData.netHistory || []).filter((n) => new Date(n.date).getTime() >= monthAgo);
  const lines = [
    "YKS 2027 PRO - AYLIK İLERLEME RAPORU",
    `Tarih: ${new Date().toLocaleDateString("tr-TR")}`,
    `Hedef: ${currentUserData.goal || "belirtilmedi"}`,
    "",
    `Son 30 günde çözülen soru: ${recent.length}`,
    "",
    "KONU BAZLI DURUM (hata sayısına göre):",
    ...stats.map((s) => `- ${s.key}: ${s.count} soru, ${s.errors} hata`),
    "",
    "DENEME NETLERİ:",
    ...(nets.length
      ? nets.map((n) => `- ${new Date(n.date).toLocaleDateString("tr-TR")}: ${n.total.toFixed(2)} net`)
      : ["- Kayıtlı deneme yok"]),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "yks-aylik-rapor.txt";
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ============ Sesli Komut ============ */
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
  if (recognition && isListening) {
    try { recognition.stop(); } catch {}
  }
  isListening = false;
  $("micBtn").classList.remove("listening");
}

function processVoiceCommand(raw) {
  const text = raw.toLocaleLowerCase("tr-TR");
  if (text.includes("tyt")) {
    document.querySelector('input[name="examContext"][value="TYT"]').checked = true;
    toast("Bağlam TYT seçildi.");
  } else if (text.includes("ayt")) {
    document.querySelector('input[name="examContext"][value="AYT"]').checked = true;
    toast("Bağlam AYT seçildi.");
  } else if (text.includes("birinci kademe")) selectLevel(1);
  else if (text.includes("ikinci kademe")) selectLevel(2);
  else if (text.includes("üçüncü kademe")) selectLevel(3);
  else if (text.includes("çöz")) solveQuestion();
}
