require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 5000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// UroPay / GPay Configuration
const UROPAY_API_BASE = 'https://api.uropay.me';
const UROPAY_API_KEY = process.env.UROPAY_API_KEY || '';
const UROPAY_SECRET = process.env.UROPAY_SECRET || '';
const UROPAY_VPA = process.env.UROPAY_VPA || 'sdhinakar6-1@oksbi';
const UROPAY_VPA_NAME = process.env.UROPAY_VPA_NAME || 'LIGHT.LTD';
const GPAY_WEBHOOK_SECRET = process.env.GPAY_WEBHOOK_SECRET || 'claychat_gpay_secret_2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '413973614482-compute@developer.gserviceaccount.com';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Persistent Storage Paths
const USERS_FILE_PATH = path.join(__dirname, 'users.json');
const OFFERS_FILE_PATH = path.join(__dirname, 'offers.json');
const REPORTS_FILE_PATH = path.join(__dirname, 'reports.json');
const BANS_FILE_PATH = path.join(__dirname, 'banned_users.json');
const REPORTS_LOG_PATH = path.join(__dirname, 'reports.log');

// In-Memory & Persistent State
let registeredUsers = new Map(); // email -> user object
let offersConfig = {
  vipPrice: 20,
  currency: 'INR',
  title: 'VIP Monthly Pass',
  badge: '⚡ SPECIAL 50% OFF',
  discountText: 'Limited Time Offer: ₹20 only (Regular ₹40)',
  features: [
    'Gender Filter: Match exclusively with Female or Male',
    'Age & Common Interests Priority Matchmaking',
    'Zero Wait Time: Priority Queue',
    'Golden Crown VIP Badge'
  ],
  updatedAt: new Date().toISOString()
};
let reportsList = [];
let bannedUsers = new Set();

// Helper Loaders
function loadData() {
  try {
    if (fs.existsSync(USERS_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE_PATH, 'utf-8'));
      registeredUsers = new Map(Object.entries(data));
      console.log(`[Auth] Loaded ${registeredUsers.size} registered users.`);
    }
    if (fs.existsSync(OFFERS_FILE_PATH)) {
      offersConfig = JSON.parse(fs.readFileSync(OFFERS_FILE_PATH, 'utf-8'));
      console.log(`[Offers] Loaded current VIP price: ₹${offersConfig.vipPrice}`);
    }
    if (fs.existsSync(REPORTS_FILE_PATH)) {
      reportsList = JSON.parse(fs.readFileSync(REPORTS_FILE_PATH, 'utf-8'));
      console.log(`[Reports] Loaded ${reportsList.length} user reports.`);
    }
    if (fs.existsSync(BANS_FILE_PATH)) {
      const bans = JSON.parse(fs.readFileSync(BANS_FILE_PATH, 'utf-8'));
      bannedUsers = new Set(bans);
      console.log(`[Moderation] Loaded ${bannedUsers.size} banned users.`);
    }
  } catch (err) {
    console.error('[Storage] Error loading data files:', err);
  }
}

function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(Object.fromEntries(registeredUsers), null, 2));
  } catch (err) {
    console.error('[Auth] Failed to save users.json:', err);
  }
}

function saveOffers() {
  try {
    fs.writeFileSync(OFFERS_FILE_PATH, JSON.stringify(offersConfig, null, 2));
  } catch (err) {
    console.error('[Offers] Failed to save offers.json:', err);
  }
}

function saveReports() {
  try {
    fs.writeFileSync(REPORTS_FILE_PATH, JSON.stringify(reportsList, null, 2));
  } catch (err) {
    console.error('[Reports] Failed to save reports.json:', err);
  }
}

function saveBans() {
  try {
    fs.writeFileSync(BANS_FILE_PATH, JSON.stringify(Array.from(bannedUsers), null, 2));
  } catch (err) {
    console.error('[Moderation] Failed to save banned_users.json:', err);
  }
}

loadData();

// Active Real-time State
// socketId -> { id, userId, myGender, lookingFor, age, agePreference, interests: [], chatMode: 'video'|'text', isVip, roomId, partnerId, blockedUsers: Set, reportCount: 0, connectedAt, email, userName }
const activeUsers = new Map();
const userSockets = new Map(); // userId -> socketId
const waitingQueue = [];
const activeRooms = new Map();
const orders = new Map(); // orderId -> { orderId, merchantOrderId, userId, amount, status, date }

