// Clay Chat Client Application
const socket = io();

// State
let chatMode = localStorage.getItem('clay_chat_mode') || 'video'; // 'video' | 'text'
let localStream = null;
let remoteStream = null;
let peerConnection = null;
let currentRoomId = null;
let isInitiator = false;
let isConnectedToPartner = false;
let isVip = false;
let myUserId = localStorage.getItem('clay_user_id') || ('user_' + Math.random().toString(36).substring(2, 9));
localStorage.setItem('clay_user_id', myUserId);
let typingTimeout = null;

// User Profile & Interests State
let myAge = parseInt(localStorage.getItem('clay_my_age'), 10) || 22;
let myInterests = [];
try {
  myInterests = JSON.parse(localStorage.getItem('clay_interests')) || ['Music', 'Movies'];
} catch (e) {
  myInterests = ['Music', 'Movies'];
}

// UroPay / GPay State
let currentUroPayOrderId = null;
let paymentPollInterval = null;
let currentOffers = null;

// DOM Elements
const mainContent = document.getElementById('mainContent');
const modeVideoBtn = document.getElementById('modeVideoBtn');
const modeTextBtn = document.getElementById('modeTextBtn');

const localVideoCard = document.getElementById('localVideoCard');
const localVideo = document.getElementById('localVideo');
const remoteVideoCard = document.getElementById('remoteVideoCard');
const remoteVideo = document.getElementById('remoteVideo');
const videoOverlay = document.getElementById('videoOverlay');
const overlayStatus = document.getElementById('overlayStatus');
const overlaySub = document.getElementById('overlaySub');
const loaderAnimation = document.getElementById('loaderAnimation');
const partnerBadge = document.getElementById('partnerBadge');
const partnerGenderTag = document.getElementById('partnerGenderTag');
const partnerAgeTag = document.getElementById('partnerAgeTag');

const onlineCountEl = document.getElementById('onlineCount');
const lookingForSelect = document.getElementById('lookingForSelect');
const agePreferenceSelect = document.getElementById('agePreferenceSelect');
const vipBadgeBtn = document.getElementById('vipBadgeBtn');
const vipBtnText = document.getElementById('vipBtnText');
const activeInterestsCount = document.getElementById('activeInterestsCount');
const openInterestsModalBtn = document.getElementById('openInterestsModalBtn');

const chatStatusDot = document.getElementById('chatStatusDot');
const chatStatusText = document.getElementById('chatStatusText');
const commonInterestsBanner = document.getElementById('commonInterestsBanner');
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

// Interests Modal Elements
const interestsModal = document.getElementById('interestsModal');
const myAgeInput = document.getElementById('myAgeInput');
const saveInterestsBtn = document.getElementById('saveInterestsBtn');

// Report Modal Elements
const reportModal = document.getElementById('reportModal');
const cancelReportBtn = document.getElementById('cancelReportBtn');
const confirmReportBtn = document.getElementById('confirmReportBtn');

// VIP Modal Elements
const vipModal = document.getElementById('vipModal');
const modalVipTitle = document.getElementById('modalVipTitle');
const modalVipDiscountText = document.getElementById('modalVipDiscountText');
const vipPriceDisplay = document.getElementById('vipPriceDisplay');
const vipPlanStep = document.getElementById('vipPlanStep');
const vipQrStep = document.getElementById('vipQrStep');
const closeVipModalBtn = document.getElementById('closeVipModalBtn');
const startUpiPayBtn = document.getElementById('startUpiPayBtn');
const backToPlansBtn = document.getElementById('backToPlansBtn');

const upiQrImage = document.getElementById('upiQrImage');
const upiAmountText = document.getElementById('upiAmountText');
const upiPayeeText = document.getElementById('upiPayeeText');
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

