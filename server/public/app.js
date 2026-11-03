// RemoteExambro Frontend Application Logic

let state = {
  serverIp: '127.0.0.1',
  port: 3000,
  clients: [],
  selectedIds: new Set(),
  filter: 'all',
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
  return state.clients.filter((c) => {
    // Filter tab
    if (state.filter === 'online' && !c.online) return false;
    if (state.filter === 'offline' && c.online) return false;
    if (state.filter === 'running' && !c.exambrowserRunning) return false;

    // Search query
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const matchName = (c.hostname || '').toLowerCase().includes(q);
      const matchIp = (c.ip || '').toLowerCase().includes(q);
      const matchUser = (c.username || '').toLowerCase().includes(q);
      if (!matchName && !matchIp && !matchUser) return false;
    }

    return true;
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
          <!-- TOP CARD HEADER: CHECKBOX & HOSTNAME -->
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="flex items-center gap-2.5">
              <input type="checkbox" data-client-id="${c.clientId}" class="client-checkbox w-4 h-4 rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer" ${isSelected ? 'checked' : ''}>
              <div>
                <h3 class="font-bold text-white text-sm tracking-tight">${escapeHtml(c.hostname)}</h3>
                <p class="text-xs font-mono text-slate-400">${escapeHtml(c.ip)}</p>
              </div>
            </div>
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
              ${camBadge}
            </div>
          </div>

          <!-- SCREENSHOT THUMBNAIL PREVIEW (IF AVAILABLE) -->
          ${
            c.latestScreenshot
              ? `
              <div class="mb-3 relative group rounded-lg overflow-hidden border border-slate-700 bg-black cursor-pointer preview-screen-btn" data-client-id="${c.clientId}">
                <img src="${c.latestScreenshot}" alt="Preview Screen" class="w-full h-24 object-cover object-top opacity-90 group-hover:opacity-100 transition">
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
                  <span class="text-xs font-medium text-white px-2 py-1 rounded bg-black/70 flex items-center gap-1">
                    <i class="ph-bold ph-magnifying-glass-plus"></i> Perbesar
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
          <button data-action="camera" data-client-id="${c.clientId}" title="Pantau Kamera Siswa" class="btn-card-action p-1.5 rounded-lg bg-purple-900/30 hover:bg-purple-900/50 text-purple-300 border border-purple-800/40 text-xs transition">
            <i class="ph-bold ph-webcam text-sm"></i>
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
    chk.addEventListener('change', (e) => {
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

function openCameraModal(client) {
  activeCameraClientId = client.clientId;
  document.getElementById('modalCameraTitle').textContent = `Pantauan Kamera: ${client.hostname} (${client.ip})`;
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
  } else if (client.latestScreenshot) {
    imgEl.src = client.latestScreenshot;
    imgEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.add('hidden');
    infoEl.textContent = `Tampilan Layar & Feed Kamera Siswa (Meminta snapshot baru...)`;
    timeEl.textContent = `Waktu: ${client.screenshotTime || '-'}`;
  } else {
    imgEl.src = '';
    imgEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    infoEl.textContent = 'Menghubungi agen client, mohon tunggu...';
    timeEl.textContent = 'Meminta gambar...';
  }
  document.getElementById('modalCamera').classList.remove('hidden');
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

  // Mass Camera
  document.getElementById('btnMassCamera').addEventListener('click', () => {
    const count = state.selectedIds.size || state.clients.filter((c) => c.online).length;
    if (confirm(`Ambil foto kamera dari ${count} PC siswa?`)) {
      sendCommand('camera_snapshot');
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

  // Modal Close buttons
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modalScreenshot, #modalCamera, #modalPower, #modalCustomScript').forEach((m) => {
        m.classList.add('hidden');
      });
      activeCameraClientId = null;
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