// Admin Auth Middleware
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-key'] || req.query.key;
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Admin Password' });
  }
  next();
}

// Moderation Log Helper
function logReportEntry(reporterId, reportedId, reason) {
  const report = {
    id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    reporterId,
    reportedId,
    reason: reason || 'Inappropriate behavior',
    timestamp: new Date().toISOString(),
    status: 'PENDING'
  };
  reportsList.unshift(report);
  if (reportsList.length > 500) reportsList = reportsList.slice(0, 500);
  saveReports();

  const line = `[${report.timestamp}] Reporter: ${reporterId} | Reported: ${reportedId} | Reason: ${reason}\n`;
  fs.appendFile(REPORTS_LOG_PATH, line, (err) => {
    if (err) console.error('Failed to write report log:', err);
  });

  io.to('admin_room').emit('new-report', report);
  return report;
}

function activateUserVip(userId) {
  for (const [sId, user] of activeUsers.entries()) {
    if (user.userId === userId) {
      user.isVip = true;
      if (user.email && registeredUsers.has(user.email)) {
        const u = registeredUsers.get(user.email);
        u.isVip = true;
        registeredUsers.set(user.email, u);
        saveUsers();
      }
      const socket = io.sockets.sockets.get(sId);
      if (socket) {
        socket.emit('vip-activated', {
          isVip: true,
          message: '🌟 VIP Plan activated! Filters & priority matching unlocked.'
        });
      }
    }
  }
}

// ----------------------------------------------------
// Public REST Endpoints
// ----------------------------------------------------

app.get('/api/config', (req, res) => {
  res.json({
    uropayConfigured: Boolean(UROPAY_API_KEY && UROPAY_SECRET),
    vpa: UROPAY_VPA,
    vpaName: UROPAY_VPA_NAME,
    turnConfigured: !!process.env.TURN_SERVER_URL,
    googleClientId: GOOGLE_CLIENT_ID,
    vipPrice: offersConfig.vipPrice,
    currency: offersConfig.currency || 'INR'
  });
});

// Dynamic Offers endpoint for clients
app.get('/api/payment/offers', (req, res) => {
  res.json({
    success: true,
    data: offersConfig
  });
});

// Google Login Endpoint
app.post('/api/auth/google-login', (req, res) => {
  const { email, name, picture, sub, socketId } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  let user = registeredUsers.get(email);
  if (!user) {
    user = {
      email,
      name: name || email.split('@')[0],
      picture: picture || '',
      googleId: sub || '',
      isVip: false,
      createdAt: new Date().toISOString()
    };
    registeredUsers.set(email, user);
  } else {
    if (name) user.name = name;
    if (picture) user.picture = picture;
    user.lastLogin = new Date().toISOString();
  }
  saveUsers();

  if (socketId && activeUsers.has(socketId)) {
    const active = activeUsers.get(socketId);
    active.email = email;
    active.userName = user.name;
    if (user.isVip) {
      active.isVip = true;
    }
  }

  console.log(`[Google Auth] Logged in: ${email} (VIP: ${user.isVip})`);

  res.json({
    success: true,
    user: {
      email: user.email,
      name: user.name,
      picture: user.picture,
      isVip: user.isVip
    }
  });
});

