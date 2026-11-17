# Clay Chat - Google Pay for Business Webhook Companion

This companion system listens for incoming Google Pay for Business payment notifications and instantly triggers the Clay Chat webhook to activate VIP status for the customer.

---

## ⚡ Option 1: 60-Second Instant Setup on your Phone (Recommended)

You don't even need to compile code! You can use **MacroDroid** or **Notification Forwarder** (free from Google Play Store):

### Steps using MacroDroid:
1. Install **MacroDroid** from Play Store.
2. Click **Add Macro**:
   - **Trigger**: `Notification` -> `Notification Received` -> Select **Google Pay for Business** app (Contains text: `Received` or `₹`).
   - **Action**: `Connectivity` -> `HTTP Request`:
     - Method: **POST**
     - URL: `https://fluffy-worms-shave.loca.lt/api/gpay/webhook` (or your Google Cloud Run URL)
     - Content Type: `application/json`
     - Request Body:
       ```json
       {
         "title": "[notification_title]",
         "text": "[notification_text]"
       }
       ```
     - Headers:
       - `X-Webhook-Secret`: `claychat_gpay_secret_2026`
3. Click Save & Turn On!
4. **Done!** Whenever someone pays you on Google Pay for Business, your phone automatically calls your server webhook in milliseconds!

---

## 🛠️ Option 2: Build Custom Android APK

The complete Kotlin source code is provided in this directory:
- `AndroidManifest.xml`
- `GPayNotificationService.kt`
- `MainActivity.kt`

Open this folder in Android Studio and click **Build APK**.
Install the generated APK on your phone and enable **Notification Access**.
