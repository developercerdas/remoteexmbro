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

// Mendapatkan IP LAN Server
function getLocalLANIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const SERVER_IP = getLocalLANIP();

// Wake-on-LAN (WoL) Magic Packet Sender
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

  const udpClient = dgram.createSocket('udp4');
  udpClient.bind(() => {
    udpClient.setBroadcast(true);
    udpClient.send(magicPacket, 0, magicPacket.length, 9, '255.255.255.255', (err) => {
      try { udpClient.close(); } catch (e) {}
    });
  });
  return true;
}

// UDP Beacon Broadcast untuk Auto-Discovery Agent
function startUDPBeacon() {
  const udpClient = dgram.createSocket('udp4');
  udpClient.bind(() => {
    udpClient.setBroadcast(true);
  });

  setInterval(() => {
    try {
      const message = Buffer.from(`REMOTE_EXAMBRO_BEACON:${JSON.stringify({ ip: SERVER_IP, port: PORT })}`);
      udpClient.send(message, 0, message.length, UDP_PORT, '255.255.255.255', (err) => {
        if (err && err.code !== 'ENETUNREACH') {
          // ignore transient udp broadcast errors
        }
      });
    } catch (e) {
      // ignore
    }
  }, 2500);
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

  if (!clientId) {
    return res.status(400).json({ error: 'clientId diperlukan' });
  }

  const isNew = !clients.has(clientId);
  const existing = clients.get(clientId) || {};

  const clientData = {
    ...existing,
    clientId,
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

  clients.set(clientId, clientData);

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
  const tasks = pendingTasks.get(clientId) || [];
  pendingTasks.delete(clientId);

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
