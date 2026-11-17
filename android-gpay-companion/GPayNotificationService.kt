package com.claychat.gpaylistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class GPayNotificationService : NotificationListenerService() {

    private val TAG = "GPayListener"

    // Supported Google Pay Packages
    // com.google.android.apps.nbu.paisa.merchant = Google Pay for Business
    // com.google.android.apps.nbu.paisa.user = Personal Google Pay
    private val GPAY_BUSINESS_PACKAGE = "com.google.android.apps.nbu.paisa.merchant"
    private val GPAY_PERSONAL_PACKAGE = "com.google.android.apps.nbu.paisa.user"

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkg = sbn.packageName
        if (pkg != GPAY_BUSINESS_PACKAGE && pkg != GPAY_PERSONAL_PACKAGE) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        Log.d(TAG, "GPay Notification from $pkg: Title='$title' | Text='$text'")

        // Only process notifications indicating incoming money
        // E.g.: "Received ₹1.00", "Payment of ₹1 received"
        val fullContent = "$title $text".lowercase()
        if (fullContent.contains("received") || fullContent.contains("credited") || fullContent.contains("paid you") || fullContent.contains("₹")) {
            sendWebhookToServer(title, text)
        }
    }

    private fun sendWebhookToServer(title: String, text: String) {
        val prefs = getSharedPreferences("clay_prefs", MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "https://fluffy-worms-shave.loca.lt/api/gpay/webhook") ?: return
        val secret = prefs.getString("webhook_secret", "claychat_gpay_secret_2026") ?: "claychat_gpay_secret_2026"

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = URL(serverUrl)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("X-Webhook-Secret", secret)
                conn.doOutput = true

                val payload = JSONObject().apply {
                    put("title", title)
                    put("text", text)
                    put("timestamp", System.currentTimeMillis())
                }

                OutputStreamWriter(conn.outputStream).use { writer ->
                    writer.write(payload.toString())
                    writer.flush()
                }

                val responseCode = conn.responseCode
                Log.d(TAG, "Webhook dispatched. HTTP Response Code: $responseCode")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to send webhook: ${e.message}", e)
            }
        }
    }
}