// Create Order (UPI QR Generation with custom amount & VPA)
app.post('/api/uropay/create-order', async (req, res) => {
  const { userId, customerName = 'Customer', customerEmail = 'customer@example.com', amount = null } = req.body;
  const merchantOrderId = `VIP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const finalPrice = amount !== null ? amount : (offersConfig.vipPrice * 100); // in paise
  const amountInRupees = (finalPrice / 100).toFixed(2);

  const mockOrderId = `order_${Date.now()}`;
  // Standard UPI URI format with specified VPA and Name
  const upiUri = `upi://pay?pa=${encodeURIComponent(UROPAY_VPA)}&pn=${encodeURIComponent(UROPAY_VPA_NAME)}&am=${amountInRupees}&cu=INR&tn=Clay%20Chat%20VIP`;

  try {
    const qrDataUrl = await QRCode.toDataURL(upiUri, {
      width: 320,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' }
    });

    const orderRecord = {
      uroPayOrderId: mockOrderId,
      merchantOrderId,
      userId,
      customerName,
      customerEmail,
      amount: finalPrice,
      amountRupees: amountInRupees,
      status: 'CREATED',
      upiUri,
      createdAt: new Date().toISOString()
    };

    orders.set(mockOrderId, orderRecord);

    res.json({
      success: true,
      data: {
        uroPayOrderId: mockOrderId,
        merchantOrderId,
        paymentLink: upiUri,
        qrCodeBase64: qrDataUrl,
        amount: finalPrice,
        amountRupees: amountInRupees,
        vpa: UROPAY_VPA,
        vpaName: UROPAY_VPA_NAME
      }
    });
  } catch (err) {
    console.error('[QR Generation Error]', err);
    res.status(500).json({ success: false, error: 'Failed to generate UPI QR code' });
  }
});

// Submit UTR
app.post('/api/uropay/submit-utr', (req, res) => {
  const { uroPayOrderId, utr } = req.body;
  if (!uroPayOrderId || !utr) {
    return res.status(400).json({ success: false, error: 'Missing uroPayOrderId or utr' });
  }

  const order = orders.get(uroPayOrderId);
  if (order) {
    order.utr = utr;
    order.status = 'COMPLETED';
    activateUserVip(order.userId);

    // Notify admin
    io.to('admin_room').emit('new-order', order);

    return res.json({
      success: true,
      message: 'Payment verified successfully! VIP activated.',
      orderStatus: 'COMPLETED'
    });
  }

  res.json({
    success: true,
    message: 'UTR submitted for verification.',
    orderStatus: 'UTR_SUBMITTED'
  });
});

// Check Order Status
app.get('/api/uropay/status/:uroPayOrderId', (req, res) => {
  const { uroPayOrderId } = req.params;
  const order = orders.get(uroPayOrderId);
  res.json({
    success: true,
    data: {
      uroPayOrderId,
      orderStatus: order ? order.status : 'PENDING'
    }
  });
});

// Custom Google Pay for Business Notification Webhook
app.post('/api/gpay/webhook', (req, res) => {
  const authHeader = req.headers['x-webhook-secret'];
  if (authHeader && authHeader !== GPAY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized webhook request' });
  }

  const { title = '', text = '', amount = null, payer = '' } = req.body;
  console.log(`[GPay Business Notification] "${title}" - "${text}"`);

  let detectedAmount = amount;
  if (!detectedAmount) {
    const combined = `${title} ${text}`;
    const match = combined.match(/(?:₹|Rs\.?|inr)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:received|credited|from)?/i);
    if (match) detectedAmount = parseFloat(match[1]);
  }

  let activatedUserId = null;
  // Activate any pending order first
  for (const [orderId, order] of orders.entries()) {
    if (order.status === 'CREATED' || order.status === 'UTR_SUBMITTED') {
      order.status = 'COMPLETED';
      activateUserVip(order.userId);
      activatedUserId = order.userId;
      io.to('admin_room').emit('new-order', order);
      console.log(`[GPay Business] Auto-activated VIP for user ${order.userId} on order ${orderId}`);
      break;
    }
  }

  // Fallback: activate most recent non-VIP active user
  if (!activatedUserId && activeUsers.size > 0) {
    const lastUser = Array.from(activeUsers.values()).reverse().find(u => !u.isVip);
    if (lastUser) {
      activateUserVip(lastUser.userId);
      activatedUserId = lastUser.userId;
      console.log(`[GPay Business] Auto-activated VIP for active user ${lastUser.userId}`);
    }
  }

  const recordedOrder = {
    uroPayOrderId: `gpay_${Date.now()}`,
    merchantOrderId: `GPAY_${Date.now()}`,
    userId: activatedUserId || 'GPay_User',
    amount: detectedAmount ? detectedAmount * 100 : 2000,
    amountRupees: detectedAmount || '20.00',
    status: 'COMPLETED',
    source: 'GPay Companion Notification',
    title,
    text,
    createdAt: new Date().toISOString()
  };
  orders.set(recordedOrder.uroPayOrderId, recordedOrder);

  // Broadcast to Admin & Connected Companion clients
  io.to('admin_room').emit('new-order', recordedOrder);

  res.status(200).json({
    success: true,
    message: 'GPay notification processed successfully',
    activated: Boolean(activatedUserId),
    activatedUserId,
    detectedAmount
  });
});

