const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const UDP_PORT = 3001;
const CLIENT_TIMEOUT_MS = 25000; // Toleransi 25 detik agar tidak mudah terputus jika jaringan Wi-Fi lab sibuk

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-Memory Database
const clients = new Map(); // clientId -> ClientData
const pendingTasks = new Map(); // clientId -> [tasks]
const activityLogs = [];

function addLog(type, message, details = null) {
  const logEntry = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    timestamp: new Date().toLocaleTimeString('id-ID'),
    type, // 'info', 'success', 'warning', 'error'
    message,
    details
  };
  activityLogs.unshift(logEntry);
  if (activityLogs.length > 200) activityLogs.pop();
  broadcastToDashboards({ type: 'LOG_ENTRY', data: logEntry });
}

// Mendapatkan semua IP LAN aktif dan alamat broadcast subnet masing-masing
function getAllActiveIPv4() {
  const list = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        try {
          const ipParts = iface.address.split('.').map(Number);
          const maskParts = (iface.netmask || '255.255.255.0').split('.').map(Number);
          const broadcastParts = ipParts.map((part, i) => (part | (~maskParts[i] & 255)));
          list.push({ name, ip: iface.address, broadcast: broadcastParts.join('.') });
        } catch (e) {
          list.push({ name, ip: iface.address, broadcast: '255.255.255.255' });
        }
      }
    }
  }
  return list.length > 0 ? list : [{ name: 'loopback', ip: '127.0.0.1', broadcast: '255.255.255.255' }];
}

function getLocalLANIP() {
  const all = getAllActiveIPv4();
  // Utamakan IP Ethernet (kabel lab) jika ada
  const eth = all.find((i) => i.name.toLowerCase().includes('ethernet') || i.ip.startsWith('10.') || i.ip.startsWith('192.168.0.'));
  if (eth) return eth.ip;
  return all[0].ip;
}

const SERVER_IP = getLocalLANIP();

// File penyimpanan data klien permanen (agar MAC tidak hilang saat PC mati)
const CLIENTS_FILE = path.join(__dirname, 'clients_store.json');
const fs = require('fs');

function loadClientsStore() {
  try {
    if (fs.existsSync(CLIENTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CLIENTS_FILE, 'utf8'));
      raw.forEach((c) => {
        // Abaikan entri dummy 127.0.0.1 jika sudah ada entri LAN untuk host yang sama
        if (c.ip === '127.0.0.1' && raw.some(other => other.hostname === c.hostname && other.ip !== '127.0.0.1')) {
          return;
        }
        c.online = false; // Saat server baru mulai, set awal offline
        clients.set(c.clientId, c);
      });
      console.log(`[Store] Memuat ${clients.size} data klien tersimpan.`);
    }
  } catch (e) {}
}

function saveClientsStore() {
  try {
    const list = Array.from(clients.values()).map(c => {
      const copy = { ...c };
      delete copy.latestCameraImage;
      delete copy.latestScreenshot;
      return copy;
    });
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {}
}

loadClientsStore();

// Wake-on-LAN (WoL) Magic Packet Sender Tingkat Lanjut (Multi-Port & Multi-Broadcast)
function sendWakeOnLAN(mac) {
  if (!mac) return false;
  const cleanMac = mac.replace(/[:-]/g, '');
  if (cleanMac.length !== 12) return false;

  const macBytes = Buffer.from(cleanMac, 'hex');
  const magicPacket = Buffer.alloc(102);
  magicPacket.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBytes.copy(magicPacket, 6 + i * 6);
  }

  const ports = [9, 7]; // Standar WoL Port 9 dan Port 7
  const ifaces = getAllActiveIPv4();

  const udpClient = dgram.createSocket('udp4');
  udpClient.bind(() => {
    udpClient.setBroadcast(true);

    // Kirim 3x tembakan (burst) dengan jeda 100ms agar pasti diterima switch lab
    let burstCount = 0;
    const interval = setInterval(() => {
      ports.forEach((port) => {
        // Kirim ke directed broadcast setiap subnet (misal 10.10.11.255)
        ifaces.forEach((iface) => {
          udpClient.send(magicPacket, 0, magicPacket.length, port, iface.broadcast, () => {});
        });
        // Kirim ke global broadcast
        udpClient.send(magicPacket, 0, magicPacket.length, port, '255.255.255.255', () => {});
      });

      burstCount++;
      if (burstCount >= 3) {
        clearInterval(interval);
        setTimeout(() => {
          try { udpClient.close(); } catch (e) {}
        }, 300);
      }
    }, 120);
  });

  return true;
}