// ----------------------------------------------------
// Mode Switcher (Video vs Text Only)
// ----------------------------------------------------
function applyMode(mode) {
  chatMode = mode;
  localStorage.setItem('clay_chat_mode', mode);

  if (mode === 'text') {
    modeTextBtn.classList.add('active');
    modeVideoBtn.classList.remove('active');
    mainContent.classList.add('text-only-mode');

    // Close any camera/mic tracks to free hardware
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
      localVideo.srcObject = null;
    }
    overlayStatus.textContent = 'Text-Only Mode: Ready to chat';
    overlaySub.textContent = 'Camera & microphone are completely off.';
    setChatStatus('disconnected', 'Text Chat Mode');
  } else {
    modeVideoBtn.classList.add('active');
    modeTextBtn.classList.remove('active');
    mainContent.classList.remove('text-only-mode');

    // Request camera and microphone
    initMedia();
    overlayStatus.textContent = 'Video Mode: Click "Start Chat"';
    overlaySub.textContent = 'Encrypted 1-on-1 peer-to-peer connection';
    setChatStatus('disconnected', 'Video Chat Mode');
  }

  socket.emit('switch-mode', mode);
}

modeVideoBtn.addEventListener('click', () => applyMode('video'));
modeTextBtn.addEventListener('click', () => applyMode('text'));

// ----------------------------------------------------
// Media Initialization (Video Only)
// ----------------------------------------------------
async function initMedia() {
  if (chatMode !== 'video') return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: true
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn('Camera/Mic not detected:', err);
    appendSystemMessage('⚠️ Camera/Mic not detected or permission denied. You can switch to Text-Only mode anytime!');
  }
}

// ----------------------------------------------------
// Interests & Age Management
// ----------------------------------------------------
const interestsGrid = document.getElementById('interestsGrid');
const customInterestInput = document.getElementById('customInterestInput');
const addCustomInterestBtn = document.getElementById('addCustomInterestBtn');

function attachChipListener(chip) {
  chip.addEventListener('click', () => {
    const tag = chip.getAttribute('data-tag');
    if (myInterests.includes(tag)) {
      myInterests = myInterests.filter(t => t.toLowerCase() !== tag.toLowerCase());
      chip.classList.remove('selected');
    } else {
      myInterests.push(tag);
      chip.classList.add('selected');
    }
    if (activeInterestsCount) activeInterestsCount.textContent = myInterests.length;
  });
}

function updateInterestsUI() {
  if (activeInterestsCount) {
    activeInterestsCount.textContent = myInterests.length;
  }

  // Ensure any custom tags in myInterests are present as chips in the grid
  myInterests.forEach(tag => {
    let existingChip = Array.from(document.querySelectorAll('.interest-chip')).find(
      c => c.getAttribute('data-tag')?.toLowerCase() === tag.toLowerCase()
    );
    if (!existingChip && interestsGrid) {
      const newChip = document.createElement('button');
      newChip.type = 'button';
      newChip.className = 'interest-chip selected';
      newChip.setAttribute('data-tag', tag);
      newChip.textContent = `✨ ${tag}`;
      attachChipListener(newChip);
      interestsGrid.prepend(newChip);
    }
  });

  document.querySelectorAll('.interest-chip').forEach(chip => {
    const tag = chip.getAttribute('data-tag');
    if (myInterests.some(t => t.toLowerCase() === tag.toLowerCase())) {
      chip.classList.add('selected');
    } else {
      chip.classList.remove('selected');
    }
  });

  if (myAgeInput) myAgeInput.value = myAge;
}

function handleAddCustomInterest() {
  if (!customInterestInput) return;
  const tag = customInterestInput.value.trim();
  if (!tag) return;

  if (!myInterests.some(t => t.toLowerCase() === tag.toLowerCase())) {
    myInterests.push(tag);
  }

  let existingChip = Array.from(document.querySelectorAll('.interest-chip')).find(
    c => c.getAttribute('data-tag')?.toLowerCase() === tag.toLowerCase()
  );

  if (!existingChip && interestsGrid) {
    const newChip = document.createElement('button');
    newChip.type = 'button';
    newChip.className = 'interest-chip selected';
    newChip.setAttribute('data-tag', tag);
    newChip.textContent = `✨ ${tag}`;
    attachChipListener(newChip);
    interestsGrid.prepend(newChip);
  } else if (existingChip) {
    existingChip.classList.add('selected');
  }

  customInterestInput.value = '';
  if (activeInterestsCount) activeInterestsCount.textContent = myInterests.length;
}

