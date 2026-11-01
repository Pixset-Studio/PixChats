// Автоматический конфигуратор нативного Android-проекта PixChats (.apk)
// Запускается после `npx cap add android` и `npx cap sync android`:
// 1. Прописывает системные разрешения Android 13+ (POST_NOTIFICATIONS, VIBRATE, RECORD_AUDIO, CAMERA, REQUEST_INSTALL_PACKAGES) в AndroidManifest.xml
// 2. Устанавливает постоянный ключ подписи (pixchats-signing.keystore) и автоматически растущий versionCode в build.gradle,
//    чтобы любой новый PixChats.apk устанавливался поверх предыдущего без удаления приложения!
// 3. Встраивает нативный мост PixChatsAndroid (MainActivity + PixChatsNativeBridge) с авто-разрешением WebRTC в WebView

const fs = require('fs');
const os = require('os');
const path = require('path');

const ANDROID_DIR = path.join(__dirname, 'android');
const MANIFEST_PATH = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
const PACKAGE_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', 'studio', 'pixset', 'pixchats');
const KEYSTORE_SRC = path.join(__dirname, 'pixchats-signing.keystore');

function patchAndroidManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.log('[configure-android-native] AndroidManifest.xml not found yet, skipping.');
    return;
  }

  let xml = fs.readFileSync(MANIFEST_PATH, 'utf8');

  const requiredPermissions = [
    'android.permission.INTERNET',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.USE_FULL_SCREEN_INTENT',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.VIBRATE',
    'android.permission.WAKE_LOCK',
    'android.permission.RECORD_AUDIO',
    'android.permission.CAMERA',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.REQUEST_INSTALL_PACKAGES',
    'android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION',
  ];

  const missingTags = requiredPermissions
    .filter((perm) => !xml.includes(perm))
    .map((perm) => `    <uses-permission android:name="${perm}" />`)
    .join('\n');

  if (missingTags) {
    if (xml.includes('<application')) {
      xml = xml.replace('<application', `${missingTags}\n\n    <application`);
    } else if (xml.includes('</manifest>')) {
      xml = xml.replace('</manifest>', `${missingTags}\n</manifest>`);
    }
    fs.writeFileSync(MANIFEST_PATH, xml, 'utf8');
    console.log('[configure-android-native] Patched AndroidManifest.xml with native permissions (POST_NOTIFICATIONS, RECORD_AUDIO, CAMERA, REQUEST_INSTALL_PACKAGES, UPDATE_PACKAGES_WITHOUT_USER_ACTION)');
  }
}

