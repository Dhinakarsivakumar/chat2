// StrangerLive Client Application
const socket = io();

// State
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentRoomId = null;
let isInitiator = false;
let isConnectedToPartner = false;
let isVip = false;
let myUserId = 'user_' + Math.random().toString(36).substring(2, 9);
let typingTimeout = null;

// UroPay State
let currentUroPayOrderId = null;
let paymentPollInterval = null;

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const videoOverlay = document.getElementById('videoOverlay');
const overlayStatus = document.getElementById('overlayStatus');
const overlaySub = document.getElementById('overlaySub');
const loaderAnimation = document.getElementById('loaderAnimation');
const partnerBadge = document.getElementById('partnerBadge');
const partnerGenderTag = document.getElementById('partnerGenderTag');

const onlineCountEl = document.getElementById('onlineCount');
const myGenderSelect = document.getElementById('myGenderSelect');
const lookingForSelect = document.getElementById('lookingForSelect');
const vipBadgeBtn = document.getElementById('vipBadgeBtn');
const vipBtnText = document.getElementById('vipBtnText');

const chatStatusDot = document.getElementById('chatStatusDot');
const chatStatusText = document.getElementById('chatStatusText');
const safetyActions = document.getElementById('safetyActions');
const messagesContainer = document.getElementById('messagesContainer');
const typingIndicator = document.getElementById('typingIndicator');
const chatForm = document.getElementById('chatForm');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const startNextBtn = document.getElementById('startNextBtn');
const startBtnText = document.getElementById('startBtnText');
const stopBtn = document.getElementById('stopBtn');

const toggleCamBtn = document.getElementById('toggleCamBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const blockBtn = document.getElementById('blockBtn');
const reportBtn = document.getElementById('reportBtn');

const reportModal = document.getElementById('reportModal');
const cancelReportBtn = document.getElementById('cancelReportBtn');
const confirmReportBtn = document.getElementById('confirmReportBtn');

const vipModal = document.getElementById('vipModal');
const vipPlanStep = document.getElementById('vipPlanStep');
const vipQrStep = document.getElementById('vipQrStep');
const closeVipModalBtn = document.getElementById('closeVipModalBtn');
const startUpiPayBtn = document.getElementById('startUpiPayBtn');
const backToPlansBtn = document.getElementById('backToPlansBtn');

const upiQrImage = document.getElementById('upiQrImage');
const upiAmountText = document.getElementById('upiAmountText');
const upiIntentBtn = document.getElementById('upiIntentBtn');
const utrInput = document.getElementById('utrInput');
const submitUtrBtn = document.getElementById('submitUtrBtn');
const utrStatusMsg = document.getElementById('utrStatusMsg');

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Initialize Media
async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('Camera/Mic not detected:', err);
    appendSystemMessage('Camera/Mic permission not granted. You can still use text chat!');
  }
}

// Socket Connection & Registration
socket.on('connect', () => {
  console.log('Connected to signaling server with ID:', socket.id);
  socket.emit('init-profile', {
    userId: myUserId,
    myGender: myGenderSelect.value,
    lookingFor: lookingForSelect.value,
    isVip: isVip
  });
});

socket.on('online-count', (count) => {
  onlineCountEl.textContent = count;
});

// VIP Activation via Webhook or Polling
socket.on('vip-activated', (data) => {
  activateVip();
  vipModal.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
  appendSystemMessage('👑 ' + (data.message || 'VIP Plan Activated! You now have Gender Filter access.'));
});

// Matchmaking Events
socket.on('waiting', () => {
  setChatStatus('searching', 'Searching for a stranger...');
  videoOverlay.style.display = 'flex';
  loaderAnimation.style.display = 'block';
  overlayStatus.textContent = 'Looking for someone to chat with...';
  overlaySub.textContent = lookingForSelect.value !== 'all' 
    ? `Applying filter: ${lookingForSelect.value.toUpperCase()}`
    : 'Matching with random online users';
  partnerBadge.style.display = 'none';
  safetyActions.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
  startBtnText.textContent = 'Skip';
  stopBtn.style.display = 'inline-block';
});

