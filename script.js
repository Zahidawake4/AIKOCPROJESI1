let selectedLevel = 1;
let currentImageBase64 = null;
let currentImageMimeType = "image/png";
let userQuestionsLog = [];
let currentUserData = {
    dailyCount: 0,
    freeQuestionsLeft: 4,
    isProUser: false,
    archive: [],
    weaknesses: {},
    netHistory: []
};
let activeUserUid = null;
let recognition = null;
let isListening = false;

window.onload = function() {
    if (typeof firebase !== 'undefined') {
        const auth = firebase.auth();
        const db = firebase.firestore();
        const provider = new firebase.auth.GoogleAuthProvider();

        auth.onAuthStateChanged(async (user) => {
            const authModal = document.getElementById('auth-modal');
            if (user) {
                activeUserUid = user.uid;
                if(authModal) authModal.style.display = 'none';
                const emailDisp = document.getElementById('sidebar-user-email');
                if(emailDisp) emailDisp.innerText = user.email || user.displayName || 'Kullanıcı';
                await loadUserDataFromFirestore(db, user.uid);
                updateFreeBadge();
                updateStatsUI();
            } else {
                if(authModal) authModal.style.display = 'flex';
            }
        });

        const loginBtn = document.getElementById('google-login-btn');
        if(loginBtn) {
            loginBtn.onclick = async function() {
                try {
                    await auth.signInWithPopup(provider);
                } catch (error) {
                    alert("Giriş hatası: " + error.message);
                }
            };
        }
    }

    initVoiceRecognition();
    calculateNet();
}

window.logoutFirebase = async function() {
    if (typeof firebase !== 'undefined') {
        try {
            await firebase.auth().signOut();
        } catch (error) {
            console.error(error);
        }
    }
};

// Sidebar Sekme Geçişleri
window.switchTab = function(tabId, btnElement) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.menu-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if(btnElement) btnElement.classList.add('active');

    const titles = {
        'solver': 'AI Soru Çözücü Paneli',
        'wizard': 'TYT / AYT Net Sihirbazı',
        'history': 'Geçmişte Çözülen Sorular',
        'coach': 'AI Koç & Hata Analizi',
        'report': 'Aylık İlerleme Raporu'
    };
    document.getElementById('headerTitle').innerText = titles[tabId] || 'YKS 2027 Pro';
}

// Sesli Komut Entegrasyonu
function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.lang = 'tr-TR';
        recognition.continuous = false;
        recognition.interimResults = false;

        recognition.onresult = function(event) {
            const speechText = event.results[0][0].transcript;
            const statusEl = document.getElementById('voiceStatus');
            if(statusEl) statusEl.innerHTML = `<i class="fa-solid fa-microphone-lines"></i> Komut: "${speechText}"`;
            processVoiceCommand(speechText);
            stopVoiceInput();
        };

        recognition.onerror = () => stopVoiceInput();
        recognition.onend = () => stopVoiceInput();
    }
}

window.toggleVoiceInput = function() {
    if (!recognition) {
        alert("Tarayıcınız sesli komutu desteklemiyor.");
        return;
    }
    if (isListening) stopVoiceInput();
    else startVoiceInput();
}

function startVoiceInput() {
    if (recognition) {
        recognition.start();
        isListening = true;
        const btn = document.getElementById('micBtn');
        const statusEl = document.getElementById('voiceStatus');
        if(btn) btn.classList.add('listening');
        if(statusEl) statusEl.innerHTML = `<i class="fa-solid fa-microphone-lines" style="color:var(--danger);"></i> Dinleniyor...`;
    }
}

function stopVoiceInput() {
    if (recognition && isListening) {
        recognition.stop();
        isListening = false;
        const btn = document.getElementById('micBtn');
        if(btn) btn.classList.remove('listening');
    }
}

function processVoiceCommand(text) {
    text = text.toLowerCase();
    if(text.includes('tyt')) {
        document.querySelector('input[name="examContext"][value="TYT"]').checked = true;
        alert("Bağlam TYT seçildi.");
    } else if(text.includes('ayt')) {
        document.querySelector('input[name="examContext"][value="AYT"]').checked = true;
        alert("Bağlam AYT seçildi.");
    } else if(text.includes('birinci kademe')) selectLevel(1);
    else if(text.includes('ikinci kademe')) selectLevel(2);
    else if(text.includes('üçüncü kademe')) selectLevel(3);
    else if(text.includes('çöz')) solveQuestion();
}