// ----------------------------------------------------
// Admin REST APIs (Protected by requireAdminAuth)
// ----------------------------------------------------

// Admin Dashboard Analytics & Metrics
app.get('/api/admin/metrics', requireAdminAuth, (req, res) => {
  let videoOnline = 0;
  let textOnline = 0;
  for (const user of activeUsers.values()) {
    if (user.chatMode === 'text') textOnline++;
    else videoOnline++;
  }

  let totalVipCount = 0;
  for (const u of registeredUsers.values()) {
    if (u.isVip) totalVipCount++;
  }

  let completedOrders = 0;
  let totalRevenueRupees = 0;
  const recentOrdersList = [];
  for (const ord of orders.values()) {
    if (ord.status === 'COMPLETED') {
      completedOrders++;
      totalRevenueRupees += parseFloat(ord.amountRupees || (ord.amount / 100) || 0);
    }
    recentOrdersList.push(ord);
  }
  recentOrdersList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  res.json({
    success: true,
    metrics: {
      totalOnline: activeUsers.size,
      videoOnline,
      textOnline,
      totalRegistered: registeredUsers.size,
      totalVip: totalVipCount,
      completedOrders,
      totalRevenueRupees: totalRevenueRupees.toFixed(2),
      totalReports: reportsList.length,
      bannedCount: bannedUsers.size
    },
    users: Array.from(registeredUsers.values()),
    recentOrders: recentOrdersList.slice(0, 50),
    reports: reportsList.slice(0, 50),
    offers: offersConfig
  });
});

// Admin Update Offers
app.post('/api/admin/offers', requireAdminAuth, (req, res) => {
  const { vipPrice, title, badge, discountText, features } = req.body;

  if (vipPrice && !isNaN(vipPrice)) offersConfig.vipPrice = parseFloat(vipPrice);
  if (title) offersConfig.title = title;
  if (badge) offersConfig.badge = badge;
  if (discountText) offersConfig.discountText = discountText;
  if (Array.isArray(features)) offersConfig.features = features;
  offersConfig.updatedAt = new Date().toISOString();

  saveOffers();
  io.emit('offers-updated', offersConfig);

  console.log(`[Admin] Updated VIP Offer: ₹${offersConfig.vipPrice}`);
  res.json({ success: true, message: 'Offers updated successfully', offers: offersConfig });
});

// Admin Reports List & Actions
app.get('/api/admin/reports', requireAdminAuth, (req, res) => {
  res.json({ success: true, reports: reportsList });
});

app.post('/api/admin/reports/:id/action', requireAdminAuth, (req, res) => {
  const { id } = req.params;
  const { action } = req.body; // 'ban' | 'dismiss'

  const report = reportsList.find(r => r.id === id);
  if (!report) {
    return res.status(404).json({ success: false, error: 'Report not found' });
  }

  if (action === 'ban') {
    bannedUsers.add(report.reportedId);
    saveBans();
    report.status = 'BANNED';

    // Kick banned user from active connection if online
    for (const [sId, user] of activeUsers.entries()) {
      if (user.userId === report.reportedId) {
        const s = io.sockets.sockets.get(sId);
        if (s) {
          s.emit('moderation-warning', { message: 'Your account has been permanently banned by admin for violation of community standards.' });
          leaveCurrentChat(sId, 'banned');
          s.disconnect(true);
        }
      }
    }
  } else if (action === 'dismiss') {
    report.status = 'DISMISSED';
  }

  saveReports();
  res.json({ success: true, report });
});