socket.on('matched', async (data) => {
  console.log('[Match] Connected to stranger:', data);
  currentRoomId = data.roomId;
  isInitiator = data.isInitiator;
  isConnectedToPartner = true;

  setChatStatus('connected', 'Connected with a Stranger!');
  videoOverlay.style.display = 'none';
  loaderAnimation.style.display = 'none';
  partnerBadge.style.display = 'flex';
  partnerGenderTag.textContent = data.partnerGender;
  safetyActions.style.display = 'flex';
  messageInput.disabled = false;
  sendBtn.disabled = false;
  startBtnText.textContent = 'Next';
  stopBtn.style.display = 'inline-block';

  appendSystemMessage("🎉 You're now connected with a stranger! Say hello.");

  await setupPeerConnection();

  if (isInitiator) {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('webrtc-offer', offer);
    } catch (err) {
      console.error('Error creating offer:', err);
    }
  }
});

socket.on('partner-left', (data) => {
  handlePartnerDisconnect(data.reason);
});

function handlePartnerDisconnect(reason) {
  isConnectedToPartner = false;
  closePeerConnection();
  setChatStatus('disconnected', 'Stranger has disconnected');
  videoOverlay.style.display = 'flex';
  loaderAnimation.style.display = 'none';
  overlayStatus.textContent = 'Stranger disconnected';
  overlaySub.textContent = 'Click "Next" to meet someone new';
  partnerBadge.style.display = 'none';
  safetyActions.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
  startBtnText.textContent = 'New Chat';
  appendSystemMessage('⚠️ Stranger has disconnected.');
}

// WebRTC Signaling
async function setupPeerConnection() {
  closePeerConnection();

  peerConnection = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    if (!remoteStream) {
      remoteStream = new MediaStream();
      remoteVideo.srcObject = remoteStream;
    }
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('webrtc-ice-candidate', event.candidate);
    }
  };
}

socket.on('webrtc-offer', async (offer) => {
  if (!peerConnection) await setupPeerConnection();
  try {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('webrtc-answer', answer);
  } catch (err) {
    console.error('Error handling offer:', err);
  }
});

socket.on('webrtc-answer', async (answer) => {
  try {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  } catch (err) {
    console.error('Error handling answer:', err);
  }
});

socket.on('webrtc-ice-candidate', async (candidate) => {
  try {
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) {
    console.error('Error adding ICE candidate:', err);
  }
});

function closePeerConnection() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject.getTracks().forEach(track => track.stop());
    remoteVideo.srcObject = null;
  }
  remoteStream = null;
}

// Text Messaging
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !isConnectedToPartner) return;

  appendMessage('You', text, 'you');
  socket.emit('send-message', { text });
  messageInput.value = '';
  socket.emit('typing', false);
});

socket.on('receive-message', (data) => {
  appendMessage('Stranger', data.text, 'stranger', data.timestamp);
});

// Typing indicator
messageInput.addEventListener('input', () => {
  if (!isConnectedToPartner) return;
  socket.emit('typing', true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', false);
  }, 1200);
});

