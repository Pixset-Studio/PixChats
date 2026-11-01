package studio.pixset.pixchats

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.BridgeActivity
import com.getcapacitor.BridgeWebChromeClient

/**
 * Нативная Android-активность PixChats (Kotlin).
 * - Создаёт системные каналы уведомлений (сообщения + входящие звонки с мелодией вызова)
 * - Разрешает пробуждение экрана и показ входящего звонка поверх блокировки
 * - Автоматически запрашивает системные разрешения POST_NOTIFICATIONS, RECORD_AUDIO, CAMERA
 * - Разрешает WebRTC-захват микрофона и камеры внутри WebView без блокировок
 * - Подключает нативный Kotlin-мост window.PixChatsAndroid
 */
class MainActivity : BridgeActivity() {

    companion object {
        const val CHANNEL_ID = "pixchats_alerts"
        const val CHANNEL_NAME = "Уведомления PixChats"
        const val CALL_CHANNEL_ID = "pixchats_incoming_calls"
        const val CALL_CHANNEL_NAME = "Входящие звонки PixChats"
        const val REQ_CODE_NOTIFICATIONS = 1001
    }

    var pendingAutoInstallApk: java.io.File? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        enableWakeAndLockScreenDisplay()
        createNotificationChannels()
        requestNotificationPermissionIfNeeded()

        bridge?.webView?.let { webView ->
            webView.settings.javaScriptEnabled = true
            webView.settings.domStorageEnabled = true
            webView.settings.mediaPlaybackRequiresUserGesture = false
            webView.addJavascriptInterface(PixChatsNativeBridge(this), "PixChatsAndroid")

            if (bridge != null) {
                webView.webChromeClient = object : BridgeWebChromeClient(bridge) {
                    override fun onPermissionRequest(request: android.webkit.PermissionRequest?) {
                        if (request == null) return
                        runOnUiThread {
                            try {
                                request.grant(request.resources)
                            } catch (_: Exception) {
                                super.onPermissionRequest(request)
                            }
                        }
                    }
                }
            }
        }

        handleNotificationIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        val apkFile = pendingAutoInstallApk
        if (apkFile != null && apkFile.exists()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()) {
                pendingAutoInstallApk = null
                PixChatsNativeBridge(this).installApkFileWithPackageInstaller(apkFile)
            }
        }
    }

    fun emitUpdateProgress(percent: Int, status: String) {
        runOnUiThread {
            try {
                bridge?.webView?.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('pixchats:update_progress', { detail: { percent: $percent, status: '$status' } }));",
                    null
                )
            } catch (_: Exception) {}
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        enableWakeAndLockScreenDisplay()
        handleNotificationIntent(intent)
    }

    @Suppress("DEPRECATION")
    fun enableWakeAndLockScreenDisplay() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            } else {
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
        } catch (_: Exception) {}
    }

    fun requestNotificationPermissionIfNeeded() {
        val permsToRequest = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 33) {
            val notifPerm = "android.permission.POST_NOTIFICATIONS"
            if (ContextCompat.checkSelfPermission(this, notifPerm) != PackageManager.PERMISSION_GRANTED) {
                permsToRequest.add(notifPerm)
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permsToRequest.add(Manifest.permission.RECORD_AUDIO)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permsToRequest.add(Manifest.permission.CAMERA)
        }
        if (permsToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permsToRequest.toTypedArray(), REQ_CODE_NOTIFICATIONS)
        }
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val msgChannel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Мгновенные уведомления о сообщениях, упоминаниях и заявках в друзья в PixChats"
                enableVibration(true)
                enableLights(true)
            }
            manager.createNotificationChannel(msgChannel)

            val ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val audioAttrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val callChannel = NotificationChannel(
                CALL_CHANNEL_ID,
                CALL_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Входящие аудио- и видеозвонки в PixChats с рингтоном"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 800, 400, 800, 400, 800)
                enableLights(true)
                setSound(ringtoneUri, audioAttrs)
            }
            manager.createNotificationChannel(callChannel)
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