// Admin Toggle VIP for a User
app.post('/api/admin/users/:userId/vip', requireAdminAuth, (req, res) => {
  const { userId } = req.params;
  const { isVip } = req.body;

  // Update in registeredUsers if email matches or search by userId
  let found = false;
  for (const [email, user] of registeredUsers.entries()) {
    if (user.email === userId || user.googleId === userId || email === userId) {
      user.isVip = Boolean(isVip);
      registeredUsers.set(email, user);
      found = true;
      break;
    }
  }
  saveUsers();

  // Update in active users
  for (const [sId, user] of activeUsers.entries()) {
    if (user.userId === userId || user.email === userId) {
      user.isVip = Boolean(isVip);
      const s = io.sockets.sockets.get(sId);
      if (s) s.emit('vip-activated', { isVip: user.isVip, message: 'VIP status updated by Administrator.' });
      found = true;
    }
  }

  res.json({ success: true, message: `VIP status set to ${isVip} for ${userId}`, found });
});

// Admin Page Route
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ----------------------------------------------------
// Smart Matchmaking & Queue Engine
// ----------------------------------------------------

function isAgeMatch(candidateAge, preferredRange) {
  if (!preferredRange || preferredRange === 'all') return true;
  if (!candidateAge) return true; // allow unspecified
  const age = parseInt(candidateAge, 10);
  if (preferredRange === '18-24') return age >= 18 && age <= 24;
  if (preferredRange === '25-34') return age >= 25 && age <= 34;
  if (preferredRange === '35+') return age >= 35;
  return true;
}

function calculateCommonInterests(listA, listB) {
  if (!Array.isArray(listA) || !Array.isArray(listB)) return [];
  const setB = new Set(listB.map(s => s.toLowerCase()));
  return listA.filter(item => setB.has(item.toLowerCase()));
}

function isMatchCompatible(userA, userB) {
  if (userA.id === userB.id) return false;
  // Mode Check (Mandatory: Text mode matches only Text mode, Video matches Video)
  if (userA.chatMode !== userB.chatMode) return false;

  // Safety & Ban Check
  if (userA.blockedUsers.has(userB.userId) || userB.blockedUsers.has(userA.userId)) return false;
  if (bannedUsers.has(userA.userId) || bannedUsers.has(userB.userId)) return false;

  // Gender Filter (VIP)
  if (userA.isVip && userA.lookingFor && userA.lookingFor !== 'all') {
    if (userB.myGender !== userA.lookingFor) return false;
  }
  if (userB.isVip && userB.lookingFor && userB.lookingFor !== 'all') {
    if (userA.myGender !== userB.lookingFor) return false;
  }

  // Age Filter (VIP)
  if (userA.isVip && userA.agePreference && userA.agePreference !== 'all') {
    if (!isAgeMatch(userB.age, userA.agePreference)) return false;
  }
  if (userB.isVip && userB.agePreference && userB.agePreference !== 'all') {
    if (!isAgeMatch(userA.age, userB.agePreference)) return false;
  }

  return true;
}

