// RemoteExambro Frontend Application Logic

let state = {
  serverIp: '127.0.0.1',
  port: 3000,
  clients: [],
  selectedIds: new Set(),
  filter: 'all',
  selectedLab: 'all',
  sortBy: 'desk',
  searchQuery: '',
  logs: []
};

let ws = null;
let powerActionType = 'shutdown'; // 'shutdown' | 'restart'

// --- INISIALISASI WEBSOCKET & REST ---

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Terhubung ke Server Master Controller');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'INIT_STATE') {
        state.serverIp = msg.data.serverIp;
        state.port = msg.data.port;
        state.clients = msg.data.clients || [];
        state.logs = msg.data.logs || [];
        document.getElementById('serverIpBadge').textContent = `${state.serverIp}:${state.port}`;
        renderAll();
      } else if (msg.type === 'CAMERA_UPDATE') {
        if (activeCameraClientId === msg.clientId) {
          const imgEl = document.getElementById('modalCameraImg');
          const loadingEl = document.getElementById('modalCameraLoading');
          const infoEl = document.getElementById('modalCameraInfo');
          const timeEl = document.getElementById('modalCameraTime');

          if (imgEl) {
            imgEl.src = msg.image;
            imgEl.classList.remove('hidden');
          }
          if (loadingEl) loadingEl.classList.add('hidden');
          if (infoEl) infoEl.textContent = `Perangkat: ${msg.webcamName || 'Kamera Siswa'} (${msg.hostname || ''})`;
          if (timeEl) timeEl.textContent = `Waktu Pengambilan: ${msg.time}`;

          // Jika mode Live Stream aktif, jadwalkan permintaan frame berikutnya otomatis
          if (isLiveCamera && !document.getElementById('modalCamera').classList.contains('hidden')) {
            clearTimeout(liveStreamTimer);
            liveStreamTimer = setTimeout(() => {
              if (isLiveCamera && activeCameraClientId) {
                sendCommand('camera_snapshot', [activeCameraClientId], { crop: currentCropMode });
              }
            }, 800);
          }
        }
      } else if (msg.type === 'SCREENSHOT_UPDATE') {
        // Realtime update modal screenshot jika sedang dibuka
        const imgEl = document.getElementById('modalScreenshotImg');
        const timeEl = document.getElementById('modalScreenshotTime');
        if (imgEl && !document.getElementById('modalScreenshot').classList.contains('hidden')) {
          imgEl.src = msg.image;
          if (timeEl) timeEl.textContent = `Diambil pada: ${msg.time}`;
        }
      } else if (msg.type === 'CLIENTS_UPDATE') {
        state.clients = msg.data;
        renderAll();
        if (activeCameraClientId) {
          const currentCamClient = state.clients.find(c => c.clientId === activeCameraClientId);
          if (currentCamClient && currentCamClient.latestCameraImage) {
            const imgEl = document.getElementById('modalCameraImg');
            const loadingEl = document.getElementById('modalCameraLoading');
            if (imgEl) {
              imgEl.src = currentCamClient.latestCameraImage;
              imgEl.classList.remove('hidden');
            }
            if (loadingEl) loadingEl.classList.add('hidden');
            document.getElementById('modalCameraInfo').textContent = `Perangkat: ${currentCamClient.webcamName || 'Kamera Siswa'}`;
            document.getElementById('modalCameraTime').textContent = `Waktu Pengambilan: ${currentCamClient.cameraTime || '-'}`;
          }
        }
      } else if (msg.type === 'LOG_ENTRY') {
        state.logs.unshift(msg.data);
        if (state.logs.length > 200) state.logs.pop();
        renderLogs();
      }
    } catch (e) {
      console.error('[WS] Gagal parse pesan:', e);
    }
  };

  ws.onclose = () => {
    console.warn('[WS] Koneksi terputus. Mencoba menghubungkan kembali dalam 2 detik...');
    setTimeout(connectWebSocket, 2000);
  };
}

// Fallback manual refresh
async function fetchState() {
  try {
    const [infoRes, clientsRes, logsRes] = await Promise.all([
      fetch('/api/info').then((r) => r.json()),
      fetch('/api/clients').then((r) => r.json()),
      fetch('/api/logs').then((r) => r.json())
    ]);

    state.serverIp = infoRes.serverIp;
    state.port = infoRes.port;
    state.clients = clientsRes;
    state.logs = logsRes;
    document.getElementById('serverIpBadge').textContent = `${state.serverIp}:${state.port}`;
    renderAll();
  } catch (err) {
    console.error('Gagal mengambil data dari server:', err);
  }
}

// --- PENGIRIMAN PERINTAH KE SERVER ---

async function wakePCs(target = null) {
  let finalTarget = target;
  if (!finalTarget) {
    if (state.selectedIds.size > 0) {
      finalTarget = Array.from(state.selectedIds);
    } else {
      finalTarget = 'all';
    }
  }

  try {
    const res = await fetch('/api/wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: finalTarget })
    });
    const data = await res.json();
    alert(`Paket sinyal Wake-on-LAN (WoL) berhasil dipancarkan ke ${data.count} komputer.`);
  } catch (err) {
    alert('Gagal mengirim Wake-on-LAN: ' + err.message);
  }
}

async function sendCommand(command, target = null, params = {}) {
  // Jika target null, gunakan selectedIds jika ada; jika tidak, gunakan 'all'
  let finalTarget = target;
  if (!finalTarget) {
    if (state.selectedIds.size > 0) {
      finalTarget = Array.from(state.selectedIds);
    } else {
      finalTarget = 'all';
    }
  }

  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, target: finalTarget, params })
    });
    const data = await res.json();
    if (!res.ok) {
      alert('Gagal mengirim perintah: ' + (data.error || 'Unknown error'));
    }
    return data;
  } catch (err) {
    alert('Terjadi kesalahan jaringan: ' + err.message);
  }
}

// --- FILTER & SELECTION LOGIC ---