if (addCustomInterestBtn) {
  addCustomInterestBtn.addEventListener('click', handleAddCustomInterest);
}

if (customInterestInput) {
  customInterestInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustomInterest();
    }
  });
}

openInterestsModalBtn.addEventListener('click', () => {
  updateInterestsUI();
  interestsModal.style.display = 'flex';
  if (customInterestInput) customInterestInput.focus();
});

document.querySelectorAll('.interest-chip').forEach(chip => {
  attachChipListener(chip);
});

saveInterestsBtn.addEventListener('click', () => {
  myAge = parseInt(myAgeInput.value, 10) || 22;
  localStorage.setItem('clay_my_age', myAge);
  localStorage.setItem('clay_interests', JSON.stringify(myInterests));
  interestsModal.style.display = 'none';

  socket.emit('update-preferences', {
    age: myAge,
    interests: myInterests,
    lookingFor: lookingForSelect.value,
    agePreference: agePreferenceSelect.value
  });
  appendSystemMessage(`🏷️ Preferences saved: Age ${myAge}, ${myInterests.length} Interests (${myInterests.join(', ')}).`);
});

// Close modal on click outside
interestsModal.addEventListener('click', (e) => {
  if (e.target === interestsModal) interestsModal.style.display = 'none';
});

// ----------------------------------------------------
// Dynamic Offers Fetching
// ----------------------------------------------------
function applyOffersUI(offers) {
  currentOffers = offers;
  if (vipPriceDisplay) vipPriceDisplay.textContent = `₹${offers.vipPrice}`;
  if (modalVipTitle) modalVipTitle.textContent = offers.title || 'Unlock VIP Membership';
  if (modalVipDiscountText) modalVipDiscountText.textContent = offers.discountText || 'Instant UPI Activation';

  const periodEl = document.querySelector('.pricing-card .price-period');
  if (periodEl) {
    const plan = (offers.planType || 'monthly').toUpperCase();
    const days = offers.durationDays || 30;
    periodEl.textContent = `/ ${plan} PASS (${days} Days Instant Access)`;
  }
}

async function fetchOffers() {
  try {
    const res = await fetch('/api/payment/offers');
    const d = await res.json();
    if (d.success && d.data) {
      applyOffersUI(d.data);
    }
  } catch (err) {
    console.warn('Could not fetch dynamic offers:', err);
  }
}

socket.on('offers-updated', (offers) => {
  applyOffersUI(offers);
});

// ----------------------------------------------------
// Socket Connection & Signaling
// ----------------------------------------------------
socket.on('connect', () => {
  console.log('Connected to signaling server with ID:', socket.id);
  socket.emit('init-profile', {
    userId: myUserId,
    myGender: 'male',
    lookingFor: lookingForSelect.value,
    age: myAge,
    agePreference: agePreferenceSelect.value,
    interests: myInterests,
    chatMode: chatMode,
    isVip: isVip
  });
});

socket.on('online-count', (count) => {
  onlineCountEl.textContent = count;
});

socket.on('vip-activated', (data) => {
  activateVip(data);
  vipModal.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
  appendSystemMessage('👑 ' + (data.message || 'VIP Plan Activated! Filters unlocked.'));
});

socket.on('vip-expired', (data) => {
  deactivateVip(data.message || '⏳ Your VIP subscription has expired.');
});