function configurePersistentSigningAndVersion() {
  if (!fs.existsSync(ANDROID_DIR)) return;

  const appDir = path.join(ANDROID_DIR, 'app');
  const buildGradlePath = path.join(appDir, 'build.gradle');
  if (!fs.existsSync(buildGradlePath)) return;

  // 1. Копируем постоянный ключ подписи в android/app/pixchats-signing.keystore и в ~/.android/debug.keystore
  if (fs.existsSync(KEYSTORE_SRC)) {
    try {
      const targetKeystore = path.join(appDir, 'pixchats-signing.keystore');
      fs.copyFileSync(KEYSTORE_SRC, targetKeystore);

      const dotAndroidDir = path.join(os.homedir(), '.android');
      fs.mkdirSync(dotAndroidDir, { recursive: true });
      fs.copyFileSync(KEYSTORE_SRC, path.join(dotAndroidDir, 'debug.keystore'));
      console.log('[configure-android-native] Installed persistent pixchats-signing.keystore -> app & ~/.android/debug.keystore');
    } catch (err) {
      console.warn('[configure-android-native] Could not copy keystore:', err);
    }
  }

  // 2. Вычисляем монотонно растущий versionCode и versionName, чтобы Android всегда разрешал обновление поверх установленного APK
  const runNum = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10) || 1;
  const versionCode = 10000 + runNum;
  const versionName = process.env.NEXT_PUBLIC_APP_VERSION || `0.2.${runNum}`;

  let gradle = fs.readFileSync(buildGradlePath, 'utf8');

  gradle = gradle.replace(/versionCode\s+\d+/g, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]*"/g, `versionName "${versionName}"`);

  // Явно прописываем единый signingConfig для debug и release с нашим постоянным сертификатом
  if (fs.existsSync(path.join(appDir, 'pixchats-signing.keystore')) && !gradle.includes('pixchats-signing.keystore')) {
    const signingBlock = `
    signingConfigs {
        debug {
            storeFile file('pixchats-signing.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;
    if (gradle.includes('defaultConfig {')) {
      gradle = gradle.replace('defaultConfig {', `${signingBlock}\n    defaultConfig {`);
    }
  }

  fs.writeFileSync(buildGradlePath, gradle, 'utf8');
  console.log(`[configure-android-native] Patched app/build.gradle -> versionCode=${versionCode}, versionName="${versionName}"`);
}

function injectNativeAndroidSources() {
  if (!fs.existsSync(ANDROID_DIR)) return;
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });

  const ktMainPath = path.join(PACKAGE_DIR, 'MainActivity.kt');
  const buildGradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
  const buildGradle = fs.existsSync(buildGradlePath) ? fs.readFileSync(buildGradlePath, 'utf8') : '';
  const usesKotlin = fs.existsSync(ktMainPath) || buildGradle.includes('kotlin-android') || buildGradle.includes('org.jetbrains.kotlin');

  if (usesKotlin) {
    const javaMain = path.join(PACKAGE_DIR, 'MainActivity.java');
    if (fs.existsSync(javaMain)) fs.unlinkSync(javaMain);

    fs.copyFileSync(
      path.join(__dirname, 'native-android', 'MainActivity.kt'),
      path.join(PACKAGE_DIR, 'MainActivity.kt')
    );
    fs.copyFileSync(
      path.join(__dirname, 'native-android', 'PixChatsNativeBridge.kt'),
      path.join(PACKAGE_DIR, 'PixChatsNativeBridge.kt')
    );
    console.log('[configure-android-native] Injected Kotlin MainActivity.kt & PixChatsNativeBridge.kt');
  } else {
    const mainJavaCode = `package studio.pixset.pixchats;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.io.File;

public class MainActivity extends BridgeActivity {
    public static final String CHANNEL_ID = "pixchats_alerts";
    public static final String CHANNEL_NAME = "Уведомления PixChats";
    public static final int REQ_CODE_NOTIFICATIONS = 1001;
    public File pendingAutoInstallApk = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        createNotificationChannel();
        requestNotificationPermissionIfNeeded();

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            webView.addJavascriptInterface(new PixChatsNativeBridge(this), "PixChatsAndroid");

            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    if (request == null) return;
                    runOnUiThread(() -> {
                        try {
                            request.grant(request.getResources());
                        } catch (Exception e) {
                            super.onPermissionRequest(request);
                        }
                    });
                }
            });
        }

        handleNotificationIntent(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        if (pendingAutoInstallApk != null && pendingAutoInstallApk.exists()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls()) {
                File apk = pendingAutoInstallApk;
                pendingAutoInstallApk = null;
                new PixChatsNativeBridge(this).installApkFileWithPackageInstaller(apk);
            }
        }
    }

    public void emitUpdateProgress(final int percent, final String status) {
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('pixchats:update_progress', { detail: { percent: " + percent + ", status: '" + status + "' } }));",
                        null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    public void requestNotificationPermissionIfNeeded() {
        java.util.List<String> perms = new java.util.ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            String notifPerm = "android.permission.POST_NOTIFICATIONS";
            if (ContextCompat.checkSelfPermission(this, notifPerm) != PackageManager.PERMISSION_GRANTED) {
                perms.add(notifPerm);
            }
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            perms.add(Manifest.permission.CAMERA);
        }
        if (!perms.isEmpty()) {
            ActivityCompat.requestPermissions(this, perms.toArray(new String[0]), REQ_CODE_NOTIFICATIONS);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Мгновенные уведомления о сообщениях, упоминаниях и заявках в друзья в PixChats");
            channel.enableVibration(true);
            channel.enableLights(true);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) return;
        final String targetUrl = intent.getStringExtra("target_url");
        if (targetUrl != null && !targetUrl.isEmpty() && getBridge() != null && getBridge().getWebView() != null) {
            final WebView webView = getBridge().getWebView();
            webView.postDelayed(() -> {
                String safeUrl = targetUrl.replace("'", "\\\\'");
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('pixchats:native_navigate', { detail: { url: '" + safeUrl + "' } }));",
                    null
                );
            }, 600);
        }
    }
}
`;

    const bridgeJavaCode = `package studio.pixset.pixchats;