function getFilteredClients() {
  const list = state.clients.filter((c) => {
    // Filter Lab / Ruang
    if (state.selectedLab && state.selectedLab !== 'all') {
      const clientLab = (c.labName || 'C1').toUpperCase();
      if (clientLab !== state.selectedLab.toUpperCase()) return false;
    }

    // Filter tab status
    if (state.filter === 'online' && !c.online) return false;
    if (state.filter === 'offline' && c.online) return false;
    if (state.filter === 'running' && !c.exambrowserRunning) return false;

    // Search query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const matchName = (c.hostname || '').toLowerCase().includes(q);
      const matchIp = (c.ip || '').toLowerCase().includes(q);
      const matchUser = (c.username || '').toLowerCase().includes(q);
      const matchDesk = (c.deskNumber || '').toLowerCase().includes(q);
      const matchMac = (c.mac || '').toLowerCase().includes(q);
      const matchLab = (c.labName || '').toLowerCase().includes(q);
      if (!matchName && !matchIp && !matchUser && !matchDesk && !matchMac && !matchLab) return false;
    }

    return true;
  });

  const sortBy = state.sortBy || 'desk';
  return list.sort((a, b) => {
    if (sortBy === 'desk') {
      const deskA = a.deskNumber ? a.deskNumber.trim() : '';
      const deskB = b.deskNumber ? b.deskNumber.trim() : '';
      if (deskA && deskB) {
        return deskA.localeCompare(deskB, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (deskA && !deskB) return -1;
      if (!deskA && deskB) return 1;
      return (a.hostname || '').localeCompare(b.hostname || '', undefined, { numeric: true });
    } else if (sortBy === 'ip') {
      const ipToNum = (ip) => {
        const parts = (ip || '0.0.0.0').split('.').map(Number);
        return ((parts[0] || 0) << 24) + ((parts[1] || 0) << 16) + ((parts[2] || 0) << 8) + (parts[3] || 0);
      };
      return ipToNum(a.ip) - ipToNum(b.ip);
    } else if (sortBy === 'hostname') {
      return (a.hostname || '').localeCompare(b.hostname || '', undefined, { numeric: true });
    }
    return 0;
  });
}

function updateSelectionBanner() {
  const banner = document.getElementById('selectionBanner');
  const countEl = document.getElementById('selectedCount');
  if (state.selectedIds.size > 0) {
    banner.classList.remove('hidden');
    countEl.textContent = state.selectedIds.size;
  } else {
    banner.classList.add('hidden');
  }
}

// --- RENDERING FUNCTIONS ---

function renderMetrics() {
  const total = state.clients.length;
  const online = state.clients.filter((c) => c.online).length;
  const running = state.clients.filter((c) => c.exambrowserRunning).length;
  const webcam = state.clients.filter((c) => c.webcamAvailable).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statOnline').textContent = online;
  document.getElementById('statExamRunning').textContent = running;
  document.getElementById('statWebcam').textContent = webcam;

  // Update jumlah komputer per Lab
  const cAll = document.getElementById('countLabAll');
  const cC1 = document.getElementById('countLabC1');
  const cC2 = document.getElementById('countLabC2');
  const cKKPI = document.getElementById('countLabKKPI');
  const cMM = document.getElementById('countLabMM');

  if (cAll) cAll.textContent = total;
  if (cC1) cC1.textContent = state.clients.filter(c => (c.labName || 'C1').toUpperCase() === 'C1').length;
  if (cC2) cC2.textContent = state.clients.filter(c => (c.labName || '').toUpperCase() === 'C2').length;
  if (cKKPI) cKKPI.textContent = state.clients.filter(c => (c.labName || '').toUpperCase() === 'KKPI').length;
  if (cMM) cMM.textContent = state.clients.filter(c => (c.labName || '').toUpperCase() === 'MM').length;
}

function renderClients() {
  const grid = document.getElementById('clientGrid');
  const empty = document.getElementById('emptyState');
  const filtered = getFilteredClients();

  document.getElementById('badgeFilteredCount').textContent = filtered.length;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  grid.innerHTML = filtered.map((c) => {
    const isSelected = state.selectedIds.has(c.clientId);
    const isOnline = c.online;
    const isRunning = c.exambrowserRunning;

    const statusBadge = isOnline
      ? `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
           <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online
         </span>`
      : `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-700">
           <span class="w-1.5 h-1.5 rounded-full bg-slate-500"></span> Offline
         </span>`;

    const examBadge = isRunning
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
           <i class="ph-bold ph-play"></i> Running (PID: ${c.exambrowserPid || '-'})
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
           <i class="ph-bold ph-stop"></i> Stopped
         </span>`;

    const camBadge = c.webcamAvailable
      ? `<span class="text-xs text-purple-400 flex items-center gap-1" title="${escapeHtml(c.webcamName || 'Webcam Aktif')}">
           <i class="ph-bold ph-webcam"></i> Webcam Ada
         </span>`
      : `<span class="text-xs text-slate-500 flex items-center gap-1">
           <i class="ph-bold ph-webcam-slash"></i> Tanpa Kamera
         </span>`;

    return `
      <div class="client-card bg-slate-800/80 border ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/50' : 'border-slate-700/70'} rounded-xl p-4 flex flex-col justify-between shadow-lg">
        <div>
          <!-- TOP CARD BAR: LAB, DESK NUMBER & QUICK IDENTIFY -->
          <div class="flex items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-700/60">
            <div class="flex items-center gap-1.5 min-w-0 flex-wrap">
              <!-- LAB BADGE -->
              <button data-action="quick-edit-lab" data-client-id="${c.clientId}" title="Klik untuk memindahkan ke Lab lain (C1, C2, KKPI, MM)" class="btn-card-action inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 border border-indigo-500/40 transition">
                <i class="ph-bold ph-door"></i> ${escapeHtml(c.labName || 'C1')}
              </button>

              ${c.deskNumber ? `
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40 truncate">
                  <i class="ph-bold ph-identification-card"></i> ${escapeHtml(c.deskNumber)}
                </span>
                <button data-action="quick-edit-desk" data-client-id="${c.clientId}" title="Ubah Nomor Meja" class="btn-card-action text-slate-400 hover:text-white text-xs p-1 rounded hover:bg-slate-700/60 transition">
                  <i class="ph-bold ph-pencil-simple"></i>
                </button>
              ` : `
                <button data-action="quick-edit-desk" data-client-id="${c.clientId}" title="Klik untuk menentukan nomor meja" class="btn-card-action inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-teal-400 border border-dashed border-teal-500/40 hover:border-teal-400 transition">
                  <i class="ph-bold ph-plus"></i> Set Meja
                </button>
              `}
            </div>

            <!-- BUTTON CEK MEJA (FLASH & BEEP) -->
            <button data-action="identify" data-client-id="${c.clientId}" title="📍 Bunyikan & Kedipkan Layar Komputer di Meja Ini" class="btn-card-action inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 shadow-sm transition active:scale-95">
              <i class="ph-bold ph-broadcast text-xs"></i> <span>📍 Cek Meja</span>
            </button>
          </div>

          <!-- TOP CARD HEADER: CHECKBOX & HOSTNAME -->
          <div class="flex items-start justify-between gap-2 mb-3">
            <label class="flex items-center gap-2.5 cursor-pointer select-none flex-1">
              <input type="checkbox" data-client-id="${c.clientId}" class="client-checkbox cursor-pointer" style="width: 18px; height: 18px; accent-color: #2563eb;" ${isSelected ? 'checked' : ''}>
              <div>
                <h3 class="font-bold text-white text-sm tracking-tight hover:text-blue-300 transition">${escapeHtml(c.hostname)}</h3>
                <p class="text-xs font-mono text-slate-400">${escapeHtml(c.ip)}</p>
              </div>
            </label>
            ${statusBadge}
          </div>

          <!-- INFO SPECS -->
          <div class="space-y-1.5 text-xs text-slate-300 py-2 border-y border-slate-700/50 mb-3">
            <div class="flex items-center justify-between">
              <span class="text-slate-400">User Login:</span>
              <span class="font-medium text-slate-200">${escapeHtml(c.username)}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">ExamBrowser:</span>
              ${examBadge}
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">Kamera/Webcam:</span>
              ${c.webcamAvailable ? `
                <button data-action="camera" data-client-id="${c.clientId}" title="Klik untuk membuka layar kamera siswa" class="btn-card-action px-2 py-0.5 rounded bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700/50 text-xs font-medium flex items-center gap-1.5 transition">
                  <i class="ph-bold ph-webcam text-purple-400"></i> ${escapeHtml(c.webcamName || 'Webcam Ada')} (Lihat)
                </button>
              ` : `
                <span class="text-slate-500 flex items-center gap-1"><i class="ph-bold ph-prohibit"></i> Tidak Ada</span>
              `}
            </div>
          </div>

          <!-- CAMERA FEED PREVIEW (IF AVAILABLE) -->
          ${
            c.latestCameraImage
              ? `
              <div class="mb-3 relative group rounded-lg overflow-hidden border border-purple-600/50 bg-black cursor-pointer preview-camera-btn" data-client-id="${c.clientId}" title="Klik untuk memperbesar tampilan kamera">
                <img src="${c.latestCameraImage}" alt="Feed Kamera" class="w-full h-32 object-cover object-center opacity-95 group-hover:opacity-100 transition">
                <div class="absolute inset-0 bg-purple-950/20 group-hover:bg-transparent transition"></div>
                <div class="absolute top-1.5 left-1.5 bg-black/80 backdrop-blur-sm border border-purple-800/80 text-purple-300 px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1">
                  <i class="ph-bold ph-webcam text-xs text-purple-400"></i> Feed Kamera Siswa
                </div>
                <div class="absolute bottom-1.5 right-1.5 bg-black/80 backdrop-blur-sm text-slate-300 px-1.5 py-0.5 rounded text-[10px] font-mono">
                  ${c.cameraTime || ''}
                </div>
              </div>
            `
              : ''
          }

          <!-- SCREENSHOT THUMBNAIL PREVIEW (IF AVAILABLE) -->
          ${
            c.latestScreenshot
              ? `
              <div class="mb-3 relative group rounded-lg overflow-hidden border border-slate-700 bg-black cursor-pointer preview-screen-btn" data-client-id="${c.clientId}">
                <img src="${c.latestScreenshot}" alt="Preview Screen" class="w-full h-24 object-cover object-top opacity-90 group-hover:opacity-100 transition">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                  <span class="text-xs font-medium text-white px-2 py-1 rounded bg-black/70 flex items-center gap-1">
                    <i class="ph-bold ph-magnifying-glass-plus"></i> Perbesar Layar
                  </span>
                </div>
                <span class="absolute bottom-1 right-1 text-[10px] bg-black/70 text-slate-300 px-1.5 py-0.5 rounded font-mono">
                  ${c.screenshotTime || ''}
                </span>
              </div>
            `
              : ''
          }
        </div>

        <!-- BOTTOM CARD ACTION BUTTONS -->
        <div class="flex items-center gap-1.5 pt-1">
          ${!isOnline && c.mac ? `
            <button data-action="wake" data-client-id="${c.clientId}" title="Kirim sinyal nyalakan PC (Wake-on-LAN)" class="btn-card-action flex-1 py-1.5 px-2 rounded-lg bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-300 border border-yellow-500/30 text-xs font-semibold flex items-center justify-center gap-1 transition">
              <i class="ph-bold ph-lightning"></i> Hidupkan
            </button>
          ` : `
            <!-- Buka Auto-RUN -->
            <button data-action="launch" data-client-id="${c.clientId}" title="Buka & Auto RUN" class="btn-card-action flex-1 py-1.5 px-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold flex items-center justify-center gap-1 transition">
              <i class="ph-bold ph-play"></i> Buka
            </button>

            <!-- Tutup Aman Ctrl+C+B -->
            <button data-action="close" data-client-id="${c.clientId}" title="Tutup Aman (Ctrl+C+B)" class="btn-card-action flex-1 py-1.5 px-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center justify-center gap-1 transition">
              <i class="ph-bold ph-stop"></i> Tutup
            </button>
          `}

          <!-- Screenshot -->
          <button data-action="screenshot" data-client-id="${c.clientId}" title="Ambil Tangkapan Layar" class="btn-card-action p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs transition">
            <i class="ph-bold ph-camera text-sm"></i>
          </button>

          <!-- Pantau Kamera -->
          <button data-action="camera" data-client-id="${c.clientId}" title="Pantau Kamera Siswa" class="btn-card-action px-2.5 py-1.5 rounded-lg bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition">
            <i class="ph-bold ph-webcam text-sm"></i> Kamera
          </button>

          <!-- Kill Force -->
          <button data-action="kill" data-client-id="${c.clientId}" title="Force Kill ExamBrowser" class="btn-card-action p-1.5 rounded-lg bg-rose-900/30 hover:bg-rose-900/50 text-rose-400 border border-rose-800/40 text-xs transition">
            <i class="ph-bold ph-x text-sm"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  attachCardEvents();
}

function attachCardEvents() {
  // Checkbox toggle
  document.querySelectorAll('.client-checkbox').forEach((chk) => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    chk.addEventListener('change', (e) => {
      e.stopPropagation();
      const id = e.target.getAttribute('data-client-id');
      if (e.target.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      renderClients();
      updateSelectionBanner();
    });
  });

  // Action Buttons
  document.querySelectorAll('.btn-card-action').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.currentTarget;
      const action = targetBtn.getAttribute('data-action');
      const clientId = targetBtn.getAttribute('data-client-id');

      switch (action) {
        case 'wake':
          wakePCs([clientId]);
          break;
        case 'camera':
          const cl = state.clients.find((c) => c.clientId === clientId);
          sendCommand('camera_snapshot', [clientId]);
          if (cl) openCameraModal(cl);
          break;
        case 'launch':
          sendCommand('launch_standard', [clientId]);
          break;
        case 'close':
          sendCommand('close_graceful', [clientId]);
          break;
        case 'screenshot':
          sendCommand('screenshot', [clientId]);
          break;
        case 'identify':
          identifyClient(clientId);
          break;
        case 'quick-edit-lab':
          promptQuickEditLab(clientId);
          break;
        case 'quick-edit-desk':
          promptQuickEditDesk(clientId);
          break;
        case 'kill':
          if (confirm('Yakin ingin mematikan paksa ExamBrowser pada klien ini?')) {
            sendCommand('kill_force', [clientId]);
          }
          break;
      }
    });
  });

  // Preview screenshot click
  document.querySelectorAll('.preview-screen-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const clientId = e.currentTarget.getAttribute('data-client-id');
      const client = state.clients.find((c) => c.clientId === clientId);
      if (client && client.latestScreenshot) {
        openScreenshotModal(client);
      }
    });
  });

  // Preview camera click
  document.querySelectorAll('.preview-camera-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const clientId = e.currentTarget.getAttribute('data-client-id');
      const client = state.clients.find((c) => c.clientId === clientId);
      if (client) {
        openCameraModal(client);
      }
    });
  });
}