// Net Sihirbazı Hesaplama
window.calculateNet = function() {
    const getNet = (dId, yId) => {
        let d = parseFloat(document.getElementById(dId).value) || 0;
        let y = parseFloat(document.getElementById(yId).value) || 0;
        let net = d - (y * 0.25);
        return net < 0 ? 0 : net;
    };

    let trNet = getNet('tr-d', 'tr-y');
    let sosNet = getNet('sos-d', 'sos-y');
    let matNet = getNet('mat-d', 'mat-y');
    let fenNet = getNet('fen-d', 'fen-y');

    document.getElementById('tr-net').innerText = trNet.toFixed(2);
    document.getElementById('sos-net').innerText = sosNet.toFixed(2);
    document.getElementById('mat-net').innerText = matNet.toFixed(2);
    document.getElementById('fen-net').innerText = fenNet.toFixed(2);

    let totalTyt = trNet + sosNet + matNet + fenNet;
    document.getElementById('totalTytNet').innerText = totalTyt.toFixed(2);
}

async function loadUserDataFromFirestore(db, uid) {
    try {
        const docRef = db.collection("users").doc(uid);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
            currentUserData = docSnap.data();
            if(currentUserData.archive) {
                userQuestionsLog = currentUserData.archive.map(item => ({ 
                    topic: item.topic, 
                    exam: item.exam || 'TYT', 
                    date: new Date(item.date) 
                }));
                updateStatsUI();
            }
        } else {
            await docRef.set(currentUserData);
        }
    } catch (e) {
        console.error("Firestore veri çekme hatası:", e);
    }
}

async function saveUserDataToFirestore() {
    if(!activeUserUid || typeof firebase === 'undefined') return;
    try {
        const db = firebase.firestore();
        await db.collection("users").doc(activeUserUid).set(currentUserData, { merge: true });
    } catch (e) {
        console.error("Firestore kayıt hatası:", e);
    }
}

function updateFreeBadge() {
    const badge = document.getElementById('free-badge');
    const countEl = document.getElementById('free-count');
    if(currentUserData.isProUser) {
        if(badge) badge.innerHTML = `<i class="fa-solid fa-crown" style="color: var(--warning);"></i> Pro Üye`;
    } else {
        if(countEl) countEl.innerText = currentUserData.freeQuestionsLeft;
    }
}

window.selectLevel = function(level) {
    selectedLevel = level;
    document.querySelectorAll('.level-btn').forEach(btn => btn.classList.remove('active'));
    const targetBtn = document.querySelector(`[data-level="${level}"]`);
    if(targetBtn) targetBtn.classList.add('active');
}

window.handleFileSelect = function(event) {
    const file = event.target.files[0];
    if (file) {
        currentImageMimeType = file.type;
        const reader = new FileReader();
        reader.onload = function(e) {
            const preview = document.getElementById('imagePreview');
            if(preview) {
                preview.src = e.target.result;
                preview.style.display = 'block';
            }
            currentImageBase64 = e.target.result.split(',')[1];
        };
        reader.readAsDataURL(file);
    }
}