socket.on('waiting', () => {
  setChatStatus('waiting', 'Searching for a stranger...');
  if (chatMode === 'video') {
    videoOverlay.style.display = 'flex';
    loaderAnimation.style.display = 'block';
    overlayStatus.textContent = 'Searching for a match...';
    overlaySub.textContent = lookingForSelect.value !== 'all' 
      ? `Filter: ${lookingForSelect.value.toUpperCase()}`
      : 'Matching with random online users';
  }
  partnerBadge.style.display = 'none';
  safetyActions.style.display = 'none';
  commonInterestsBanner.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
  startBtnText.textContent = 'Skip';
  stopBtn.style.display = 'inline-block';
});

socket.on('matched', async (data) => {
  console.log('[Match] Paired with stranger:', data);
  currentRoomId = data.roomId;
  isInitiator = data.isInitiator;
  isConnectedToPartner = true;

  setChatStatus('connected', data.chatMode === 'text' ? '💬 Connected (Text Chat)' : '📹 Connected (Video Chat)');

  if (data.chatMode === 'video') {
    videoOverlay.style.display = 'none';
    loaderAnimation.style.display = 'none';
    partnerBadge.style.display = 'flex';
    partnerGenderTag.textContent = data.partnerGender || '';
    if (data.partnerAge) partnerAgeTag.textContent = `• Age ${data.partnerAge}`;
  }

  // Display Common Interests Banner
  if (data.commonInterests && data.commonInterests.length > 0) {
    commonInterestsBanner.style.display = 'inline-block';
    commonInterestsBanner.textContent = `🎯 Common: ${data.commonInterests.join(', ')}`;
  } else {
    commonInterestsBanner.style.display = 'none';
  }

  safetyActions.style.display = 'flex';
  messageInput.disabled = false;
  sendBtn.disabled = false;
  messageInput.focus();
  startBtnText.textContent = 'Next';
  stopBtn.style.display = 'inline-block';

  appendSystemMessage(`🎉 Connected with a stranger! ${data.commonInterests && data.commonInterests.length > 0 ? `Both of you like: <strong>${data.commonInterests.join(', ')}</strong>!` : 'Say hello!'}`);

  // Only start WebRTC if in video mode
  if (data.chatMode === 'video') {
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
  }
});

socket.on('partner-left', (data) => {
  handlePartnerDisconnect(data.reason);
});

function handlePartnerDisconnect(reason) {
  isConnectedToPartner = false;
  closePeerConnection();
  setChatStatus('disconnected', 'Stranger disconnected');
  if (chatMode === 'video') {
    videoOverlay.style.display = 'flex';
    loaderAnimation.style.display = 'none';
    overlayStatus.textContent = 'Stranger disconnected';
    overlaySub.textContent = 'Click "Next" to meet someone new';
  }
  partnerBadge.style.display = 'none';
  safetyActions.style.display = 'none';
  commonInterestsBanner.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
  startBtnText.textContent = 'New Chat';
  appendSystemMessage('⚠️ Stranger has disconnected.');
}

// ----------------------------------------------------
// WebRTC Signaling
// ----------------------------------------------------
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
  if (chatMode !== 'video') return;
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
  if (chatMode !== 'video') return;
  try {
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  } catch (err) {
    console.error('Error handling answer:', err);
  }
});