function renderLogs() {
  const container = document.getElementById('logConsole');
  if (state.logs.length === 0) {
    container.innerHTML = '<p class="text-slate-600">Menunggu aktivitas log...</p>';
    return;
  }

  container.innerHTML = state.logs.map((log) => {
    let color = 'text-slate-400';
    let icon = 'ph-bold ph-info';
    if (log.type === 'success') {
      color = 'text-emerald-400';
      icon = 'ph-bold ph-check';
    } else if (log.type === 'warning') {
      color = 'text-amber-400';
      icon = 'ph-bold ph-lightning';
    } else if (log.type === 'error') {
      color = 'text-rose-400';
      icon = 'ph-bold ph-warning-circle';
    }

    return `
      <div class="flex items-start gap-2 leading-relaxed">
        <span class="text-slate-500 select-none">[${log.timestamp}]</span>
        <i class="${icon} ${color} mt-0.5 text-xs"></i>
        <span class="${color}">${escapeHtml(log.message)}</span>
      </div>
    `;
  }).join('');
}

function renderAll() {
  renderMetrics();
  renderClients();
  renderLogs();
  updateSelectionBanner();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// --- MODAL UTILITIES ---

function openScreenshotModal(client) {
  document.getElementById('modalScreenshotTitle').textContent = `Layar: ${client.hostname} (${client.ip})`;
  document.getElementById('modalScreenshotImg').src = client.latestScreenshot;
  document.getElementById('modalScreenshotTime').textContent = `Diambil pada: ${client.screenshotTime || '-'}`;
  document.getElementById('modalScreenshot').classList.remove('hidden');
}

let activeCameraClientId = null;
let isLiveCamera = true;
let liveStreamTimer = null;

function updateLiveButtonUI() {
  const btn = document.getElementById('btnToggleLiveCamera');
  const lbl = document.getElementById('lblLiveStatus');
  const fps = document.getElementById('modalCameraFps');
  if (!btn || !lbl) return;

  if (isLiveCamera) {
    btn.className = 'px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition bg-rose-950/80 text-rose-400 border border-rose-800/80 hover:bg-rose-900/50';
    lbl.textContent = '🔴 LIVE STREAM AKTIF';
    if (fps) {
      fps.className = 'text-emerald-400 font-semibold flex items-center gap-1';
      fps.innerHTML = '<i class="ph-bold ph-broadcast animate-pulse"></i> Live Stream Real-Time';
    }
  } else {
    btn.className = 'px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1.5 transition bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700';
    lbl.textContent = '⏸️ LIVE DIJEDA';
    if (fps) {
      fps.className = 'text-slate-500 font-medium flex items-center gap-1';
      fps.innerHTML = '<i class="ph-bold ph-pause"></i> Dijeda';
    }
  }
}

function openCameraModal(client) {
  activeCameraClientId = client.clientId;
  isLiveCamera = true;
  updateLiveButtonUI();

  document.getElementById('modalCameraTitle').textContent = `Pantauan Kamera Fokus Wajah: ${client.hostname} (${client.ip})`;
  const imgEl = document.getElementById('modalCameraImg');
  const loadingEl = document.getElementById('modalCameraLoading');
  const infoEl = document.getElementById('modalCameraInfo');
  const timeEl = document.getElementById('modalCameraTime');

  if (client.latestCameraImage) {
    imgEl.src = client.latestCameraImage;
    imgEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.add('hidden');
    infoEl.textContent = `Perangkat: ${client.webcamName || 'Kamera Siswa'}`;
    timeEl.textContent = `Waktu Pengambilan: ${client.cameraTime || '-'}`;
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    infoEl.textContent = 'Menghubungkan live camera wajah siswa...';
    timeEl.textContent = 'Meminta live stream...';
  }
  document.getElementById('modalCamera').classList.remove('hidden');

  // Minta streaming live frame cepat langsung ke wajah
  sendCommand('start_live_stream', [activeCameraClientId]);
}

function openPowerModal(type) {
  powerActionType = type;
  const isShutdown = type === 'shutdown';
  document.getElementById('modalPowerTitle').textContent = isShutdown ? 'Konfirmasi Shutdown' : 'Konfirmasi Restart';
  document.getElementById('modalPowerSubtitle').textContent = isShutdown
    ? 'Kirim instruksi matikan komputer massal ke klien target'
    : 'Kirim instruksi restart komputer massal ke klien target';

  const iconEl = document.getElementById('modalPowerIcon');
  const btnEl = document.getElementById('btnConfirmPower');

  if (isShutdown) {
    iconEl.className = 'w-12 h-12 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center text-2xl';
    iconEl.innerHTML = '<i class="ph-bold ph-power"></i>';
    btnEl.className = 'px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium shadow-lg shadow-rose-600/30';
    btnEl.textContent = 'Shutdown Sekarang';
    document.getElementById('powerMessageInput').value = 'Perhatian: Komputer akan dimatikan dalam 30 detik oleh Proktor!';
  } else {
    iconEl.className = 'w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center text-2xl';
    iconEl.innerHTML = '<i class="ph-bold ph-arrows-clockwise"></i>';
    btnEl.className = 'px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium shadow-lg shadow-amber-600/30';
    btnEl.textContent = 'Restart Sekarang';
    document.getElementById('powerMessageInput').value = 'Perhatian: Komputer akan direstart dalam 30 detik oleh Proktor!';
  }

  document.getElementById('modalPower').classList.remove('hidden');
}

// --- DESK MAPPING & IDENTIFY FUNCTIONS ---

async function identifyClient(target) {
  try {
    const res = await fetch('/api/client/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Gagal mengirim sinyal cek meja');
    }
  } catch (err) {
    console.error('Gagal kirim identifikasi:', err);
    alert('Terjadi kesalahan jaringan saat mengirim sinyal identifikasi.');
  }
}

