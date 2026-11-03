package studio.pixset.pixchats

import android.app.DownloadManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Нативный Kotlin-мост PixChats для Android APK (window.PixChatsAndroid).
 * Обеспечивает:
 * - Проверку и запрос разрешений на уведомления (POST_NOTIFICATIONS), микрофон и камеру
 * - Показ нативных уведомлений в шторке Android
 * - Полноэкранный входящий вызов с системной мелодией звонка (RingtoneManager.TYPE_RINGTONE) и вибрацией
 * - Автоматическое фоновое скачивание и самоустановку обновлений .apk через PackageInstaller Session API
 */
class PixChatsNativeBridge(private val activity: MainActivity) {

    companion object {
        const val INCOMING_CALL_NOTIF_ID = 777001
        const val ACTION_INSTALL_COMMIT = "studio.pixset.pixchats.ACTION_INSTALL_COMMIT"
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
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent)

                val manager = activity.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.notify(notifId, builder.build())

                try {
                    val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator?.vibrate(VibrationEffect.createOneShot(220, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        vibrator?.vibrate(220)
                    }
                } catch (_: Exception) {}
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

    /**
     * Запускает установку скачанного APK через системный PackageInstaller Session API
     * (с поддержкой USER_ACTION_NOT_REQUIRED на Android 12+ для автоматического самообновления).
     */
    @Suppress("DEPRECATION")
    fun installApkFileWithPackageInstaller(apkFile: File) {
        activity.runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
                    activity.pendingAutoInstallApk = apkFile
                    val permIntent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${activity.packageName}")
                    ).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    activity.startActivity(permIntent)
                    return@runOnUiThread
                }

                val packageInstaller = activity.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                params.setAppPackageName(activity.packageName)