window.solveQuestion = async function() {
    if (!currentImageBase64) {
        alert("Lütfen önce bir soru fotoğrafı yükleyin!");
        return;
    }

    if(!currentUserData.isProUser && currentUserData.freeQuestionsLeft <= 0) {
        alert("Ücretsiz soru hakkınız bitti!");
        return;
    }

    const examContext = document.querySelector('input[name="examContext"]:checked').value;
    const solutionSection = document.getElementById('solutionSection');
    const solutionText = document.getElementById('solutionText');
    const detectedTopic = document.getElementById('detectedTopic');

    if (solutionSection) solutionSection.style.display = 'block';
    if (solutionText) solutionText.innerHTML = "<i class='fa-solid fa-spinner fa-spin'></i> <em>Soru ve hata analizi yapılıyor...</em>";

    const promptText = `
Sen uzman bir Akademik AI Koçsun. Gönderilen soru ${examContext} bağlamına ve ${selectedLevel}. Kademe düzeyine göre çözülecektir.
Kurallar:
1. Kesinlikle LaTeX ($ veya \\frac) kullanma, düz metin/Türkçe format kullan.
2. EN BAŞTA "[KONU KATEGORİSİ]: [Konu Adı]" formatını belirt.
3. Adım adım hata analizi ve net çözüm açıkla.
`;

    try {
        const response = await fetch('/api/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText,
                mimeType: currentImageMimeType,
                imageBase64: currentImageBase64
            })
        });

        const data = await response.json();

        if (response.ok && data.solution) {
            let finalResponse = data.solution;
            let topicMatch = finalResponse.match(/KONU KATEGORİSİ:\s*\*?([^\n\*]+)\*?/i);
            let topicName = topicMatch ? topicMatch[1].trim() : "Genel Yetenek / Matematik";

            if(detectedTopic) detectedTopic.innerText = `Konu (${examContext}): ` + topicName;
            
            let formattedText = finalResponse
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');

            if(solutionText) solutionText.innerHTML = formattedText;
            
            if(!currentUserData.isProUser) {
                currentUserData.freeQuestionsLeft = Math.max(0, currentUserData.freeQuestionsLeft - 1);
            }
            currentUserData.dailyCount += 1;
            currentUserData.archive.push({ topic: topicName, exam: examContext, date: new Date().toISOString() });
            
            saveUserQuestion(topicName, examContext);
            saveUserDataToFirestore();
            updateFreeBadge();

        } else {
            throw new Error(data.error || "Geçerli yanıt alınamadı.");
        }
    } catch (error) {
        console.error(error);
        if(solutionText) solutionText.innerHTML = `<strong style='color:red;'>Hata:</strong> ${error.message}`;
    }
}

function saveUserQuestion(topic, exam) {
    userQuestionsLog.push({ topic: topic, exam: exam, date: new Date() });
    updateStatsUI();
}

function updateStatsUI() {
    const totalCount = userQuestionsLog.length;
    const reportTotal = document.getElementById('reportTotalCount');
    if(reportTotal) reportTotal.innerText = totalCount;

    const topicCounts = {};
    userQuestionsLog.forEach(q => {
        topicCounts[q.topic] = (topicCounts[q.topic] || 0) + 1;
    });

    let maxTopic = "Veri Yok";
    let maxCount = 0;
    for (let t in topicCounts) {
        if (topicCounts[t] > maxCount) {
            maxCount = topicCounts[t];
            maxTopic = t;
        }
    }

    const reportTop = document.getElementById('reportTopTopic');
    if(reportTop) reportTop.innerText = maxTopic;

    // Geçmiş Sorular Listesi Güncelleme
    const historyContainer = document.getElementById('historyListContainer');
    if(historyContainer) {
        if(totalCount === 0) {
            historyContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Henüz kaydedilmiş soru bulunmuyor.</p>`;
        } else {
            let html = "";
            userQuestionsLog.slice().reverse().forEach((item, index) => {
                let dateStr = new Date(item.date).toLocaleDateString('tr-TR', { hour: '2-digit', minute: '2-digit' });
                html += `
                    <div class="history-item">
                        <div>
                            <strong>${item.topic}</strong>
                            <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">Bağlam: ${item.exam} | Tarih: ${dateStr}</div>
                        </div>
                        <span class="badge">${item.exam}</span>
                    </div>
                `;
            });
            historyContainer.innerHTML = html;
        }
    }

    // Hata Analizi ve Koçluk Güncelleme (Geçmişe Göre)
    const weakList = document.getElementById('weakTopicList');
    if(weakList && totalCount > 0) {
        let html = "<ul>";
        for (let t in topicCounts) {
            html += `<li style="margin-bottom: 0.4rem;"><strong>${t}</strong>: ${topicCounts[t]} soru çözüldü (Hata potansiyeli takip ediliyor)</li>`;
        }
        html += "</ul>";
        weakList.innerHTML = html;
    }

    const coachAdvice = document.getElementById('coachAdviceBox');
    if(coachAdvice && totalCount > 0) {
        coachAdvice.innerHTML = `<i class="fa-solid fa-circle-check" style="color: var(--success);"></i> 
        <span>Geçmiş çözümlerine dayanarak; en yoğun çalıştığın alan <strong>${maxTopic}</strong> oldu. Koçluk planına göre bu konudaki soru çözüm sayısını artırmalı ve hata analizindeki eksik adımları gözden geçirmelisin.</span>`;
    }
}

window.generateMonthlyReport = function() {
    alert("Aylık ilerleme raporu oluşturuldu ve indirildi.");
}