async function updateClientDesk(clientId, deskNumber) {
  try {
    const res = await fetch('/api/client/desk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, deskNumber })
    });
    const data = await res.json();
    if (data.success) {
      const c = state.clients.find((cl) => cl.clientId === clientId);
      if (c) c.deskNumber = data.deskNumber;
      renderClients();
    }
  } catch (err) {
    console.error('Gagal update nomor meja:', err);
  }
}

async function updateClientLab(clientId, labName) {
  try {
    const res = await fetch('/api/client/lab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, labName })
    });
    const data = await res.json();
    if (data.success) {
      const c = state.clients.find((cl) => cl.clientId === clientId);
      if (c) c.labName = labName;
      renderAll();
    }
  } catch (err) {
    console.error('Gagal update lab:', err);
  }
}

function promptQuickEditLab(clientId) {
  const client = state.clients.find((c) => c.clientId === clientId);
  if (!client) return;
  const current = client.labName || 'C1';
  const input = prompt(`Pindahkan ${client.hostname} (${client.ip}) ke Lab mana?\nPilihan: C1, C2, KKPI, MM`, current);
  if (input !== null && input.trim()) {
    updateClientLab(clientId, input.trim().toUpperCase());
  }
}

function promptQuickEditDesk(clientId) {
  const client = state.clients.find((c) => c.clientId === clientId);
  if (!client) return;
  const current = client.deskNumber || '';
  const input = prompt(`Masukkan Nomor Meja untuk ${client.hostname} (${client.ip}):\n(Contoh: Meja 01, Meja 12, atau kosongkan untuk menghapus)`, current);
  if (input !== null) {
    updateClientDesk(clientId, input.trim());
  }
}

