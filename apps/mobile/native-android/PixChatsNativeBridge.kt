package studio.pixset.pixchats

import android.app.DownloadManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Нативный Kotlin-мост PixChats для Android APK (window.PixChatsAndroid).
 * Позволяет вызывать системные функции Android напрямую из клиентского приложения:
 * - Проверка и запрос разрешений на уведомления (POST_NOTIFICATIONS)
 * - Отправка нативных уведомлений в шторку Android со звуком, вибрацией и переходом в чат
 * - Скачивание и запуск установки обновлений .apk через системный DownloadManager
 */
class PixChatsNativeBridge(private val activity: MainActivity) {

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
            } catch (_: Exception) {
                // Игнорируем возможные системные ограничения, если разрешение ещё не выдано
            }
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

                // Также открываем URL в системном установщике/браузере для мгновенного запуска
                val viewIntent = Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                activity.startActivity(viewIntent)
            } catch (_: Exception) {
                // fallback
            }
        }
    }
}