import android.app.DownloadManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;

public class PixChatsNativeBridge {
    private static final String ACTION_INSTALL_COMMIT = "studio.pixset.pixchats.ACTION_INSTALL_COMMIT";
    private final MainActivity activity;

    public PixChatsNativeBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public boolean isNativeAndroid() {
        return true;
    }

    @JavascriptInterface
    public boolean hasNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(
                activity,
                "android.permission.POST_NOTIFICATIONS"
            ) == PackageManager.PERMISSION_GRANTED;
        }
        return NotificationManagerCompat.from(activity).areNotificationsEnabled();
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.runOnUiThread(activity::requestNotificationPermissionIfNeeded);
    }

    @JavascriptInterface
    public void showNotification(final String title, final String body, final String targetUrl) {
        activity.runOnUiThread(() -> {
            try {
                if (!hasNotificationPermission()) {
                    activity.requestNotificationPermissionIfNeeded();
                }

                Intent intent = new Intent(activity, MainActivity.class);
                intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                intent.putExtra("target_url", targetUrl != null ? targetUrl : "/chats/");

                int pendingFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? (PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : PendingIntent.FLAG_UPDATE_CURRENT;

                int notifId = (int) (System.currentTimeMillis() % Integer.MAX_VALUE);
                PendingIntent pendingIntent = PendingIntent.getActivity(activity, notifId, intent, pendingFlags);

                int smallIcon = activity.getApplicationInfo().icon != 0
                    ? activity.getApplicationInfo().icon
                    : android.R.drawable.ic_dialog_info;

                NotificationCompat.Builder builder = new NotificationCompat.Builder(activity, MainActivity.CHANNEL_ID)
                    .setSmallIcon(smallIcon)
                    .setContentTitle(title != null && !title.isEmpty() ? title : "PixChats")
                    .setContentText(body != null ? body : "")
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setAutoCancel(true)
                    .setContentIntent(pendingIntent);

                NotificationManager manager = (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(notifId, builder.build());
                }
            } catch (Exception ignored) {
            }
        });
    }

    @SuppressWarnings("deprecation")
    public void installApkFileWithPackageInstaller(final File apkFile) {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.pendingAutoInstallApk = apkFile;
                    Intent permIntent = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName())
                    );
                    permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    activity.startActivity(permIntent);
                    return;
                }

                PackageInstaller packageInstaller = activity.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(activity.getPackageName());

                if (Build.VERSION.SDK_INT >= 31) {
                    try {
                        Method m = params.getClass().getMethod("setRequireUserAction", int.class);
                        m.invoke(params, 2);
                    } catch (Throwable ignored) {}
                }

                int sessionId = packageInstaller.createSession(params);
                PackageInstaller.Session session = packageInstaller.openSession(sessionId);

                try (OutputStream out = session.openWrite("PixChats-Update.apk", 0, apkFile.length());
                     InputStream in = new FileInputStream(apkFile)) {
                    byte[] buffer = new byte[65536];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                    }
                    session.fsync(out);
                }

                BroadcastReceiver commitReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        if (intent == null) return;
                        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            try {
                                Intent confirmIntent = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                                if (confirmIntent != null) {
                                    confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    activity.startActivity(confirmIntent);
                                }
                            } catch (Exception ignored) {}
                        } else {
                            try {
                                activity.unregisterReceiver(this);
                            } catch (Exception ignored) {}
                        }
                    }
                };

                if (Build.VERSION.SDK_INT >= 33) {
                    activity.registerReceiver(commitReceiver, new IntentFilter(ACTION_INSTALL_COMMIT), Context.RECEIVER_EXPORTED);
                } else {
                    activity.registerReceiver(commitReceiver, new IntentFilter(ACTION_INSTALL_COMMIT));
                }

                Intent broadcastIntent = new Intent(ACTION_INSTALL_COMMIT);
                broadcastIntent.setPackage(activity.getPackageName());

                int mutableFlag = Build.VERSION.SDK_INT >= 31 ? 0x02000000 : 0;
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    activity,
                    sessionId,
                    broadcastIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag
                );

                session.commit(pendingIntent.getIntentSender());
                session.close();
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void downloadAndInstallApk(final String apkUrl) {
        activity.emitUpdateProgress(2, "downloading");

        new Thread(() -> {
            try {
                File targetDir = activity.getExternalCacheDir() != null ? activity.getExternalCacheDir() : activity.getCacheDir();
                File apkFile = new File(targetDir, "PixChats-Update.apk");
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                String currentUrl = apkUrl;
                int redirectsLeft = 7;
                HttpURLConnection connection = null;

                while (redirectsLeft > 0) {
                    URL urlObj = new URL(currentUrl);
                    HttpURLConnection conn = (HttpURLConnection) urlObj.openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(30000);
                    conn.setRequestProperty("User-Agent", "PixChats-Android-AutoUpdater/2.0");
                    conn.connect();
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String location = conn.getHeaderField("Location");
                        conn.disconnect();
                        if (location != null && !location.isEmpty()) {
                            currentUrl = location;
                            redirectsLeft--;
                            continue;
                        }
                    }
                    connection = conn;
                    break;
                }

                if (connection == null || connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    if (connection != null) connection.disconnect();
                    throw new IllegalStateException("Download failed");
                }

                long totalBytes = connection.getContentLengthLong();
                long downloadedBytes = 0L;
                int lastPct = -1;

                try (InputStream in = connection.getInputStream();
                     FileOutputStream out = new FileOutputStream(apkFile)) {
                    byte[] buffer = new byte[65536];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        downloadedBytes += read;
                        if (totalBytes > 0) {
                            int pct = (int) Math.min(99L, Math.max(1L, (downloadedBytes * 100L) / totalBytes));
                            if (pct != lastPct) {
                                lastPct = pct;
                                activity.emitUpdateProgress(pct, "downloading");
                            }
                        }
                    }
                    out.flush();
                }
                connection.disconnect();

                activity.emitUpdateProgress(100, "installing");
                installApkFileWithPackageInstaller(apkFile);
            } catch (Exception ignored) {
                activity.runOnUiThread(() -> {
                    try {
                        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        File oldFile = new File(downloadsDir, "PixChats-Update.apk");
                        if (oldFile.exists()) oldFile.delete();

                        Uri uri = Uri.parse(apkUrl);
                        DownloadManager.Request req = new DownloadManager.Request(uri)
                            .setTitle("Автообновление PixChats")
                            .setDescription("Загрузка и автоматическая установка новой версии…")
                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PixChats-Update.apk")
                            .setMimeType("application/vnd.android.package-archive");

                        final DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                        if (dm != null) {
                            final long downloadId = dm.enqueue(req);
                            BroadcastReceiver onComplete = new BroadcastReceiver() {
                                @Override
                                public void onReceive(Context context, Intent intent) {
                                    long id = intent != null ? intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L) : -1L;
                                    if (id == downloadId) {
                                        try {
                                            activity.unregisterReceiver(this);
                                        } catch (Exception ignored2) {}
                                        try {
                                            File downloadedFile = new File(downloadsDir, "PixChats-Update.apk");
                                            if (downloadedFile.exists()) {
                                                installApkFileWithPackageInstaller(downloadedFile);
                                                return;
                                            }
                                            Uri fileUri = dm.getUriForDownloadedFile(downloadId);
                                            if (fileUri != null) {
                                                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                                                installIntent.setDataAndType(fileUri, "application/vnd.android.package-archive");
                                                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                                                activity.startActivity(installIntent);
                                            }
                                        } catch (Exception ignored3) {}
                                    }
                                }
                            };
                            if (Build.VERSION.SDK_INT >= 33) {
                                activity.registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
                            } else {
                                activity.registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
                            }
                        }
                    } catch (Exception ignored4) {}
                });
            }
        }).start();
    }
}
`;

    fs.writeFileSync(path.join(PACKAGE_DIR, 'MainActivity.java'), mainJavaCode, 'utf8');
    fs.writeFileSync(path.join(PACKAGE_DIR, 'PixChatsNativeBridge.java'), bridgeJavaCode, 'utf8');
    console.log('[configure-android-native] Injected Native Android MainActivity.java & PixChatsNativeBridge.java');
  }
}

patchAndroidManifest();
configurePersistentSigningAndVersion();
injectNativeAndroidSources();