function openDeskModal() {
  const modal = document.getElementById('modalDeskMapping');
  if (!modal) return;
  renderDeskMappingTable();
  modal.classList.remove('hidden');
}

function renderDeskMappingTable() {
  const tbody = document.getElementById('deskMappingTableBody');
  const statusEl = document.getElementById('deskMappingStatus');
  if (!tbody) return;

  const sortedClients = [...state.clients].sort((a, b) => {
    const deskA = a.deskNumber ? a.deskNumber.trim() : '';
    const deskB = b.deskNumber ? b.deskNumber.trim() : '';
    if (deskA && deskB) return deskA.localeCompare(deskB, undefined, { numeric: true });
    if (deskA && !deskB) return -1;
    if (!deskA && deskB) return 1;
    const ipToNum = (ip) => {
      const parts = (ip || '0.0.0.0').split('.').map(Number);
      return ((parts[0] || 0) << 24) + ((parts[1] || 0) << 16) + ((parts[2] || 0) << 8) + (parts[3] || 0);
    };
    return ipToNum(a.ip) - ipToNum(b.ip);
  });

  if (statusEl) {
    statusEl.textContent = `Total: ${sortedClients.length} komputer terdaftar (${sortedClients.filter((c) => c.online).length} online)`;
  }

  tbody.innerHTML = sortedClients.map((c, idx) => {
    const isOnline = c.online;
    return `
      <tr class="hover:bg-slate-800/40 transition" data-client-id="${c.clientId}">
        <td class="py-2.5 px-3 text-center text-slate-500 font-mono">${idx + 1}</td>
        <td class="py-2 px-3">
          <input type="text" 
                 value="${escapeHtml(c.deskNumber || '')}" 
                 placeholder="Misal: Meja ${idx + 1 < 10 ? '0' + (idx + 1) : (idx + 1)}" 
                 data-client-id="${c.clientId}"
                 class="desk-input w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-teal-300 font-bold text-xs focus:outline-none focus:border-teal-500">
        </td>
        <td class="py-2.5 px-3 font-semibold text-white">${escapeHtml(c.hostname)}</td>
        <td class="py-2.5 px-3 font-mono text-slate-400">${escapeHtml(c.ip)}</td>
        <td class="py-2.5 px-3">
          ${isOnline 
            ? '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online</span>' 
            : '<span class="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500"><span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span> Offline</span>'}
        </td>
        <td class="py-2 px-3 text-center">
          <button type="button" data-action="identify-row" data-client-id="${c.clientId}" title="Bunyikan & Munculkan nama di layar komputer ini" class="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-semibold inline-flex items-center gap-1 transition active:scale-95">
            <i class="ph-bold ph-broadcast"></i> Cek
          </button>
        </td>
      </tr>
    `;
  }).join('');

  // Handle Tab / Enter navigation between inputs
  tbody.querySelectorAll('.desk-input').forEach((input, index, inputs) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputs[index + 1]) {
          inputs[index + 1].focus();
          inputs[index + 1].select();
        }
      }
    });
  });

  // Handle Identify button click inside modal
  tbody.querySelectorAll('button[data-action="identify-row"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cid = btn.getAttribute('data-client-id');
      identifyClient(cid);
    });
  });
}

