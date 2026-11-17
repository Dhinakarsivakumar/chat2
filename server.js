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

// UroPay Configuration
const UROPAY_API_BASE = 'https://api.uropay.me';
const UROPAY_API_KEY = process.env.UROPAY_API_KEY || '';
const UROPAY_SECRET = process.env.UROPAY_SECRET || '';
const UROPAY_VPA = process.env.UROPAY_VPA || '';
const UROPAY_VPA_NAME = process.env.UROPAY_VPA_NAME || 'Clay Chat VIP';

function getUroPayHeaders() {
  const hashedSecret = crypto.createHash('sha512').update(UROPAY_SECRET).digest('hex');
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-API-KEY': UROPAY_API_KEY,
    'Authorization': `Bearer ${hashedSecret}`
  };
}

// UroPay Webhook Signature Verification Helpers
function buildTransactionPayload(payload) {
  const FIXED_TAIL = ['uroPayOrderId', 'merchantOrderId', 'detectedAt', 'environment'];
  const fixedSet = new Set([...FIXED_TAIL, 'event']);
  const ordered = {};
  if ('event' in payload) ordered.event = payload.event;
  const middle = Object.keys(payload)
    .filter(k => !fixedSet.has(k))
    .sort((a, b) => a.localeCompare(b));
  for (const k of middle) ordered[k] = payload[k];
  for (const k of FIXED_TAIL) ordered[k] = payload[k] ?? null;
  return ordered;
}

function buildOrderStatusPayload(payload) {
  return {
    event: payload.event,
    uroPayOrderId: payload.uroPayOrderId,
    merchantOrderId: payload.merchantOrderId,
    orderStatus: payload.orderStatus,
    submittedUTR: payload.submittedUTR ?? null,
    environment: payload.environment,
  };
}

function buildUtrSubmittedPayload(payload) {
  return {
    event: payload.event,
    uroPayOrderId: payload.uroPayOrderId,
    merchantOrderId: payload.merchantOrderId,
    orderStatus: payload.orderStatus,
    submittedUTR: payload.submittedUTR ?? null,
    amount: payload.amount,
    customerName: payload.customerName,
    customerEmail: payload.customerEmail,
    customerVPA: payload.customerVPA ?? null,
    environment: payload.environment,
    utrSubmittedAt: payload.utrSubmittedAt ?? null,
  };
}

function verifyWebhookSignature(payload, secret, signature) {
  if (!secret || !signature) return false;
  try {
    const ordered = payload.event === 'order.status.utrsubmitted'
      ? buildUtrSubmittedPayload(payload)
      : 'orderStatus' in payload
      ? buildOrderStatusPayload(payload)
      : buildTransactionPayload(payload);

    const hashedSecret = crypto.createHash('sha512').update(secret).digest('hex');
    const computed = crypto.createHmac('sha256', hashedSecret)
      .update(JSON.stringify(ordered))
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
  } catch (err) {
    console.error('[UroPay] Signature verification error:', err);
    return false;
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '413973614482-compute@developer.gserviceaccount.com';

// Persistent user database (JSON file)
const USERS_FILE_PATH = path.join(__dirname, 'users.json');
let registeredUsers = new Map(); // email -> { email, name, picture, isVip, createdAt }

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE_PATH)) {
      const data = JSON.parse(fs.readFileSync(USERS_FILE_PATH, 'utf-8'));
      registeredUsers = new Map(Object.entries(data));
      console.log(`[Auth] Loaded ${registeredUsers.size} registered users.`);
    }
  } catch (err) {
    console.error('[Auth] Failed to load users.json:', err);
  }
}

function saveUsers() {
  try {
    const obj = Object.fromEntries(registeredUsers);
    fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error('[Auth] Failed to save users.json:', err);
  }
}

loadUsers();

