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
const CLIENT_TIMEOUT_MS = 6000; // Jika tidak ada heartbeat dalam 6 detik, anggap offline

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
        c.online = false; // Saat server baru mulai, set awal offline
        clients.set(c.clientId, c);
      });
      console.log(`[Store] Memuat ${clients.size} data klien tersimpan.`);
    }
  } catch (e) {}
}

function saveClientsStore() {
  try {
    fs.writeFileSync(CLIENTS_FILE, JSON.stringify(Array.from(clients.values()), null, 2));
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

  const clientData = {
    ...existing,
    clientId: uniqueId,
    processId: clientId,
    hostname: hostname || existing.hostname || 'Client-PC',
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
  saveClientsStore();

  if (isNew) {
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
      }
    });
  }

  broadcastToDashboards({ type: 'CLIENTS_UPDATE', data: Array.from(clients.values()) });

  // Ambil tugas yang tertunda untuk klien ini
  const tasks = pendingTasks.get(uniqueId) || [];
  pendingTasks.delete(uniqueId);

  return res.json({ status: 'ok', tasks });
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
  const taskObj = { id: taskId, command, params };

  targetIds.forEach((cid) => {
    if (!pendingTasks.has(cid)) {
      pendingTasks.set(cid, []);
    }
    pendingTasks.get(cid).push(taskObj);
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
    exec_custom: 'Jalankan Skrip Kustom'
  };

  const humanCmd = cmdNames[command] || command;
  addLog('warning', `Perintah '${humanCmd}' dikirim ke ${targetIds.length} klien.`);

  res.json({ success: true, taskId, targetCount: targetIds.length });
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
  console.log(`🚀 Master Controller RemoteExambro Berjalan!`);
  console.log(`🌐 Akses Dashboard Lokal : http://localhost:${PORT}`);
  console.log(`🌐 Akses Jaringan Lab    : http://${SERVER_IP}:${PORT}`);
  console.log(`📡 Auto-Discovery UDP   : Port ${UDP_PORT}`);
  console.log(`=======================================================`);
  startUDPBeacon();
  addLog('info', `Server Master Controller aktif di http://${SERVER_IP}:${PORT}`);
});