// UDP Beacon Broadcast & Discovery Responder untuk Auto-Discovery Dinamis 100%
function startUDPBeacon() {
  const udpServer = dgram.createSocket('udp4');

  udpServer.on('error', (err) => {
    // Port mungkin sedang dipakai, abaikan
  });

  udpServer.on('message', (msg, rinfo) => {
    const text = msg.toString();
    if (text.includes('REMOTE_EXAMBRO_FIND_SERVER')) {
      // Klien sedang mencari server! Cari IP yang satu subnet dengan klien
      const clientIP = rinfo.address;
      const all = getAllActiveIPv4();
      const clientSubnet = clientIP.split('.').slice(0, 3).join('.');
      const matchedIface = all.find((i) => i.ip.startsWith(clientSubnet)) || all[0];

      const reply = Buffer.from(`REMOTE_EXAMBRO_BEACON:${JSON.stringify({ ip: matchedIface.ip, port: PORT, hostname: os.hostname() })}`);
      udpServer.send(reply, 0, reply.length, rinfo.port, rinfo.address, () => {});
    }
  });

  udpServer.bind(UDP_PORT, () => {
    udpServer.setBroadcast(true);
  });

  // Broadcast periodik ke setiap subnet kartu jaringan yang aktif
  setInterval(() => {
    try {
      const all = getAllActiveIPv4();
      all.forEach((iface) => {
        const message = Buffer.from(`REMOTE_EXAMBRO_BEACON:${JSON.stringify({ ip: iface.ip, port: PORT, hostname: os.hostname() })}`);
        udpServer.send(message, 0, message.length, UDP_PORT, iface.broadcast, () => {});
      });
      // Juga kirim ke 255.255.255.255
      const globalMsg = Buffer.from(`REMOTE_EXAMBRO_BEACON:${JSON.stringify({ ip: getLocalLANIP(), port: PORT, hostname: os.hostname() })}`);
      udpServer.send(globalMsg, 0, globalMsg.length, UDP_PORT, '255.255.255.255', () => {});
    } catch (e) {}
  }, 2000);
}