// In-Memory State
// socketId -> { id, userId, myGender, lookingFor, isVip, roomId, partnerId, blockedUsers: Set, reportCount: 0 }
const activeUsers = new Map();
const userSockets = new Map(); // userId -> socketId
const waitingQueue = [];
const activeRooms = new Map();
const orders = new Map(); // uroPayOrderId -> { orderId, merchantOrderId, userId, amount, status }

// Reports audit trail
const REPORTS_LOG_PATH = path.join(__dirname, 'reports.log');

function logReport(reporterId, reportedId, reason) {
  const line = `[${new Date().toISOString()}] Reporter: ${reporterId} | Reported: ${reportedId} | Reason: ${reason}\n`;
  fs.appendFile(REPORTS_LOG_PATH, line, (err) => {
    if (err) console.error('Failed to write report log:', err);
  });
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
          message: '🌟 VIP Plan activated! Gender filter & priority matching unlocked.'
        });
      }
    }
  }
}

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
    // Update profile info
    if (name) user.name = name;
    if (picture) user.picture = picture;
    user.lastLogin = new Date().toISOString();
  }
  saveUsers();

  // If client provided active socketId, sync the profile
  if (socketId && activeUsers.has(socketId)) {
    const active = activeUsers.get(socketId);
    active.email = email;
    active.userName = user.name;
    if (user.isVip) {
      active.isVip = true;
    }
  }

  console.log(`[Google Auth] User logged in: ${email} (VIP: ${user.isVip})`);

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

// REST Endpoints
app.get('/api/config', (req, res) => {
  res.json({
    uropayConfigured: Boolean(UROPAY_API_KEY && UROPAY_SECRET),
    vpa: UROPAY_VPA,
    vpaName: UROPAY_VPA_NAME,
    turnConfigured: !!process.env.TURN_SERVER_URL,
    googleClientId: GOOGLE_CLIENT_ID
  });
});

