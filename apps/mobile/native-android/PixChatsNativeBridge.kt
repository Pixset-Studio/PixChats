package studio.pixset.pixchats

import android.app.DownloadManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Нативный Kotlin-мост PixChats для Android APK (window.PixChatsAndroid).
 * Обеспечивает:
 * - Проверку и запрос разрешений на уведомления (POST_NOTIFICATIONS)
 * - Показ нативных уведомлений в шторке Android
 * - Полноэкранный входящий вызов с системной мелодией звонка (RingtoneManager.TYPE_RINGTONE) и вибрацией
 * - Скачивание и запуск установки обновлений .apk через системный DownloadManager
 */
class PixChatsNativeBridge(private val activity: MainActivity) {

    companion object {
        const val INCOMING_CALL_NOTIF_ID = 777001
        private var activeRingtone: Ringtone? = null
    }

    @JavascriptInterface
    fun isNativeAndroid(): Boolean {
        return true
    }

    @JavascriptInterface
    fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(
                activity,
                "android.permission.POST_NOTIFICATIONS"
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(activity).areNotificationsEnabled()
        }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
        activity.runOnUiThread {
            activity.requestNotificationPermissionIfNeeded()
        }
    }

    @JavascriptInterface
    fun showNotification(title: String, body: String, targetUrl: String) {
        activity.runOnUiThread {
            try {
                if (!hasNotificationPermission()) {
                    activity.requestNotificationPermissionIfNeeded()
                }

                val intent = Intent(activity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("target_url", targetUrl)
                }

                val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }

                val notifId = (System.currentTimeMillis() % Int.MAX_VALUE).toInt()
                val pendingIntent = PendingIntent.getActivity(activity, notifId, intent, pendingFlags)

                val smallIconRes = activity.applicationInfo.icon.takeIf { it != 0 }
                    ?: android.R.drawable.ic_dialog_info

                val builder = NotificationCompat.Builder(activity, MainActivity.CHANNEL_ID)
                    .setSmallIcon(smallIconRes)
                    .setContentTitle(title.ifEmpty { "PixChats" })
                    .setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)

                val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(notifId, builder.build())
            } catch (_: Exception) {}
        }
    }

    /**
     * Показывает входящий звонок на телефоне: включает системный рингтон звонка,
     * запускает вибрацию, будит экран и выводит окно приложения на передний план.
     */
    @Suppress("DEPRECATION")
    @JavascriptInterface
    fun showIncomingCallNotification(callerName: String, mode: String, targetUrl: String) {
        activity.runOnUiThread {
            try {
                activity.enableWakeAndLockScreenDisplay()

                // 1. Запускаем системную мелодию звонка телефона
                try {
                    activeRingtone?.stop()
                    val ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                    val ringtone = RingtoneManager.getRingtone(activity.applicationContext, ringUri)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        ringtone?.isLooping = true
                    }
                    ringtone?.play()
                    activeRingtone = ringtone
                } catch (_: Exception) {}

                // 2. Запускаем длительную вибрацию вызова
                try {
                    val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    val pattern = longArrayOf(0, 800, 400, 800, 400, 800, 400, 800)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
                    } else {
                        vibrator?.vibrate(pattern, 0)
                    }
                } catch (_: Exception) {}

                // 3. Поднимаем Activity на передний план и создаём FullScreen Call Notification
                val intent = Intent(activity, MainActivity::class.java).apply {
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP
                    putExtra("target_url", targetUrl)
                }

                val pendingFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                } else {
                    PendingIntent.FLAG_UPDATE_CURRENT
                }

                val fullScreenPendingIntent = PendingIntent.getActivity(
                    activity,
                    INCOMING_CALL_NOTIF_ID,
                    intent,
                    pendingFlags
                )

                val smallIconRes = activity.applicationInfo.icon.takeIf { it != 0 }
                    ?: android.R.drawable.sym_action_call

                val callTitle = if (mode == "video") "📹 Входящий видеозвонок" else "📞 Входящий звонок"
                val callBody = "$callerName вызывает вас в PixChats"

                val builder = NotificationCompat.Builder(activity, MainActivity.CALL_CHANNEL_ID)
                    .setSmallIcon(smallIconRes)
                    .setContentTitle(callTitle)
                    .setContentText(callBody)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setOngoing(true)
                    .setAutoCancel(true)
                    .setContentIntent(fullScreenPendingIntent)
                    .setFullScreenIntent(fullScreenPendingIntent, true)

                val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(INCOMING_CALL_NOTIF_ID, builder.build())

                // Выводим окно приложения поверх, если система позволяет
                try {
                    activity.startActivity(intent)
                } catch (_: Exception) {}
            } catch (_: Exception) {}
        }
    }

    /**
     * Останавливает системный рингтон, вибрацию и убирает плашку входящего вызова,
     * когда пользователь принял, отклонил или завершил звонок.
     */
    @JavascriptInterface
    fun stopIncomingCallAlert() {
        activity.runOnUiThread {
            try {
                activeRingtone?.stop()
                activeRingtone = null
            } catch (_: Exception) {}

            try {
                val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                vibrator?.cancel()
            } catch (_: Exception) {}

            try {
                val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.cancel(INCOMING_CALL_NOTIF_ID)
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun downloadAndInstallApk(apkUrl: String) {
        activity.runOnUiThread {
            try {
                val uri = Uri.parse(apkUrl)
                val request = DownloadManager.Request(uri)
                    .setTitle("Обновление PixChats")
                    .setDescription("Загрузка новой версии PixChats.apk…")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PixChats-Update.apk")
                    .setMimeType("application/vnd.android.package-archive")

                val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)

                val viewIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(viewIntent)
            } catch (_: Exception) {}
        }
    }
}