// WebSocket broadcast ke Dashboard Proktor
function broadcastToDashboards(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

// Periodic check offline clients
setInterval(() => {
  const now = Date.now();
  let changed = false;
  clients.forEach((c) => {
    const isOnline = (now - c.lastSeen) < CLIENT_TIMEOUT_MS;
    if (c.online !== isOnline) {
      c.online = isOnline;
      changed = true;
    }
  });
  if (changed) {
    broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
  }
}, 2000);

// --- REST API UNTUK CLIENT AGENT ---

app.post('/api/agent/heartbeat', (req, res) => {
  const {
    clientId,
    hostname,
    ip,
    mac,
    username,
    exambrowserRunning,
    exambrowserPid,
    webcamAvailable,
    webcamName,
    osVersion,
    uptime,
    results
  } = req.body;

  if (!clientId && !hostname && !mac) {
    return res.status(400).json({ error: 'Identitas klien diperlukan' });
  }

  // Gunakan MAC Address atau Hostname sebagai ID unik komputer fisik (mencegah duplikat)
  const uniqueId = mac ? ('PC_' + mac.replace(/[:-]/g, '')) : (hostname || clientId);

  const isNew = !clients.has(uniqueId);
  const existing = clients.get(uniqueId) || {};
  const statusChanged = isNew || (existing.exambrowserRunning !== !!exambrowserRunning) || (existing.online !== true) || (existing.ip !== (ip || existing.ip));

  const clientData = {
    ...existing,
    clientId: uniqueId,
    processId: clientId,
    hostname: hostname || existing.hostname || 'Client-PC',
    labName: req.body.labName || existing.labName || 'C1',
    deskNumber: existing.deskNumber || '',
    ip: ip || existing.ip || req.ip,
    mac: mac || existing.mac || '',
    username: username || 'Unknown',
    exambrowserRunning: !!exambrowserRunning,
    exambrowserPid: exambrowserPid || null,
    webcamAvailable: !!webcamAvailable,
    webcamName: webcamName || '',
    osVersion: osVersion || '',
    uptime: uptime || 0,
    lastSeen: Date.now(),
    online: true
  };

  clients.set(uniqueId, clientData);

  if (isNew) {
    saveClientsStore();
    addLog('info', `Klien baru terhubung: ${clientData.hostname} (${clientData.ip})`);
  }

  // Tangani hasil tugas yang dilaporkan agen
  if (results && Array.isArray(results) && results.length > 0) {
    results.forEach((r) => {
      const statusType = r.success ? 'success' : 'error';
      addLog(statusType, `[${clientData.hostname}] ${r.message}`);
      if (r.screenshot) {
        clientData.latestScreenshot = r.screenshot;
        clientData.screenshotTime = new Date().toLocaleTimeString('id-ID');
        broadcastToDashboards({
          type: 'SCREENSHOT_UPDATE',
          clientId: uniqueId,
          image: r.screenshot,
          time: clientData.screenshotTime,
          hostname: clientData.hostname,
          ip: clientData.ip
        });
      }
      if (r.cameraImage) {
        clientData.latestCameraImage = r.cameraImage;
        clientData.cameraTime = new Date().toLocaleTimeString('id-ID');
        broadcastToDashboards({
          type: 'CAMERA_UPDATE',
          clientId: uniqueId,
          image: r.cameraImage,
          time: clientData.cameraTime,
          hostname: clientData.hostname,
          ip: clientData.ip,
          webcamName: clientData.webcamName
        });
      }
    });
  }

  if (statusChanged) {
    broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
  }

  // Ambil tugas yang tertunda untuk klien ini secara cerdas (dukung pencarian berbasis MAC, IP, Hostname)
  const tasks = [];
  const candidateKeys = new Set([
    uniqueId,
    mac ? ('PC_' + mac.replace(/[:-]/g, '')) : null,
    mac,
    ip,
    hostname,
    clientId
  ]);

  for (const key of candidateKeys) {
    if (key && pendingTasks.has(key)) {
      tasks.push(...pendingTasks.get(key));
      pendingTasks.delete(key);
    }
  }

  return res.json({ status: 'ok', tasks });
});

// Endpoint streaming kamera ultra-cepat (Sub-detik / Realtime Live Stream)
app.post('/api/agent/live-frame', (req, res) => {
  const { clientId, image, webcamName } = req.body;
  if (!clientId || !image) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  const clientData = clients.get(clientId);
  const time = new Date().toLocaleTimeString('id-ID');
  if (clientData) {
    clientData.latestCameraImage = image;
    clientData.cameraTime = time;
    clientData.lastSeen = Date.now();
  }

  broadcastToDashboards({
    type: 'CAMERA_UPDATE',
    clientId,
    image,
    time,
    hostname: clientData ? clientData.hostname : '',
    ip: clientData ? clientData.ip : req.ip,
    webcamName: webcamName || (clientData ? clientData.webcamName : 'Webcam')
  });

  return res.json({ status: 'ok' });
});

// --- REST API UNTUK DASHBOARD PROKTOR ---

app.get('/api/info', (req, res) => {
  res.json({
    serverIp: SERVER_IP,
    port: PORT,
    totalClients: clients.size,
    onlineClients: Array.from(clients.values()).filter((c) => c.online).length
  });
});

app.get('/api/clients', (req, res) => {
  res.json(Array.from(clients.values()));
});

app.post('/api/wake', (req, res) => {
  const { target } = req.body;
  let targetClients = [];

  if (target === 'all' || !target) {
    targetClients = Array.from(clients.values());
  } else if (Array.isArray(target)) {
    targetClients = Array.from(clients.values()).filter((c) => target.includes(c.clientId));
  } else if (typeof target === 'string') {
    targetClients = Array.from(clients.values()).filter((c) => c.clientId === target);
  }

  let sentCount = 0;
  targetClients.forEach((c) => {
    if (c.mac && sendWakeOnLAN(c.mac)) {
      sentCount++;
    }
  });

  addLog('info', `Paket Wake-on-LAN (WoL) dikirim ke ${sentCount} komputer.`);
  res.json({ success: true, count: sentCount });
});

// Pencocokan target cerdas berbasis MAC, IP, atau Hostname
function resolveCanonicalId(targetKey) {
  if (!targetKey) return targetKey;
  const keyStr = String(targetKey).trim().toLowerCase();
  const cleanMac = keyStr.replace(/[:-]/g, '');

  for (const [id, c] of clients.entries()) {
    if (id.toLowerCase() === keyStr) return id;
    if (c.clientId && c.clientId.toLowerCase() === keyStr) return id;
    if (c.mac) {
      const cMac = c.mac.toLowerCase();
      const cCleanMac = cMac.replace(/[:-]/g, '');
      if (cMac === keyStr || cCleanMac === cleanMac || ('pc_' + cCleanMac) === keyStr) return id;
    }
    if (c.ip && c.ip.toLowerCase() === keyStr) return id;
    if (c.hostname && c.hostname.toLowerCase() === keyStr) return id;
    if (c.deskNumber && c.deskNumber.toLowerCase() === keyStr) return id;
  }
  return targetKey;
}

app.post('/api/command', (req, res) => {
  const { command, target, params = {} } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command harus ditentukan' });
  }

  let targetIds = [];
  if (target === 'all') {
    targetIds = Array.from(clients.values())
      .filter((c) => c.online)
      .map((c) => c.clientId);
  } else if (Array.isArray(target)) {
    targetIds = target;
  } else if (typeof target === 'string') {
    targetIds = [target];
  }

  if (targetIds.length === 0) {
    return res.status(400).json({ error: 'Tidak ada klien target yang aktif' });
  }

  const taskId = 'task-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
  
  let finalCommand = command;
  let finalParams = { ...params };

  // Penerjemahan cerdas ke exec_custom agar fitur baru langsung jalan di agen klien aktif tanpa wajib update sekarang
  if (command === 'lock_wallpaper') {
    finalCommand = 'exec_custom';
    finalParams = {
      script: `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\ActiveDesktop'; if(-not (Test-Path $p)){New-Item -Path $p -Force|Out-Null}; Set-ItemProperty -Path $p -Name 'NoChangingWallPaper' -Value 1 -Type DWord -Force; $p2='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\ActiveDesktop'; if(-not (Test-Path $p2)){New-Item -Path $p2 -Force|Out-Null}; Set-ItemProperty -Path $p2 -Name 'NoChangingWallPaper' -Value 1 -Type DWord -Force; $p3='HKCU:\\Software\\Policies\\Microsoft\\Windows\\Personalization'; if(-not (Test-Path $p3)){New-Item -Path $p3 -Force|Out-Null}; Set-ItemProperty -Path $p3 -Name 'NoChangingDesktopBackground' -Value 1 -Type DWord -Force; [System.Console]::Beep(1000, 200); Write-Output 'Wallpaper dikunci'`
    };
  } else if (command === 'unlock_wallpaper') {
    finalCommand = 'exec_custom';
    finalParams = {
      script: `$p='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\ActiveDesktop'; if(Test-Path $p){Remove-ItemProperty -Path $p -Name 'NoChangingWallPaper' -ErrorAction SilentlyContinue}; $p2='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\ActiveDesktop'; if(Test-Path $p2){Remove-ItemProperty -Path $p2 -Name 'NoChangingWallPaper' -ErrorAction SilentlyContinue}; $p3='HKCU:\\Software\\Policies\\Microsoft\\Windows\\Personalization'; if(Test-Path $p3){Remove-ItemProperty -Path $p3 -Name 'NoChangingDesktopBackground' -ErrorAction SilentlyContinue}; [System.Console]::Beep(1200, 200); Write-Output 'Kunci Wallpaper dibuka'`
    };
  } else if (command === 'lock_installer') {
    finalCommand = 'exec_custom';
    finalParams = {
      script: `$k='HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer'; if(-not (Test-Path $k)){New-Item -Path $k -Force|Out-Null}; Set-ItemProperty -Path $k -Name 'DisableMSI' -Value 2 -Type DWord -Force; [System.Console]::Beep(1000, 200); Write-Output 'Instalasi diblokir'`
    };
  } else if (command === 'unlock_installer') {
    finalCommand = 'exec_custom';
    finalParams = {
      script: `$k='HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\Installer'; if(Test-Path $k){Remove-ItemProperty -Path $k -Name 'DisableMSI' -ErrorAction SilentlyContinue}; [System.Console]::Beep(1200, 200); Write-Output 'Izin Instalasi dibuka'`
    };
  } else if (command === 'send_message') {
    const rawMsg = (params.message || 'Pemberitahuan dari Guru/Proktor').replace(/[`"$]/g, ' ');
    finalCommand = 'exec_custom';
    finalParams = {
      script: `[System.Console]::Beep(1400, 250); [System.Console]::Beep(1800, 350); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("${rawMsg}", "PENGUMUMAN DARI PROKTOR", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)`
    };
  } else if (command === 'open_url') {
    const url = (params.url || 'https://google.com').replace(/[`"$]/g, '');
    finalCommand = 'exec_custom';
    finalParams = {
      script: `Start-Process "${url}"`
    };
  } else if (command === 'lock_screen') {
    const rawMsg = (params.message || 'Layar dikunci sementara oleh Guru / Proktor.\\nHarap perhatikan penjelasan di depan kelas.').replace(/[`"$]/g, ' ');
    finalCommand = 'exec_custom';
    finalParams = {
      script: 'try { Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "LabScreenLock" } | Stop-Process -Force } catch {}; $c = \'Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = "LabScreenLock"; $f.FormBorderStyle = "None"; $f.WindowState = "Maximized"; $f.TopMost = $true; $f.BackColor = [System.Drawing.Color]::FromArgb(15,23,42); $l = New-Object System.Windows.Forms.Label; $l.Text = "🔒 LAYAR DIKUNCI\\n\\n' + rawMsg + '"; $l.Font = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold); $l.ForeColor = [System.Drawing.Color]::FromArgb(56,189,248); $l.Dock = "Fill"; $l.TextAlign = "MiddleCenter"; $f.Controls.Add($l); $f.ShowDialog()\'; Start-Process powershell.exe -ArgumentList (\'-WindowStyle Hidden -Command "\' + $c + \'"\')'
    };
  } else if (command === 'unlock_screen') {
    finalCommand = 'exec_custom';
    finalParams = {
      script: `Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'LabScreenLock' } | Stop-Process -Force`
    };
  }

  const taskObj = { id: taskId, command: finalCommand, params: finalParams };

  targetIds.forEach((cid) => {
    const canonicalId = resolveCanonicalId(cid);
    if (!pendingTasks.has(canonicalId)) {
      pendingTasks.set(canonicalId, []);
    }
    pendingTasks.get(canonicalId).push(taskObj);
  });

  const cmdNames = {
    launch_standard: 'Buka ExamBrowser (Standar)',
    launch_webcam: 'Buka ExamBrowser (Webcam)',
    close_graceful: 'Tutup Aman (Ctrl+C+B)',
    kill_force: 'Paksa Berhenti (Kill)',
    shutdown: 'Shutdown',
    restart: 'Restart',
    cancel_shutdown: 'Batalkan Shutdown',
    screenshot: 'Ambil Tangkapan Layar',
    camera_snapshot: 'Ambil Foto Kamera Siswa',
    lock_screen: 'Kunci Layar (Mode Perhatian)',
    unlock_screen: 'Buka Kunci Layar',
    send_message: 'Kirim Pesan Pengumuman',
    open_url: 'Buka Halaman Web/Ujian',
    lock_wallpaper: 'Kunci Wallpaper Desktop',
    unlock_wallpaper: 'Buka Kunci Wallpaper',
    lock_installer: 'Blokir Instalasi Software',
    unlock_installer: 'Buka Izin Instalasi Software',
    update_agent: 'Perbarui Agen Klien (OTA)',
    exec_custom: 'Jalankan Skrip Kustom'
  };

  const humanCmd = cmdNames[command] || command;
  addLog('warning', `Perintah '${humanCmd}' dikirim ke ${targetIds.length} klien.`);

  res.json({ success: true, taskId, targetCount: targetIds.length });
});

// Endpoint Cek Meja / Identifikasi Visual & Audio di Layar Klien
app.post('/api/client/identify', (req, res) => {
  const { target } = req.body;
  let targetClients = [];

  if (target === 'all' || !target) {
    targetClients = Array.from(clients.values()).filter(c => c.online);
  } else if (Array.isArray(target)) {
    targetClients = target.map(t => clients.get(resolveCanonicalId(t))).filter(Boolean);
  } else {
    const c = clients.get(resolveCanonicalId(target));
    if (c) targetClients = [c];
  }

  if (targetClients.length === 0) {
    return res.status(400).json({ error: 'Tidak ada klien target online' });
  }

  targetClients.forEach(c => {
    const deskLabel = c.deskNumber ? `NOMOR MEJA: ${c.deskNumber}` : 'IDENTIFIKASI MEJA PROKTOR';
    const psScript = `try { [System.Console]::Beep(1200, 250); [System.Console]::Beep(1600, 400); } catch {}; Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.Form; $f.Text = 'IDENTIFIKASI PROKTOR'; $f.FormBorderStyle = 'FixedDialog'; $f.MaximizeBox = $false; $f.MinimizeBox = $false; $f.StartPosition = 'CenterScreen'; $f.TopMost = $true; $f.Size = New-Object System.Drawing.Size(560, 240); $f.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42); $p = New-Object System.Windows.Forms.Panel; $p.Dock = 'Fill'; $l1 = New-Object System.Windows.Forms.Label; $l1.Text = '📍 ${deskLabel}'; $l1.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold); $l1.ForeColor = [System.Drawing.Color]::FromArgb(56, 189, 248); $l1.Dock = 'Top'; $l1.Height = 55; $l1.TextAlign = 'MiddleCenter'; $l2 = New-Object System.Windows.Forms.Label; $l2.Text = "Komputer: $env:COMPUTERNAME\`nIP: ${c.ip || ''}"; $l2.Font = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Regular); $l2.ForeColor = [System.Drawing.Color]::White; $l2.Dock = 'Fill'; $l2.TextAlign = 'MiddleCenter'; $p.Controls.Add($l2); $p.Controls.Add($l1); $f.Controls.Add($p); $t = New-Object System.Windows.Forms.Timer; $t.Interval = 4500; $t.add_Tick({ $f.Close() }); $t.Start(); $f.ShowDialog()`;

    const taskId = 'task-id-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const taskObj = {
      id: taskId,
      command: 'exec_custom',
      params: { script: psScript }
    };

    if (!pendingTasks.has(c.clientId)) {
      pendingTasks.set(c.clientId, []);
    }
    pendingTasks.get(c.clientId).push(taskObj);
  });

  addLog('info', `Perintah Cek Meja (Flash/Beep) dikirim ke ${targetClients.length} komputer.`);
  res.json({ success: true, count: targetClients.length });
});

// Endpoint Update Nomor Meja Tunggal
app.post('/api/client/desk', (req, res) => {
  const { clientId, deskNumber } = req.body;
  if (!clientId) {
    return res.status(400).json({ error: 'ClientId diperlukan' });
  }

  const canonicalId = resolveCanonicalId(clientId);
  const clientData = clients.get(canonicalId);
  if (!clientData) {
    return res.status(404).json({ error: 'Klien tidak ditemukan' });
  }

  clientData.deskNumber = String(deskNumber || '').trim();
  saveClientsStore();
  broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
  addLog('info', `Nomor Meja untuk ${clientData.hostname} diperbarui: '${clientData.deskNumber || '-'}'`);
  res.json({ success: true, deskNumber: clientData.deskNumber });
});

// Endpoint Update Nomor Meja Massal (Batch Mapping)
app.post('/api/client/batch-desk', (req, res) => {
  const { mappings } = req.body; // Array of { clientId, deskNumber }
  if (!Array.isArray(mappings)) {
    return res.status(400).json({ error: 'Format data mappings harus berupa array' });
  }

  let updatedCount = 0;
  mappings.forEach(item => {
    if (!item.clientId) return;
    const canonicalId = resolveCanonicalId(item.clientId);
    const clientData = clients.get(canonicalId);
    if (clientData) {
      clientData.deskNumber = String(item.deskNumber || '').trim();
      updatedCount++;
    }
  });

  if (updatedCount > 0) {
    saveClientsStore();
    broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
    addLog('info', `Pembaruan massal: ${updatedCount} nomor meja berhasil disimpan.`);
  }

  res.json({ success: true, count: updatedCount });
});

app.delete('/api/clients/:id', (req, res) => {
  const { id } = req.params;
  clients.delete(id);
  pendingTasks.delete(id);
  broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
  res.json({ success: true });
});

app.delete('/api/clients', (req, res) => {
  // Bersihkan semua klien offline
  for (const [id, c] of clients.entries()) {
    if (!c.online) {
      clients.delete(id);
      pendingTasks.delete(id);
    }
  }
  broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });
  res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
  res.json(activityLogs);
});

// WebSocket Handler
wss.on('connection', (ws) => {
  // Kirim inisial state ke dashboard yang baru terhubung
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    data: {
      serverIp: SERVER_IP,
      port: PORT,
      clients: Array.from(clients.values()),
      logs: activityLogs
    }
  }));
});

// Mulai Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Master Controller RemoteLab Pro Berjalan!`);
  console.log(`🌐 Pusat Manajemen Lab & Kontrol CBT/Ujian`);
  console.log(`🌐 Akses Dashboard Lokal : http://localhost:${PORT}`);
  console.log(`🌐 Akses Jaringan Lab    : http://${SERVER_IP}:${PORT}`);
  console.log(`📡 Auto-Discovery UDP   : Port ${UDP_PORT}`);
  console.log(`=======================================================`);
  startUDPBeacon();
  addLog('info', `Server Master Controller aktif di http://${SERVER_IP}:${PORT}`);
});