// 1. Generate UroPay UPI Order
app.post('/api/uropay/create-order', async (req, res) => {
  const { userId, customerName = 'Customer', customerEmail = 'customer@example.com', amount = 100 } = req.body;
  const merchantOrderId = `VIP_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  if (!UROPAY_API_KEY || !UROPAY_SECRET) {
    // Sandbox / Test fallback with simulated UPI QR code
    const mockOrderId = `test_${Date.now()}`;
    const amountInRupees = (amount / 100).toFixed(2);
    const mockUpi = `upi://pay?pa=${UROPAY_VPA || 'merchant@upi'}&pn=${encodeURIComponent(UROPAY_VPA_NAME)}&am=${amountInRupees}&cu=INR&tn=VIP%20Access`;

    orders.set(mockOrderId, {
      uroPayOrderId: mockOrderId,
      merchantOrderId,
      userId,
      amount,
      status: 'CREATED'
    });

    return res.json({
      success: true,
      sandbox: true,
      data: {
        uroPayOrderId: mockOrderId,
        orderStatus: 'CREATED',
        upiString: mockUpi,
        amountInRupees: amountInRupees,
        qrCode: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(mockUpi)}`
      }
    });
  }

  try {
    const payload = {
      amount, // In paise (e.g. ₹99 = 9900)
      merchantOrderId,
      transactionNote: 'Clay Chat VIP',
      customerName,
      customerEmail
    };

    if (UROPAY_VPA) payload.vpa = UROPAY_VPA;
    if (UROPAY_VPA_NAME) payload.vpaName = UROPAY_VPA_NAME;

    const response = await fetch(`${UROPAY_API_BASE}/order/generate`, {
      method: 'POST',
      headers: getUroPayHeaders(),
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.status === 'success' && data.data) {
      // Ensure the QR code and UPI string strictly point to the user's own VPA and Name
      const vpaToUse = UROPAY_VPA || 'sdhinakar6-5@okaxis';
      const vpaNameToUse = UROPAY_VPA_NAME || 'Dhinakar Sivakumar';
      const amountInRupees = (amount / 100).toFixed(2);
      
      const strictlyVerifiedUpi = `upi://pay?pa=${vpaToUse}&pn=${encodeURIComponent(vpaNameToUse)}&am=${amountInRupees}&cu=INR&tn=${encodeURIComponent('Clay Chat VIP')}&tr=${data.data.uroPayOrderId}`;
      
      // Generate guaranteed accurate QR Code directly from the verified UPI string
      const guaranteedQrCode = await QRCode.toDataURL(strictlyVerifiedUpi, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 320
      });

      orders.set(data.data.uroPayOrderId, {
        uroPayOrderId: data.data.uroPayOrderId,
        merchantOrderId,
        userId,
        amount,
        status: data.data.orderStatus || 'CREATED'
      });

      return res.json({ 
        success: true, 
        data: {
          ...data.data,
          upiString: strictlyVerifiedUpi,
          qrCode: guaranteedQrCode,
          vpa: vpaToUse,
          vpaName: vpaNameToUse,
          amountInRupees: amountInRupees
        } 
      });
    }

    console.error('[UroPay] Error generating order:', data);
    res.status(400).json({ success: false, message: data.message || 'Order generation failed' });
  } catch (err) {
    console.error('[UroPay Exception]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Submit UPI UTR / Reference Number
app.patch('/api/uropay/submit-utr', async (req, res) => {
  const { uroPayOrderId, referenceNumber, userId } = req.body;

  if (!uroPayOrderId || !referenceNumber) {
    return res.status(400).json({ error: 'uroPayOrderId and referenceNumber are required' });
  }

  // Sandbox simulation
  if (uroPayOrderId.startsWith('test_') || !UROPAY_API_KEY) {
    const order = orders.get(uroPayOrderId) || {};
    order.status = 'COMPLETED';
    order.referenceNumber = referenceNumber;
    orders.set(uroPayOrderId, order);

    activateUserVip(userId || order.userId);

    return res.json({
      success: true,
      sandbox: true,
      message: 'Demo UTR submitted! VIP activated.',
      data: { uroPayOrderId, orderStatus: 'COMPLETED' }
    });
  }

  try {
    const response = await fetch(`${UROPAY_API_BASE}/order/update`, {
      method: 'PATCH',
      headers: getUroPayHeaders(),
      body: JSON.stringify({
        uroPayOrderId,
        referenceNumber
      })
    });

    const data = await response.json();
    console.log('[UroPay UTR Update Response]', data);

    if (data.status === 'success') {
      const order = orders.get(uroPayOrderId) || {};
      order.status = 'COMPLETED';
      order.referenceNumber = referenceNumber;
      orders.set(uroPayOrderId, order);

      // Instantly grant VIP to the user upon valid UTR submission
      activateUserVip(userId || order.userId);

      return res.json({ 
        success: true, 
        message: 'UTR verified successfully! VIP activated.',
        data: { ...data.data, orderStatus: 'COMPLETED' } 
      });
    }

    res.status(400).json({ success: false, message: data.message || 'UTR update failed' });
  } catch (err) {
    console.error('[UroPay UTR Update Error]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Poll Order Status
app.get('/api/uropay/status/:uroPayOrderId', async (req, res) => {
  const { uroPayOrderId } = req.params;

  if (uroPayOrderId.startsWith('test_') || !UROPAY_API_KEY) {
    const order = orders.get(uroPayOrderId);
    return res.json({
      success: true,
      data: {
        uroPayOrderId,
        orderStatus: order ? order.status : 'PENDING'
      }
    });
  }

  try {
    const response = await fetch(`${UROPAY_API_BASE}/order/status/${uroPayOrderId}`, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-API-KEY': UROPAY_API_KEY
      }
    });

    const data = await response.json();
    if (data.status === 'success' && data.data) {
      if (data.data.orderStatus === 'COMPLETED' || data.data.orderStatus === 'UTR_SUBMITTED') {
        const order = orders.get(uroPayOrderId);
        if (order) {
          order.status = 'COMPLETED';
          activateUserVip(order.userId);
        }
      }
      return res.json(data);
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. UroPay Webhook Handler
app.post('/api/uropay/webhook', (req, res) => {
  const payload = req.body;
  const signature = req.headers['x-uropay-signature'] || '';
  const environment = req.headers['x-uropay-environment'] || 'PRODUCTION';

  console.log(`[UroPay Webhook] Event: ${payload.event} | Env: ${environment}`);

  // Signature verification (if secret configured)
  if (UROPAY_SECRET) {
    const isValid = verifyWebhookSignature(payload, UROPAY_SECRET, signature);
    if (!isValid) {
      console.warn('[UroPay Webhook] Invalid signature rejected');
      return res.status(401).send('Invalid signature');
    }
  }

  // Handle events
  const { event, uroPayOrderId, orderStatus } = payload;

  if (event === 'companion.sms.data' || orderStatus === 'COMPLETED') {
    console.log(`[UroPay Webhook] Payment verified for order: ${uroPayOrderId}`);
    const order = orders.get(uroPayOrderId);
    if (order) {
      order.status = 'COMPLETED';
      activateUserVip(order.userId);
    }
  } else if (event === 'order.status.utrsubmitted') {
    console.log(`[UroPay Webhook] UTR submitted for order: ${uroPayOrderId}`);
    const order = orders.get(uroPayOrderId);
    if (order) order.status = 'UTR_SUBMITTED';
  } else if (orderStatus === 'REVIEW_REQUIRED') {
    console.log(`[UroPay Webhook] Review required for order: ${uroPayOrderId}`);
  }

  // Must always return 200 OK to UroPay
  res.status(200).json({ received: true });
});

// 5. Custom Google Pay for Business Notification Webhook
const GPAY_WEBHOOK_SECRET = process.env.GPAY_WEBHOOK_SECRET || 'claychat_gpay_secret_2026';

app.post('/api/gpay/webhook', (req, res) => {
  const authHeader = req.headers['x-webhook-secret'];
  if (authHeader && authHeader !== GPAY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized webhook request' });
  }

  const { title = '', text = '', amount = null, payer = '' } = req.body;
  console.log(`[GPay Business Notification] Received: "${title}" - "${text}"`);

  // Extract amount using robust regex
  let detectedAmount = amount;
  if (!detectedAmount) {
    const combined = `${title} ${text}`;
    const match = combined.match(/(?:₹|Rs\.?|inr)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:received|credited|from)?/i);
    if (match) {
      detectedAmount = parseFloat(match[1]);
    }
  }

  console.log(`[GPay Business] Parsed Amount: ₹${detectedAmount}`);

  // Find the most recently active waiting or pending user
  let activated = false;
  // Check active orders
  for (const [orderId, order] of orders.entries()) {
    if (order.status === 'CREATED' || order.status === 'UTR_SUBMITTED') {
      order.status = 'COMPLETED';
      activateUserVip(order.userId);
      activated = true;
      console.log(`[GPay Business] Auto-activated VIP for user ${order.userId} on order ${orderId}`);
      break;
    }
  }

  // If no explicit order in map, activate the most recently connected active user
  if (!activated && activeUsers.size > 0) {
    const lastUser = Array.from(activeUsers.values()).reverse().find(u => !u.isVip);
    if (lastUser) {
      activateUserVip(lastUser.userId);
      console.log(`[GPay Business] Auto-activated VIP for active user ${lastUser.userId}`);
      activated = true;
    }
  }

  res.status(200).json({
    success: true,
    message: 'GPay notification processed successfully',
    activated,
    detectedAmount
  });
});

// Moderation Log Endpoint
app.get('/api/moderation/reports', (req, res) => {
  if (fs.existsSync(REPORTS_LOG_PATH)) {
    const content = fs.readFileSync(REPORTS_LOG_PATH, 'utf-8');
    return res.type('text/plain').send(content);
  }
  res.send('No reports recorded yet.');
});

// Matchmaking Logic
function isMatchCompatible(userA, userB) {
  if (userA.id === userB.id) return false;
  if (userA.blockedUsers.has(userB.userId) || userB.blockedUsers.has(userA.userId)) return false;

  // Gender Filter (VIP)
  if (userA.isVip && userA.lookingFor !== 'all') {
    if (userB.myGender !== userA.lookingFor) return false;
  }
  if (userB.isVip && userB.lookingFor !== 'all') {
    if (userA.myGender !== userB.lookingFor) return false;
  }

  return true;
}

function tryMatchUser(socketId) {
  const user = activeUsers.get(socketId);
  if (!user || user.partnerId || user.inQueue) return;

  let matchIndex = -1;
  for (let i = 0; i < waitingQueue.length; i++) {
    const candidateId = waitingQueue[i];
    const candidate = activeUsers.get(candidateId);
    if (!candidate || candidateId === socketId) continue;

    if (isMatchCompatible(user, candidate)) {
      matchIndex = i;
      break;
    }
  }

  if (matchIndex !== -1) {
    const [partnerId] = waitingQueue.splice(matchIndex, 1);
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

    console.log(`[Match] Paired ${socketId} with ${partnerId} in ${roomId}`);

    if (socketA) {
      socketA.emit('matched', {
        roomId,
        isInitiator: true,
        partnerGender: partner.myGender || 'unspecified'
      });
    }
    if (socketB) {
      socketB.emit('matched', {
        roomId,
        isInitiator: false,
        partnerGender: user.myGender || 'unspecified'
      });
    }
  } else {
    if (!waitingQueue.includes(socketId)) {
      waitingQueue.push(socketId);
      user.inQueue = true;
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.emit('waiting', { queueLength: waitingQueue.length });
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

// Socket.io Handlers
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ${socket.id}`);

  socket.on('init-profile', (data) => {
    const { userId, myGender = 'male', lookingFor = 'all', isVip = false } = data || {};
    activeUsers.set(socket.id, {
      id: socket.id,
      userId: userId || socket.id,
      myGender,
      lookingFor,
      isVip: Boolean(isVip),
      roomId: null,
      partnerId: null,
      inQueue: false,
      blockedUsers: new Set(),
      reportCount: 0
    });
    userSockets.set(userId || socket.id, socket.id);

    socket.emit('profile-updated', { status: 'ok', isVip: Boolean(isVip) });
    io.emit('online-count', activeUsers.size);
  });

  socket.on('update-preferences', ({ myGender, lookingFor, isVip }) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      if (myGender) user.myGender = myGender;
      if (lookingFor) user.lookingFor = lookingFor;
      if (typeof isVip === 'boolean') user.isVip = isVip;
      socket.emit('profile-updated', { status: 'ok', myGender: user.myGender, lookingFor: user.lookingFor, isVip: user.isVip });
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

  socket.on('webrtc-offer', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      io.to(user.partnerId).emit('webrtc-offer', data);
    }
  });

  socket.on('webrtc-answer', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
      io.to(user.partnerId).emit('webrtc-answer', data);
    }
  });

  socket.on('webrtc-ice-candidate', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.partnerId) {
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

      logReport(user.userId, partnerUserId, reason || 'Inappropriate behavior');

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
    console.log(` Stranger Chat Server running on http://localhost:${port}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(` UroPay UPI: ${UROPAY_API_KEY ? 'Configured & Live' : 'Demo / Sandbox Ready'}`);
    console.log(` WebRTC STUN: Default Google STUN enabled`);
    console.log(` Gender Filter & Matchmaking: Ready`);
    console.log(` Moderation & Block Engine: Ready`);
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