socket.on('webrtc-ice-candidate', async (candidate) => {
  if (chatMode !== 'video') return;
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

// ----------------------------------------------------
// Text Messaging
// ----------------------------------------------------
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
    <div style="font-size: 0.68rem; opacity: 0.7; text-align: right; margin-top: 3px;">${displayTime}</div>
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

// ----------------------------------------------------
// User Actions: Start / Next / Stop
// ----------------------------------------------------
startNextBtn.addEventListener('click', triggerNext);

function triggerNext() {
  closePeerConnection();
  socket.emit('find-stranger');
}

stopBtn.addEventListener('click', () => {
  closePeerConnection();
  socket.emit('stop-chat');
  setChatStatus('disconnected', 'Disconnected');
  if (chatMode === 'video') {
    videoOverlay.style.display = 'flex';
    loaderAnimation.style.display = 'none';
    overlayStatus.textContent = 'Chat stopped';
    overlaySub.textContent = 'Click "Start Chat" to find a new stranger';
  }
  startBtnText.textContent = 'Start Chat';
  stopBtn.style.display = 'none';
  safetyActions.style.display = 'none';
  commonInterestsBanner.style.display = 'none';
  messageInput.disabled = true;
  sendBtn.disabled = true;
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') triggerNext();
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

// Filters changes
lookingForSelect.addEventListener('change', () => {
  if (lookingForSelect.value !== 'all' && !isVip) {
    openVipModal();
    lookingForSelect.value = 'all';
  } else {
    socket.emit('update-preferences', { lookingFor: lookingForSelect.value });
  }
});

agePreferenceSelect.addEventListener('change', () => {
  if (agePreferenceSelect.value !== 'all' && !isVip) {
    openVipModal();
    agePreferenceSelect.value = 'all';
  } else {
    socket.emit('update-preferences', { agePreference: agePreferenceSelect.value });
  }
});

// Safety: Block User
blockBtn.addEventListener('click', () => {
  if (confirm('Block this user? You will never be matched with them again.')) {
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

// Moderation Warning from Server
socket.on('moderation-warning', (data) => {
  alert(data.message || 'Account restricted by moderation.');
});

// ----------------------------------------------------
// VIP Subscription & Payment Flow (₹20 UPI VPA LIGHT.LTD)
// ----------------------------------------------------
function openVipModal() {
  vipPlanStep.style.display = 'block';
  vipQrStep.style.display = 'none';
  vipModal.style.display = 'flex';
}

vipBadgeBtn.addEventListener('click', openVipModal);

closeVipModalBtn.addEventListener('click', () => {
  vipModal.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
});

backToPlansBtn.addEventListener('click', () => {
  vipPlanStep.style.display = 'block';
  vipQrStep.style.display = 'none';
  if (paymentPollInterval) clearInterval(paymentPollInterval);
});

startUpiPayBtn.addEventListener('click', async () => {
  try {
    startUpiPayBtn.textContent = 'Generating QR...';
    startUpiPayBtn.disabled = true;

    const price = currentOffers ? currentOffers.vipPrice : 20;

    const res = await fetch('/api/uropay/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: myUserId,
        amount: price * 100, // paise
        customerName: 'Clay Chat Member',
        customerEmail: 'member@claychat.app'
      })
    });

    const result = await res.json();
    if (result.success && result.data) {
      const { qrCodeBase64, paymentLink, amountRupees, uroPayOrderId, vpa, vpaName } = result.data;
      currentUroPayOrderId = uroPayOrderId;

      upiQrImage.src = qrCodeBase64;
      upiAmountText.textContent = `₹${amountRupees}`;
      upiIntentBtn.href = paymentLink;

      if (upiPayeeText && vpa) {
        upiPayeeText.textContent = `${vpaName || 'LIGHT.LTD'} (${vpa})`;
      }

      vipPlanStep.style.display = 'none';
      vipQrStep.style.display = 'block';
      utrStatusMsg.textContent = 'Scan QR & pay. Auto-activated on GPay confirmation, or enter UTR.';
      utrStatusMsg.style.color = 'var(--text-muted)';

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

submitUtrBtn.addEventListener('click', async () => {
  const utr = utrInput.value.trim();
  if (!utr || utr.length < 6) {
    alert('Please enter a valid UPI Reference / UTR Number.');
    return;
  }

  submitUtrBtn.textContent = 'Verifying...';
  submitUtrBtn.disabled = true;

  try {
    const res = await fetch('/api/uropay/submit-utr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uroPayOrderId: currentUroPayOrderId,
        utr: utr,
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

function startStatusPolling(orderId) {
  if (paymentPollInterval) clearInterval(paymentPollInterval);

  paymentPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/uropay/status/${orderId}`);
      const data = await res.json();
      if (data.data && data.data.orderStatus === 'COMPLETED') {
        clearInterval(paymentPollInterval);
        activateVip();
        vipModal.style.display = 'none';
        alert('🎉 Payment confirmed! VIP Membership Activated!');
      }
    } catch (e) {
      console.warn('Poll error:', e);
    }
  }, 3500);
}

function activateVip(data = {}) {
  isVip = true;
  try {
    localStorage.setItem('clay_is_vip', 'true');
    if (data.vipExpiresAt) localStorage.setItem('clay_vip_expires_at', data.vipExpiresAt);
    if (data.planType) localStorage.setItem('clay_vip_plan_type', data.planType);
  } catch(e){}

  vipBadgeBtn.classList.add('active');
  const planTag = data.planType ? `${data.planType.toUpperCase()} ` : '';
  vipBtnText.textContent = `${planTag}VIP Active ⭐`;
  socket.emit('update-preferences', { isVip: true });

  const femaleOpt = lookingForSelect.querySelector('option[value="female"]');
  const maleOpt = lookingForSelect.querySelector('option[value="male"]');
  if (femaleOpt) femaleOpt.textContent = 'Female ♀ (Unlocked ⭐)';
  if (maleOpt) maleOpt.textContent = 'Male ♂ (Unlocked ⭐)';
}

function deactivateVip(message = null) {
  isVip = false;
  try {
    localStorage.removeItem('clay_is_vip');
    localStorage.removeItem('stranger_is_vip');
    localStorage.removeItem('clay_vip_expires_at');
    localStorage.removeItem('clay_vip_plan_type');
  } catch(e){}

  vipBadgeBtn.classList.remove('active');
  vipBtnText.textContent = 'Upgrade VIP';
  lookingForSelect.value = 'all';
  agePreferenceSelect.value = 'all';
  socket.emit('update-preferences', { isVip: false, lookingFor: 'all', agePreference: 'all' });

  const femaleOpt = lookingForSelect.querySelector('option[value="female"]');
  const maleOpt = lookingForSelect.querySelector('option[value="male"]');
  if (femaleOpt) femaleOpt.textContent = 'Female ♀ (VIP ⭐)';
  if (maleOpt) maleOpt.textContent = 'Male ♂ (VIP ⭐)';

  if (message) {
    appendSystemMessage(`⚠️ ${message}`);
    alert(message);
  }
}

// Check saved VIP expiration on boot
const savedVipExpiry = localStorage.getItem('clay_vip_expires_at');
if (savedVipExpiry && new Date(savedVipExpiry).getTime() <= Date.now()) {
  deactivateVip();
} else if (localStorage.getItem('clay_is_vip') === 'true') {
  activateVip({
    planType: localStorage.getItem('clay_vip_plan_type') || 'monthly',
    vipExpiresAt: savedVipExpiry
  });
}

// ----------------------------------------------------
// Google Authentication
// ----------------------------------------------------
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
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
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

    if (window.google && clientId) {
      google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleLoginResponse,
        auto_select: false
      });

      if (googleSignInBtn) {
        google.accounts.id.renderButton(
          googleSignInBtn,
          { theme: 'outline', size: 'small', shape: 'pill', text: 'signin' }
        );
      }
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

  if (user.isVip) activateVip();
  appendSystemMessage(`👋 Signed in as ${user.name || user.email}!`);
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('clay_google_user');
    currentGoogleUser = null;
    if (googleSignInBtn) googleSignInBtn.style.display = 'block';
    if (userProfileBadge) userProfileBadge.style.display = 'none';
    if (window.google) google.accounts.id.disableAutoSelect();
    appendSystemMessage('Signed out of Google.');
  });
}

const savedGoogleUser = localStorage.getItem('clay_google_user');
if (savedGoogleUser) {
  try {
    applyUserProfile(JSON.parse(savedGoogleUser));
  } catch(e){}
}

// ----------------------------------------------------
// App Boot
// ----------------------------------------------------
window.addEventListener('load', () => {
  fetchOffers();
  updateInterestsUI();
  applyMode(chatMode);
  setTimeout(initGoogleAuth, 600);
});