                // На Android 12+ (API 31+) указываем USER_ACTION_NOT_REQUIRED (2) для автоматического обновления собственного пакета
                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        val method = params.javaClass.getMethod("setRequireUserAction", Int::class.javaPrimitiveType)
                        method.invoke(params, 2)
                    } catch (_: Throwable) {}
                }

                val sessionId = packageInstaller.createSession(params)
                val session = packageInstaller.openSession(sessionId)

                session.openWrite("PixChats-Update.apk", 0, apkFile.length()).use { outStream ->
                    FileInputStream(apkFile).use { inStream ->
                        val buffer = ByteArray(65536)
                        var read: Int
                        while (inStream.read(buffer).also { read = it } != -1) {
                            outStream.write(buffer, 0, read)
                        }
                    }
                    session.fsync(outStream)
                }

                val commitReceiver = object : BroadcastReceiver() {
                    override fun onReceive(context: Context?, intent: Intent?) {
                        if (intent == null) return
                        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            try {
                                val confirmIntent = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                                if (confirmIntent != null) {
                                    confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    activity.startActivity(confirmIntent)
                                }
                            } catch (_: Exception) {}
                        } else {
                            try {
                                activity.unregisterReceiver(this)
                            } catch (_: Exception) {}
                        }
                    }
                }

                if (Build.VERSION.SDK_INT >= 33) {
                    activity.registerReceiver(
                        commitReceiver,
                        IntentFilter(ACTION_INSTALL_COMMIT),
                        Context.RECEIVER_EXPORTED
                    )
                } else {
                    activity.registerReceiver(
                        commitReceiver,
                        IntentFilter(ACTION_INSTALL_COMMIT)
                    )
                }

                val broadcastIntent = Intent(ACTION_INSTALL_COMMIT).apply {
                    setPackage(activity.packageName)
                }

                // Для PackageInstaller.Session.commit обязательно нужен MUTABLE PendingIntent на Android 12+ (0x02000000)
                val mutableFlag = if (Build.VERSION.SDK_INT >= 31) 0x02000000 else 0
                val pendingIntent = PendingIntent.getBroadcast(
                    activity,
                    sessionId,
                    broadcastIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or mutableFlag
                )

                session.commit(pendingIntent.intentSender)
                session.close()
            } catch (_: Exception) {}
        }
    }

    @JavascriptInterface
    fun downloadAndInstallApk(apkUrl: String) {
        activity.emitUpdateProgress(2, "downloading")

        Thread {
            try {
                val targetDir = activity.externalCacheDir ?: activity.cacheDir
                val apkFile = File(targetDir, "PixChats-Update.apk")
                if (apkFile.exists()) {
                    apkFile.delete()
                }

                var currentUrl = apkUrl
                var redirectsLeft = 7
                var connection: HttpURLConnection? = null

                while (redirectsLeft > 0) {
                    val urlObj = URL(currentUrl)
                    val conn = (urlObj.openConnection() as HttpURLConnection).apply {
                        instanceFollowRedirects = true
                        connectTimeout = 20000
                        readTimeout = 30000
                        setRequestProperty("User-Agent", "PixChats-Android-AutoUpdater/2.0")
                    }
                    conn.connect()
                    val code = conn.responseCode
                    if (code in 300..399) {
                        val location = conn.getHeaderField("Location")
                        conn.disconnect()
                        if (!location.isNullOrEmpty()) {
                            currentUrl = location
                            redirectsLeft--
                            continue
                        }
                    }
                    connection = conn
                    break
                }

                val conn = connection ?: throw IllegalStateException("Connection failed")
                if (conn.responseCode != HttpURLConnection.HTTP_OK) {
                    conn.disconnect()
                    throw IllegalStateException("HTTP ${conn.responseCode}")
                }

                val totalBytes = conn.contentLengthLong
                var downloadedBytes = 0L
                var lastPct = -1

                conn.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(65536)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            output.write(buffer, 0, bytesRead)
                            downloadedBytes += bytesRead
                            if (totalBytes > 0) {
                                val pct = ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(1, 99)
                                if (pct != lastPct) {
                                    lastPct = pct
                                    activity.emitUpdateProgress(pct, "downloading")
                                }
                            }
                        }
                        output.flush()
                    }
                }
                conn.disconnect()

                activity.emitUpdateProgress(100, "installing")
                installApkFileWithPackageInstaller(apkFile)
            } catch (_: Exception) {
                // Fallback через системный DownloadManager, если прямое соединение прервалось
                activity.runOnUiThread {
                    try {
                        val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                        val oldFile = File(downloadsDir, "PixChats-Update.apk")
                        if (oldFile.exists()) oldFile.delete()

                        val uri = Uri.parse(apkUrl)
                        val request = DownloadManager.Request(uri)
                            .setTitle("Автообновление PixChats")
                            .setDescription("Загрузка и автоматическая установка новой версии…")
                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PixChats-Update.apk")
                            .setMimeType("application/vnd.android.package-archive")

                        val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                        val downloadId = dm.enqueue(request)

                        val onComplete = object : BroadcastReceiver() {
                            override fun onReceive(ctx: Context?, intent: Intent?) {
                                val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) ?: -1L
                                if (id == downloadId) {
                                    try {
                                        activity.unregisterReceiver(this)
                                    } catch (_: Exception) {}
                                    try {
                                        val downloadedFile = File(downloadsDir, "PixChats-Update.apk")
                                        if (downloadedFile.exists()) {
                                            installApkFileWithPackageInstaller(downloadedFile)
                                            return
                                        }
                                        val fileUri = dm.getUriForDownloadedFile(downloadId)
                                        if (fileUri != null) {
                                            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                                                setDataAndType(fileUri, "application/vnd.android.package-archive")
                                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                            }
                                            activity.startActivity(installIntent)
                                        }
                                    } catch (_: Exception) {}
                                }
                            }
                        }

                        if (Build.VERSION.SDK_INT >= 33) {
                            activity.registerReceiver(
                                onComplete,
                                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                                Context.RECEIVER_EXPORTED
                            )
                        } else {
                            activity.registerReceiver(
                                onComplete,
                                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
                            )
                        }
                    } catch (_: Exception) {}
                }
            }
        }.start()
    }
}