socket.on('partner-typing', (isTyping) => {
  typingIndicator.style.display = isTyping ? 'block' : 'none';
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

function appendMessage(sender, text, type, time = null) {
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${type}`;
  const displayTime = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  bubble.innerHTML = `
    <div>${escapeHtml(text)}</div>
    <div class="msg-meta">${displayTime}</div>
  `;
  messagesContainer.appendChild(bubble);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function appendSystemMessage(text) {
  const sysMsg = document.createElement('div');
  sysMsg.className = 'system-message';
  sysMsg.innerHTML = `<p>${text}</p>`;
  messagesContainer.appendChild(sysMsg);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(string) {
  const div = document.createElement('div');
  div.innerText = string;
  return div.innerHTML;
}

function setChatStatus(state, text) {
  chatStatusDot.className = `status-indicator ${state}`;
  chatStatusText.textContent = text;
}

// User Actions: Start / Next / Stop
startNextBtn.addEventListener('click', () => {
  triggerNext();
});

function triggerNext() {
  closePeerConnection();
  socket.emit('find-stranger');
}

stopBtn.addEventListener('click', () => {
  closePeerConnection();
  socket.emit('stop-chat');
  setChatStatus('disconnected', 'Disconnected');
  videoOverlay.style.display = 'flex';
  loaderAnimation.style.display = 'none';
  overlayStatus.textContent = 'Chat stopped';
  overlaySub.textContent = 'Click "Start Chat" to find a new stranger';
  startBtnText.textContent = 'Start Chat';
  stopBtn.style.display = 'none';
  safetyActions.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
});

// Keyboard Shortcut: Esc to Skip/Next
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    triggerNext();
  }
});

// Media Controls: Cam & Mic
toggleCamBtn.addEventListener('click', () => {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleCamBtn.textContent = videoTrack.enabled ? '📹' : '🚫';
    }
  }
});

toggleMicBtn.addEventListener('click', () => {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleMicBtn.textContent = audioTrack.enabled ? '🎙️' : '🔇';
    }
  }
});

// Preferences change
myGenderSelect.addEventListener('change', () => {
  socket.emit('update-preferences', { myGender: myGenderSelect.value });
});

lookingForSelect.addEventListener('change', () => {
  if (lookingForSelect.value !== 'all' && !isVip) {
    openVipModal();
    lookingForSelect.value = 'all'; // reset until upgraded
  } else {
    socket.emit('update-preferences', { lookingFor: lookingForSelect.value });
  }
});

// Safety: Block User
blockBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to block this user? You will never be matched with them again.')) {
    socket.emit('block-user');
    appendSystemMessage('🚫 You blocked this user. Finding someone else...');
  }
});

// Safety: Report User
reportBtn.addEventListener('click', () => {
  reportModal.style.display = 'flex';
});

cancelReportBtn.addEventListener('click', () => {
  reportModal.style.display = 'none';
});

confirmReportBtn.addEventListener('click', () => {
  const selectedReason = document.querySelector('input[name="reportReason"]:checked')?.value;
  socket.emit('report-user', { reason: selectedReason });
  reportModal.style.display = 'none';
  appendSystemMessage(`🚨 Report submitted for "${selectedReason}". User blocked.`);
});

// VIP / UroPay Modal Logic
function openVipModal() {
  vipPlanStep.style.display = 'block';
  vipQrStep.style.display = 'none';
  vipModal.style.display = 'flex';
}

vipBadgeBtn.addEventListener('click', () => {
  openVipModal();
});

closeVipModalBtn.addEventListener('click', () => {
  vipModal.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
});

backToPlansBtn.addEventListener('click', () => {
  vipPlanStep.style.display = 'block';
  vipQrStep.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
});

// 1. Generate Order & Display QR
startUpiPayBtn.addEventListener('click', async () => {
  try {
    startUpiPayBtn.textContent = 'Generating QR...';
    startUpiPayBtn.disabled = true;

    const res = await fetch('/api/uropay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: myUserId,
        amount: 100, // ₹1 (100 paise)
        customerName: 'Clay Chat User',
        customerEmail: 'user@claychat.app'
      })
    });

    const result = await res.json();
    if (result.success && result.data) {
      const { qrCode, upiString, amountInRupees, uroPayOrderId, vpa, vpaName } = result.data;
      currentUroPayOrderId = uroPayOrderId;

      upiQrImage.src = qrCode;
      upiAmountText.textContent = `₹${amountInRupees}`;
      upiIntentBtn.href = upiString;

      const payeeEl = document.getElementById('upiPayeeText');
      if (payeeEl && vpa) {
        payeeEl.textContent = `${vpaName || 'Dhinakar Sivakumar'} (${vpa})`;
      }

      vipPlanStep.style.display = 'none';
      vipQrStep.style.display = 'block';
      utrStatusMsg.textContent = 'Scan QR & pay. Then enter the 12-digit UTR below.';
      utrStatusMsg.style.color = 'var(--text-muted)';

      // Start automatic polling every 3.5 seconds
      startStatusPolling(uroPayOrderId);
    } else {
      alert(result.message || 'Could not generate UPI order.');
    }
  } catch (err) {
    console.error('Error generating order:', err);
    alert('Failed to connect to payment service.');
  } finally {
    startUpiPayBtn.textContent = '⚡ Pay with UPI / QR';
    startUpiPayBtn.disabled = false;
  }
});

// 2. Submit UTR / Reference Number
submitUtrBtn.addEventListener('click', async () => {
  const utr = utrInput.value.trim();
  if (!utr || utr.length < 8) {
    alert('Please enter a valid 12-digit UPI Reference / UTR Number.');
    return;
  }

  submitUtrBtn.textContent = 'Verifying...';
  submitUtrBtn.disabled = true;

  try {
    const res = await fetch('/api/uropay/submit-utr', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uroPayOrderId: currentUroPayOrderId,
        referenceNumber: utr,
        userId: myUserId
      })
    });

    const result = await res.json();
    if (result.success) {
      activateVip();
      vipModal.style.display = 'none';
      if (paymentPollInterval) clearInterval(paymentPollInterval);
      alert('🎉 VIP Membership activated successfully!');
    } else {
      utrStatusMsg.textContent = '⚠️ ' + (result.message || 'Failed to submit UTR');
      utrStatusMsg.style.color = 'var(--danger)';
    }
  } catch (err) {
    console.error('Error submitting UTR:', err);
  } finally {
    submitUtrBtn.textContent = 'Verify UTR';
    submitUtrBtn.disabled = false;
  }
});

// 3. Poll Status
function startStatusPolling(orderId) {
  if (paymentPollInterval) clearInterval(paymentPollInterval);

  paymentPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/uropay/status/${orderId}`);
      const data = await res.json();
      if (data.data && (data.data.orderStatus === 'COMPLETED' || data.data.orderStatus === 'UTR_SUBMITTED')) {
        clearInterval(paymentPollInterval);
        activateVip();
        vipModal.style.display = 'none';
        alert('🎉 Payment verified! VIP Membership Activated!');
      }
    } catch (e) {
      console.warn('Poll error:', e);
    }
  }, 3500);
}

