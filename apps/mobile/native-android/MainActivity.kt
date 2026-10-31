package studio.pixset.pixchats

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity

/**
 * Нативная Android-активность PixChats (Kotlin).
 * - Создаёт системный канал уведомлений высокой важности (звук + вибрация)
 * - Автоматически запрашивает системное разрешение POST_NOTIFICATIONS (Android 13+) при запуске
 * - Подключает нативный Kotlin-мост window.PixChatsAndroid для показа системных уведомлений и автообновления APK
 */
class MainActivity : BridgeActivity() {

    companion object {
        const val CHANNEL_ID = "pixchats_alerts"
        const val CHANNEL_NAME = "Уведомления PixChats"
        const val REQ_CODE_NOTIFICATIONS = 1001
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        createNotificationChannel()
        requestNotificationPermissionIfNeeded()

        // Подключаем нативный Kotlin-мост к WebView
        bridge?.webView?.let { webView ->
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.settings.mediaPlaybackRequiresUserGesture = false
            webView.addJavascriptInterface(PixChatsNativeBridge(this), "PixChatsAndroid")
        }

        handleNotificationIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleNotificationIntent(intent)
    }

    fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            val perm = "android.permission.POST_NOTIFICATIONS"
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, arrayOf(perm), REQ_CODE_NOTIFICATIONS)
            }
        }
        // Также запрашиваем микрофон при необходимости записи голосовых сообщений
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            // Запросится автоматически при первом обращении или вместе с уведомлениями
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, importance).apply {
                description = "Мгновенные уведомления о сообщениях, упоминаниях и заявках в друзья в PixChats"
                enableVibration(true)
                enableLights(true)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun handleNotificationIntent(intent: Intent?) {
        val targetUrl = intent?.getStringExtra("target_url") ?: return
        if (targetUrl.isNotEmpty()) {
            bridge?.webView?.postDelayed({
                val safeUrl = targetUrl.replace("'", "\\'")
                bridge?.webView?.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('pixchats:native_navigate', { detail: { url: '$safeUrl' } }));",
                    null
                )
            }, 600)
        }
    }
}