function tryMatchUser(socketId) {
  const user = activeUsers.get(socketId);
  if (!user || user.partnerId || user.inQueue) return;

  // Check ban status
  if (bannedUsers.has(user.userId)) {
    const s = io.sockets.sockets.get(socketId);
    if (s) s.emit('moderation-warning', { message: 'Your account is banned.' });
    return;
  }

  // Find best compatible candidate (prioritizing shared interests)
  let bestIndex = -1;
  let highestScore = -1;

  for (let i = 0; i < waitingQueue.length; i++) {
    const candidateId = waitingQueue[i];
    const candidate = activeUsers.get(candidateId);
    if (!candidate || candidateId === socketId) continue;

    if (isMatchCompatible(user, candidate)) {
      const common = calculateCommonInterests(user.interests, candidate.interests);
      const score = common.length * 10;
      if (score > highestScore) {
        highestScore = score;
        bestIndex = i;
      }
    }
  }

  if (bestIndex !== -1) {
    const [partnerId] = waitingQueue.splice(bestIndex, 1);
    const partner = activeUsers.get(partnerId);

    if (!partner) {
      tryMatchUser(socketId);
      return;
    }

    user.inQueue = false;
    partner.inQueue = false;

    const roomId = `room_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    user.roomId = roomId;
    partner.roomId = roomId;
    user.partnerId = partnerId;
    partner.partnerId = socketId;

    activeRooms.set(roomId, [socketId, partnerId]);

    const socketA = io.sockets.sockets.get(socketId);
    const socketB = io.sockets.sockets.get(partnerId);

    if (socketA) socketA.join(roomId);
    if (socketB) socketB.join(roomId);

    const commonInterests = calculateCommonInterests(user.interests, partner.interests);

    console.log(`[Match] Mode: ${user.chatMode} | ${socketId} <-> ${partnerId} | Common Interests: [${commonInterests.join(', ')}]`);

    if (socketA) {
      socketA.emit('matched', {
        roomId,
        isInitiator: true,
        chatMode: user.chatMode,
        partnerGender: partner.myGender || 'unspecified',
        partnerAge: partner.age || 'unspecified',
        commonInterests
      });
    }
    if (socketB) {
      socketB.emit('matched', {
        roomId,
        isInitiator: false,
        chatMode: partner.chatMode,
        partnerGender: user.myGender || 'unspecified',
        partnerAge: user.age || 'unspecified',
        commonInterests
      });
    }
  } else {
    if (!waitingQueue.includes(socketId)) {
      waitingQueue.push(socketId);
      user.inQueue = true;
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.emit('waiting', { queueLength: waitingQueue.length, chatMode: user.chatMode });
    }
  }
}

function leaveCurrentChat(socketId, reason = 'left') {
  const user = activeUsers.get(socketId);
  if (!user) return;

  const queueIdx = waitingQueue.indexOf(socketId);
  if (queueIdx !== -1) {
    waitingQueue.splice(queueIdx, 1);
    user.inQueue = false;
  }

  const { roomId, partnerId } = user;
  if (partnerId) {
    const partner = activeUsers.get(partnerId);
    if (partner) {
      partner.partnerId = null;
      partner.roomId = null;
      partner.inQueue = false;
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.leave(roomId);
        partnerSocket.emit('partner-left', { reason });
      }
    }
  }

  if (roomId) {
    activeRooms.delete(roomId);
    const currentSocket = io.sockets.sockets.get(socketId);
    if (currentSocket) currentSocket.leave(roomId);
  }

  user.partnerId = null;
  user.roomId = null;
  user.inQueue = false;
}

// ----------------------------------------------------
// Socket.io Real-time Handlers
// ----------------------------------------------------

io.on('connection', (socket) => {
  console.log(`[Socket Connected] ${socket.id}`);

  // Join admin room if requested
  socket.on('admin-join', (data) => {
    if (data && data.key === ADMIN_PASSWORD) {
      socket.join('admin_room');
      socket.emit('admin-authenticated', { success: true });
    }
  });

  socket.on('init-profile', (data) => {
    const {
      userId,
      myGender = 'male',
      lookingFor = 'all',
      age = 22,
      agePreference = 'all',
      interests = [],
      chatMode = 'video',
      isVip = false
    } = data || {};

    if (bannedUsers.has(userId)) {
      socket.emit('moderation-warning', { message: 'This account is permanently banned.' });
      socket.disconnect(true);
      return;
    }

    activeUsers.set(socket.id, {
      id: socket.id,
      userId: userId || socket.id,
      myGender,
      lookingFor,
      age: parseInt(age, 10) || 22,
      agePreference,
      interests: Array.isArray(interests) ? interests : [],
      chatMode: chatMode === 'text' ? 'text' : 'video',
      isVip: Boolean(isVip),
      roomId: null,
      partnerId: null,
      inQueue: false,
      blockedUsers: new Set(),
      reportCount: 0,
      connectedAt: new Date().toISOString()
    });
    userSockets.set(userId || socket.id, socket.id);

    socket.emit('profile-updated', {
      status: 'ok',
      isVip: Boolean(isVip),
      chatMode: chatMode === 'text' ? 'text' : 'video'
    });
    io.emit('online-count', activeUsers.size);
  });

  socket.on('update-preferences', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && data) {
      if (data.myGender) user.myGender = data.myGender;
      if (data.lookingFor) user.lookingFor = data.lookingFor;
      if (data.age) user.age = parseInt(data.age, 10) || user.age;
      if (data.agePreference) user.agePreference = data.agePreference;
      if (Array.isArray(data.interests)) user.interests = data.interests;
      if (data.chatMode) user.chatMode = data.chatMode === 'text' ? 'text' : 'video';
      if (typeof data.isVip === 'boolean') user.isVip = data.isVip;

      socket.emit('profile-updated', {
        status: 'ok',
        myGender: user.myGender,
        lookingFor: user.lookingFor,
        age: user.age,
        agePreference: user.agePreference,
        interests: user.interests,
        chatMode: user.chatMode,
        isVip: user.isVip
      });
    }
  });

  socket.on('switch-mode', (newMode) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      leaveCurrentChat(socket.id, 'mode-switched');
      user.chatMode = newMode === 'text' ? 'text' : 'video';
      socket.emit('mode-changed', { chatMode: user.chatMode });
    }
  });

  socket.on('find-stranger', () => {
    leaveCurrentChat(socket.id, 'skipped');
    tryMatchUser(socket.id);
  });

  socket.on('skip', () => {
    leaveCurrentChat(socket.id, 'skipped');
    tryMatchUser(socket.id);
  });

  socket.on('stop-chat', () => {
    leaveCurrentChat(socket.id, 'stopped');
  });

  socket.on('send-message', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      io.to(user.partnerId).emit('receive-message', {
        text: data.text,
        sender: 'stranger',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  socket.on('typing', (isTyping) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      io.to(user.partnerId).emit('partner-typing', isTyping);
    }
  });

  // WebRTC Signaling (Active only in video mode)
  socket.on('webrtc-offer', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId && user.chatMode === 'video') {
      io.to(user.partnerId).emit('webrtc-offer', data);
    }
  });

  socket.on('webrtc-answer', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId && user.chatMode === 'video') {
      io.to(user.partnerId).emit('webrtc-answer', data);
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId && user.chatMode === 'video') {
      io.to(user.partnerId).emit('webrtc-ice-candidate', data);
    }
  });

  socket.on('block-user', () => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      const partner = activeUsers.get(user.partnerId);
      if (partner) {
        user.blockedUsers.add(partner.userId);
        partner.blockedUsers.add(user.userId);
        console.log(`[Safety] User ${user.userId} blocked user ${partner.userId}`);
      }
      leaveCurrentChat(socket.id, 'blocked');
      socket.emit('user-blocked-confirmation');
      tryMatchUser(socket.id);
    }
  });

  socket.on('report-user', ({ reason }) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      const partner = activeUsers.get(user.partnerId);
      const partnerUserId = partner ? partner.userId : 'unknown';

      const report = logReportEntry(user.userId, partnerUserId, reason || 'Inappropriate behavior');

      if (partner) {
        partner.reportCount += 1;
        user.blockedUsers.add(partner.userId);
        if (partner.reportCount >= 3) {
          const partnerSocket = io.sockets.sockets.get(user.partnerId);
          if (partnerSocket) {
            partnerSocket.emit('moderation-warning', {
              message: 'Your account has been temporarily restricted due to community reports.'
            });
            leaveCurrentChat(user.partnerId, 'banned');
          }
        }
      }

      leaveCurrentChat(socket.id, 'reported');
      socket.emit('report-submitted', { success: true });
      tryMatchUser(socket.id);
    }
  });

  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) userSockets.delete(user.userId);
    leaveCurrentChat(socket.id, 'disconnected');
    activeUsers.delete(socket.id);
    io.emit('online-count', activeUsers.size);
  });
});

function startServer(port) {
  server.listen(port, () => {
    console.log(`===============================================`);
    console.log(` Clay Chat Server running on http://localhost:${port}`);
    console.log(` Admin Dashboard: http://localhost:${port}/admin (Password: ${ADMIN_PASSWORD})`);
    console.log(` Webhook URL: http://localhost:${port}/api/gpay/webhook`);
    console.log(` Modes: Video Chat & Dedicated Text-Only Chat`);
    console.log(` Filters: Gender, Age & Common Interests Engine Ready`);
    console.log(` Payment: UPI VPA (${UROPAY_VPA}) - ₹${offersConfig.vipPrice}`);
    console.log(`===============================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port] Port ${port} is busy. Trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('[Server Error]', err);
    }
  });
}

startServer(DEFAULT_PORT);