function activateVip() {
  isVip = true;
  try { localStorage.setItem('stranger_is_vip', 'true'); } catch(e){}
  vipBadgeBtn.classList.add('active');
  vipBtnText.textContent = 'VIP Active';
  socket.emit('update-preferences', { isVip: true });

  const femaleOpt = lookingForSelect.querySelector('option[value="female"]');
  const maleOpt = lookingForSelect.querySelector('option[value="male"]');
  if (femaleOpt) femaleOpt.textContent = 'Female ♀ (Unlocked ⭐)';
  if (maleOpt) maleOpt.textContent = 'Male ♂ (Unlocked ⭐)';
}

// Restore VIP from localStorage if previously activated
if (localStorage.getItem('stranger_is_vip') === 'true') {
  activateVip();
}

// Google Authentication
let currentGoogleUser = null;
const googleSignInBtn = document.getElementById('googleSignInBtn');
const userProfileBadge = document.getElementById('userProfileBadge');
const userAvatarImg = document.getElementById('userAvatarImg');
const userProfileName = document.getElementById('userProfileName');
const logoutBtn = document.getElementById('logoutBtn');

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch(e) {
    return null;
  }
}

async function initGoogleAuth() {
  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const clientId = config.googleClientId;

    if (window.google && clientId && googleSignInBtn) {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleLoginResponse,
        auto_select: false
      });

      google.accounts.id.renderButton(
        googleSignInBtn,
        { theme: 'outline', size: 'medium', shape: 'pill', text: 'signin_with' }
      );
    }
  } catch (err) {
    console.warn('Google Auth init error:', err);
  }
}

async function handleGoogleLoginResponse(response) {
  const profile = parseJwt(response.credential);
  if (!profile) return;

  try {
    const res = await fetch('/api/auth/google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: profile.email,
        name: profile.name,
        picture: profile.picture,
        sub: profile.sub,
        socketId: socket.id
      })
    });
    const data = await res.json();
    if (data.success && data.user) {
      applyUserProfile(data.user);
    }
  } catch (err) {
    console.error('Google login backend sync failed:', err);
  }
}

function applyUserProfile(user) {
  currentGoogleUser = user;
  localStorage.setItem('clay_google_user', JSON.stringify(user));
  if (googleSignInBtn) googleSignInBtn.style.display = 'none';
  if (userProfileBadge) userProfileBadge.style.display = 'flex';
  if (userAvatarImg) userAvatarImg.src = user.picture || 'https://www.gravatar.com/avatar/?d=mp';
  if (userProfileName) userProfileName.textContent = user.name || user.email;

  if (user.isVip) {
    activateVip();
  }
  appendSystemMessage(`👋 Signed in as ${user.name || user.email}!`);
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('clay_google_user');
    currentGoogleUser = null;
    if (googleSignInBtn) googleSignInBtn.style.display = 'block';
    if (userProfileBadge) userProfileBadge.style.display = 'none';
    if (window.google) {
      google.accounts.id.disableAutoSelect();
    }
    appendSystemMessage('Signed out of Google.');
  });
}

// Restore saved user if any
const savedGoogleUser = localStorage.getItem('clay_google_user');
if (savedGoogleUser) {
  try {
    applyUserProfile(JSON.parse(savedGoogleUser));
  } catch(e){}
}

// Call initGoogleAuth when window loads
window.addEventListener('load', () => {
  setTimeout(initGoogleAuth, 600);
});

// Start Media on page load
initMedia();
