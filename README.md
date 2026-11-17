# Clay Chat - Real-Time Stranger Video & Chat Platform

A complete, production-ready anonymous 1-on-1 stranger video and text chatting application featuring real-time matchmaking, WebRTC P2P streaming, gender filtering, blocking/reporting moderation, and UroPay UPI subscription payments.

---

## 🌟 Key Features

1. **Random Matchmaking Queue Engine**
   - Instant 1-on-1 random pairing using Socket.io FIFO matching.
   - Prevents immediate rematches and filters out blocked connections.
   - Quick "Next" stranger skip (with keyboard shortcut `Esc`).

2. **WebRTC Live Video & Audio**
   - High-definition P2P audio/video streaming via `RTCPeerConnection`.
   - Integrated with Google public STUN servers for NAT traversal.
   - Camera and microphone toggle controls with Picture-in-Picture (PiP) local preview.

3. **Real-Time Anonymous Text Chat**
   - Low-latency chat messaging with timestamps.
   - Live stranger typing indicators.

4. **Gender Filter Matchmaking**
   - Users can select their gender and filter target matches (e.g. match with Female or Male).
   - Integrated as a premium VIP perk to maximize subscription conversions.

5. **Safety, Moderation & Anti-Abuse**
   - **One-click Block**: Prevents two users from ever being matched together again.
   - **Report System**: Built-in reporting reasons (NSFW/nudity, harassment, spam, underage).
   - **Auto-Ban / Suspension**: Automatically disconnects bad actors upon receiving repeated reports.
   - **Audit Trail**: Logs all reports into `reports.log`.

6. **UPI Payment & VIP Subscription (UroPay)**
   - Direct UPI payment integration with dynamic QR codes and intent links (GPay, PhonePe, Paytm).
   - 12-digit UTR verification.
   - Automatic webhook handling (`/api/uropay/webhook`) with HMAC-SHA256 signature verification.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment & API Keys
Copy `.env.example` to `.env` and fill in your keys:
```env
PORT=5000
NODE_ENV=production

# UroPay Direct UPI Payment Gateway
UROPAY_API_KEY=your_uropay_api_key
UROPAY_SECRET=your_uropay_secret
UROPAY_VPA=your_upi_vpa@upi
UROPAY_VPA_NAME=Clay Chat VIP
```

### 3. Run the Server
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:5000
```