// --- EVENT LISTENERS INITIALIZATION ---

document.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
  fetchState();

  // Tombol Refresh
  document.getElementById('btnRefresh').addEventListener('click', fetchState);

  // Tab Filter
  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.filter = e.currentTarget.getAttribute('data-filter');
      renderClients();
    });
  });

  // Pencarian
  document.getElementById('searchInput').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    renderClients();
  });

  // Tombol Pilih Semua / Batalkan
  document.getElementById('btnSelectAll').addEventListener('click', () => {
    const filtered = getFilteredClients();
    filtered.forEach((c) => state.selectedIds.add(c.clientId));
    renderClients();
    updateSelectionBanner();
  });

  document.getElementById('btnDeselectAll').addEventListener('click', () => {
    state.selectedIds.clear();
    renderClients();
    updateSelectionBanner();
  });

  // Mass Launch Standard
  document.getElementById('btnMassLaunchStandard').addEventListener('click', () => {
    const count = state.selectedIds.size || state.clients.filter((c) => c.online).length;
    if (confirm(`Jalankan ExamBrowser (Standar & Auto-RUN) pada ${count} PC klien?`)) {
      sendCommand('launch_standard');
    }
  });

  // Mass Launch Webcam
  document.getElementById('btnMassLaunchWebcam').addEventListener('click', () => {
    const count = state.selectedIds.size || state.clients.filter((c) => c.online).length;
    if (confirm(`Jalankan ExamBrowser (Auto Izin Webcam & Auto-RUN) pada ${count} PC klien?`)) {
      sendCommand('launch_webcam');
    }
  });

  // Mass Close Graceful
  document.getElementById('btnMassCloseGraceful').addEventListener('click', () => {
    const count = state.selectedIds.size || state.clients.filter((c) => c.online).length;
    if (confirm(`Kirim sinyal tutup aman (Ctrl + C + B) ke ${count} PC klien?`)) {
      sendCommand('close_graceful');
    }
  });

  // Mass Force Kill
  document.getElementById('btnMassKill').addEventListener('click', () => {
    const count = state.selectedIds.size || state.clients.filter((c) => c.online).length;
    if (confirm(`PERINGATAN: Tutup paksa (kill) proses ExamBrowser pada ${count} PC klien?`)) {
      sendCommand('kill_force');
    }
  });

  // Mass Screenshot
  document.getElementById('btnMassScreenshot').addEventListener('click', () => {
    sendCommand('screenshot');
  });

  // Mass Camera (Tombol Pantau Kamera di Atas)
  document.getElementById('btnMassCamera').addEventListener('click', () => {
    const selectedClients = Array.from(state.selectedIds).map(id => state.clients.find(c => c.clientId === id)).filter(Boolean);
    const onlineClients = state.clients.filter((c) => c.online);

    if (selectedClients.length > 0) {
      const targetClient = selectedClients[0];
      sendCommand('camera_snapshot', selectedClients.map(c => c.clientId));
      openCameraModal(targetClient);
    } else if (onlineClients.length > 0) {
      const targetClient = onlineClients[0];
      sendCommand('camera_snapshot', [targetClient.clientId]);
      openCameraModal(targetClient);
    } else {
      alert('Tidak ada komputer klien yang sedang online.');
    }
  });

  // Refresh Camera modal button
  document.getElementById('btnRefreshCamera').addEventListener('click', () => {
    if (activeCameraClientId) {
      sendCommand('camera_snapshot', [activeCameraClientId]);
      const loadingEl = document.getElementById('modalCameraLoading');
      if (loadingEl) loadingEl.classList.remove('hidden');
      document.getElementById('modalCameraInfo').textContent = 'Sedang mengambil foto kamera terbaru dari PC siswa...';
    }
  });

  // Toggle Live Camera Stream
  document.getElementById('btnToggleLiveCamera').addEventListener('click', () => {
    isLiveCamera = !isLiveCamera;
    updateLiveButtonUI();
    if (activeCameraClientId) {
      if (isLiveCamera) {
        sendCommand('start_live_stream', [activeCameraClientId]);
      } else {
        sendCommand('stop_live_stream', [activeCameraClientId]);
      }
    }
  });

  // Fullscreen Layar Penuh Monitor
  const btnFs = document.getElementById('btnFullscreenCamera');
  if (btnFs) {
    btnFs.addEventListener('click', () => {
      const el = document.getElementById('modalCameraContainer');
      const lbl = document.getElementById('lblFullscreen');
      if (!document.fullscreenElement) {
        if (el.requestFullscreen) {
          el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
        if (lbl) lbl.textContent = 'Keluar Layar Penuh';
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        }
        if (lbl) lbl.textContent = 'Layar Penuh Monitor';
      }
    });

    document.addEventListener('fullscreenchange', () => {
      const lbl = document.getElementById('lblFullscreen');
      if (!document.fullscreenElement && lbl) {
        lbl.textContent = 'Layar Penuh Monitor';
      }
    });
  }

  // Lab Tab Selector (Semua, C1, C2, KKPI, MM)
  document.querySelectorAll('.lab-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.lab-tab').forEach((t) => {
        t.className = 'lab-tab px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700 whitespace-nowrap';
      });
      tab.className = 'lab-tab active px-3 py-1.5 rounded-lg text-xs font-bold transition bg-blue-600 text-white shadow-md shadow-blue-600/30 whitespace-nowrap';
      state.selectedLab = tab.getAttribute('data-lab');
      renderClients();
    });
  });

  // Dropdown Menu Toggle
  const btnMoreMenu = document.getElementById('btnMoreMenu');
  const moreDropdown = document.getElementById('moreMenuDropdown');
  btnMoreMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    moreDropdown.classList.toggle('hidden');
  });
  document.addEventListener('click', () => {
    moreDropdown.classList.add('hidden');
  });

  // Menu items inside dropdown
  const btnMenuFlash = document.getElementById('btnMenuFlashAll');
  if (btnMenuFlash) {
    btnMenuFlash.addEventListener('click', () => {
      if (confirm('Kirim sinyal identifikasi visual dan bunyi bip ke SEMUA layar komputer lab selama 4.5 detik?')) {
        identifyClient('all');
      }
    });
  }

  // Tombol Buka Modal Pemetaan Meja
  const btnOpenDesk = document.getElementById('btnOpenDeskModal');
  if (btnOpenDesk) {
    btnOpenDesk.addEventListener('click', openDeskModal);
  }

  // Sort Dropdown
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      renderClients();
    });
  }

  // Flash All In Modal
  const btnFlashModal = document.getElementById('btnFlashAllInModal');
  if (btnFlashModal) {
    btnFlashModal.addEventListener('click', () => {
      identifyClient('all');
    });
  }

  // Auto Sequence By IP
  const btnAutoIp = document.getElementById('btnAutoDeskByIp');
  if (btnAutoIp) {
    btnAutoIp.addEventListener('click', () => {
      const inputs = Array.from(document.querySelectorAll('#deskMappingTableBody .desk-input'));
      const ipToNum = (ip) => {
        const parts = (ip || '0.0.0.0').split('.').map(Number);
        return ((parts[0] || 0) << 24) + ((parts[1] || 0) << 16) + ((parts[2] || 0) << 8) + (parts[3] || 0);
      };
      const sortedByIp = [...state.clients].sort((a, b) => ipToNum(a.ip) - ipToNum(b.ip));
      inputs.forEach((input) => {
        const cid = input.getAttribute('data-client-id');
        const pos = sortedByIp.findIndex((c) => c.clientId === cid);
        if (pos !== -1) {
          const num = pos + 1;
          input.value = `Meja ${num < 10 ? '0' + num : num}`;
        }
      });
    });
  }

  // Auto Sequence By Hostname
  const btnAutoHost = document.getElementById('btnAutoDeskByHostname');
  if (btnAutoHost) {
    btnAutoHost.addEventListener('click', () => {
      const inputs = Array.from(document.querySelectorAll('#deskMappingTableBody .desk-input'));
      const sortedByName = [...state.clients].sort((a, b) => (a.hostname || '').localeCompare(b.hostname || '', undefined, { numeric: true }));
      inputs.forEach((input) => {
        const cid = input.getAttribute('data-client-id');
        const pos = sortedByName.findIndex((c) => c.clientId === cid);
        if (pos !== -1) {
          const num = pos + 1;
          input.value = `Meja ${num < 10 ? '0' + num : num}`;
        }
      });
    });
  }

  // Simpan Batch Pemetaan Meja
  const btnSaveDesk = document.getElementById('btnSaveDeskMapping');
  if (btnSaveDesk) {
    btnSaveDesk.addEventListener('click', async () => {
      const inputs = Array.from(document.querySelectorAll('#deskMappingTableBody .desk-input'));
      const mappings = inputs.map((inp) => ({
        clientId: inp.getAttribute('data-client-id'),
        deskNumber: inp.value.trim()
      }));

      btnSaveDesk.disabled = true;
      btnSaveDesk.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i> Menyimpan...';

      try {
        const res = await fetch('/api/client/batch-desk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappings })
        });
        const data = await res.json();
        if (data.success) {
          mappings.forEach((m) => {
            const cl = state.clients.find((c) => c.clientId === m.clientId);
            if (cl) cl.deskNumber = m.deskNumber;
          });
          renderClients();
          document.getElementById('modalDeskMapping').classList.add('hidden');
          alert(`Berhasil menyimpan ${data.count} nomor meja!`);
        } else {
          alert(data.error || 'Gagal menyimpan pemetaan nomor meja');
        }
      } catch (err) {
        alert('Kesalahan jaringan: ' + err.message);
      } finally {
        btnSaveDesk.disabled = false;
        btnSaveDesk.innerHTML = '<i class="ph-bold ph-floppy-disk"></i> Simpan Semua Pemetaan';
      }
    });
  }

  document.getElementById('btnMenuWakeOnLan').addEventListener('click', () => {
    if (confirm('Kirim sinyal Wake-on-LAN (WoL) untuk menyalakan komputer target?')) {
      wakePCs();
    }
  });

  document.getElementById('btnMenuShutdown').addEventListener('click', () => {
    openPowerModal('shutdown');
  });

  document.getElementById('btnMenuRestart').addEventListener('click', () => {
    openPowerModal('restart');
  });

  document.getElementById('btnMenuCancelShutdown').addEventListener('click', () => {
    if (confirm('Batalkan perintah shutdown/restart di semua klien?')) {
      sendCommand('cancel_shutdown');
    }
  });

  document.getElementById('btnMenuCustomScript').addEventListener('click', () => {
    document.getElementById('modalCustomScript').classList.remove('hidden');
  });

  document.getElementById('btnClearOffline').addEventListener('click', async () => {
    if (confirm('Hapus semua entri klien yang sedang Offline dari dashboard?')) {
      await fetch('/api/clients', { method: 'DELETE' });
      fetchState();
    }
  });

  // Module Switcher Tabs (Mode Ujian, Manajemen Lab KBM)
  const tabExam = document.getElementById('tabModuleExam');
  const tabLab = document.getElementById('tabModuleLab');
  const groupExam = document.getElementById('groupCommandsExam');
  const groupLab = document.getElementById('groupCommandsLab');

  function setModuleTab(module) {
    const tabs = [tabExam, tabLab];
    const groups = [groupExam, groupLab];
    tabs.forEach(t => {
      if (t) {
        t.className = 'module-tab flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition text-slate-400 hover:text-white hover:bg-slate-700/60';
      }
    });
    groups.forEach(g => {
      if (g) g.classList.add('hidden');
    });

    if (module === 'exam') {
      if (tabExam) tabExam.className = 'module-tab active flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition bg-blue-600 text-white shadow-md shadow-blue-600/30';
      if (groupExam) groupExam.classList.remove('hidden');
    } else if (module === 'lab') {
      if (tabLab) tabLab.className = 'module-tab active flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition bg-indigo-600 text-white shadow-md shadow-indigo-600/30';
      if (groupLab) groupLab.classList.remove('hidden');
    }
  }

  if (tabExam) tabExam.addEventListener('click', () => setModuleTab('exam'));
  if (tabLab) tabLab.addEventListener('click', () => setModuleTab('lab'));

  // Lab Module Command Handlers
  const btnLockScreen = document.getElementById('btnMassLockScreen');
  if (btnLockScreen) {
    btnLockScreen.addEventListener('click', () => {
      document.getElementById('modalLockScreen').classList.remove('hidden');
    });
  }

  const btnConfirmLock = document.getElementById('btnConfirmLockScreen');
  if (btnConfirmLock) {
    btnConfirmLock.addEventListener('click', () => {
      const msg = document.getElementById('lockScreenMessageInput').value.trim();
      sendCommand('lock_screen', null, { message: msg });
      document.getElementById('modalLockScreen').classList.add('hidden');
    });
  }

  const btnUnlockScreen = document.getElementById('btnMassUnlockScreen');
  if (btnUnlockScreen) {
    btnUnlockScreen.addEventListener('click', () => {
      sendCommand('unlock_screen');
    });
  }

  const btnSendMsg = document.getElementById('btnMassSendMessage');
  if (btnSendMsg) {
    btnSendMsg.addEventListener('click', () => {
      document.getElementById('modalSendMessage').classList.remove('hidden');
    });
  }

  const btnConfirmSendMsg = document.getElementById('btnConfirmSendMessage');
  if (btnConfirmSendMsg) {
    btnConfirmSendMsg.addEventListener('click', () => {
      const msg = document.getElementById('sendMessageInput').value.trim();
      if (!msg) {
        alert('Tulis pesan yang ingin dikirim!');
        return;
      }
      sendCommand('send_message', null, { message: msg });
      document.getElementById('modalSendMessage').classList.add('hidden');
    });
  }

  const btnOpenUrl = document.getElementById('btnMassOpenUrl');
  if (btnOpenUrl) {
    btnOpenUrl.addEventListener('click', () => {
      document.getElementById('modalOpenUrl').classList.remove('hidden');
    });
  }

  const btnConfirmOpenUrl = document.getElementById('btnConfirmOpenUrl');
  if (btnConfirmOpenUrl) {
    btnConfirmOpenUrl.addEventListener('click', () => {
      const url = document.getElementById('openUrlInput').value.trim();
      if (!url) {
        alert('Masukkan URL alamat web!');
        return;
      }
      sendCommand('open_url', null, { url });
      document.getElementById('modalOpenUrl').classList.add('hidden');
    });
  }

  const btnScreenLab = document.getElementById('btnMassScreenshotLab');
  if (btnScreenLab) {
    btnScreenLab.addEventListener('click', () => sendCommand('screenshot'));
  }

  const btnCamLab = document.getElementById('btnMassCameraLab');
  if (btnCamLab) {
    btnCamLab.addEventListener('click', () => {
      const onlineClients = state.clients.filter((c) => c.online);
      if (onlineClients.length > 0) {
        const target = onlineClients[0];
        sendCommand('camera_snapshot', [target.clientId]);
        openCameraModal(target);
      } else {
        alert('Tidak ada komputer klien yang sedang online.');
      }
    });
  }

  // OTA Deployment Handler (Menu Teknisi)
  const btnOtaDeploy = document.getElementById('btnMenuOtaDeploy') || document.getElementById('btnMassOtaDeploy');
  if (btnOtaDeploy) {
    btnOtaDeploy.addEventListener('click', () => {
      if (confirm('PERINGATAN: Pastikan PC klien SEDANG TIDAK DIGUNAKAN SISWA UJIAN!\n\nApakah Anda yakin ingin memperbarui agen di semua PC klien secara serentak lewat jaringan sekarang?')) {
        sendCommand('update_agent');
        alert('Instruksi pembaruan OTA telah dikirim ke seluruh klien! Agen akan mengunduh versi terbaru dan memulai ulang otomatis dalam 10-15 detik.');
      }
    });
  }

  // Modal Close buttons
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      document.querySelectorAll('#modalScreenshot, #modalCamera, #modalPower, #modalCustomScript, #modalDeskMapping, #modalSendMessage, #modalOpenUrl, #modalLockScreen').forEach((m) => {
        m.classList.add('hidden');
      });
      if (activeCameraClientId) {
        sendCommand('stop_live_stream', [activeCameraClientId]);
      }
      activeCameraClientId = null;
      isLiveCamera = false;
      clearTimeout(liveStreamTimer);
    });
  });

  // Confirm Power (Shutdown/Restart)
  document.getElementById('btnConfirmPower').addEventListener('click', () => {
    const seconds = parseInt(document.getElementById('powerSecondsInput').value, 10) || 30;
    const message = document.getElementById('powerMessageInput').value.trim();
    sendCommand(powerActionType, null, { seconds, message });
    document.getElementById('modalPower').classList.add('hidden');
  });

  // Confirm Custom Script
  document.getElementById('btnConfirmCustomScript').addEventListener('click', () => {
    const script = document.getElementById('customScriptInput').value.trim();
    if (!script) {
      alert('Masukkan skrip yang ingin dijalankan!');
      return;
    }
    sendCommand('exec_custom', null, { script });
    document.getElementById('modalCustomScript').classList.add('hidden');
  });

  // Clear Logs
  document.getElementById('btnClearLogs').addEventListener('click', () => {
    state.logs = [];
    renderLogs();
  });
});
