package com.claychat.gpaylistener

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 60, 50, 50)
        }

        val titleView = TextView(this).apply {
            text = "⚡ Clay Chat - GPay Business Webhook Companion"
            textSize = 18f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, 30)
        }

        val statusView = TextView(this).apply {
            text = if (isNotificationServiceEnabled()) "✅ Notification Listener: ACTIVE" else "❌ Notification Access: NOT GRANTED"
            textSize = 15f
            setPadding(0, 0, 0, 20)
        }

        val permBtn = Button(this).apply {
            text = "Grant Notification Access in Settings"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
            }
        }

        val label = TextView(this).apply {
            text = "Clay Chat Webhook URL:"
            setPadding(0, 30, 0, 10)
        }

        val prefs = getSharedPreferences("clay_prefs", MODE_PRIVATE)
        val urlInput = EditText(this).apply {
            setText(prefs.getString("server_url", "https://fluffy-worms-shave.loca.lt/api/gpay/webhook"))
        }

        val saveBtn = Button(this).apply {
            text = "Save Server URL"
            setOnClickListener {
                val input = urlInput.text.toString().trim()
                if (input.isNotEmpty()) {
                    prefs.edit().putString("server_url", input).apply()
                    Toast.makeText(this@MainActivity, "URL Saved!", Toast.LENGTH_SHORT).show()
                }
            }
        }

        layout.addView(titleView)
        layout.addView(statusView)
        layout.addView(permBtn)
        layout.addView(label)
        layout.addView(urlInput)
        layout.addView(saveBtn)

        setContentView(layout)
    }

    private fun isNotificationServiceEnabled(): Boolean {
        val pkgName = packageName
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (!TextUtils.isEmpty(flat)) {
            val names = flat.split(":".toRegex()).toTypedArray()
            for (name in names) {
                val cn = ComponentName.unflattenFromString(name)
                if (cn != null && TextUtils.equals(pkgName, cn.packageName)) {
                    return true
                }
            }
        }
        return false
    }
}
