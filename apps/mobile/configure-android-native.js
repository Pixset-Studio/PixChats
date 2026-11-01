// Автоматический конфигуратор нативного Android-проекта PixChats (.apk)
// Запускается после `npx cap add android` и `npx cap sync android`:
// 1. Прописывает системные разрешения Android 13+ (POST_NOTIFICATIONS, VIBRATE, RECORD_AUDIO, REQUEST_INSTALL_PACKAGES) в AndroidManifest.xml
// 2. Встраивает нативный мост PixChatsAndroid (MainActivity + PixChatsNativeBridge) для запроса системных уведомлений и показа пушей вне браузера

const fs = require('fs');
const path = require('path');

const ANDROID_DIR = path.join(__dirname, 'android');
const MANIFEST_PATH = path.join(ANDROID_DIR, 'app', 'src', 'main', 'AndroidManifest.xml');
const PACKAGE_DIR = path.join(ANDROID_DIR, 'app', 'src', 'main', 'java', 'studio', 'pixset', 'pixchats');

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
    console.log('[configure-android-native] Patched AndroidManifest.xml with native permissions (POST_NOTIFICATIONS, etc.)');
  }
}

function injectNativeAndroidSources() {
  if (!fs.existsSync(ANDROID_DIR)) return;
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });

  const ktMainPath = path.join(PACKAGE_DIR, 'MainActivity.kt');
  const buildGradlePath = path.join(ANDROID_DIR, 'app', 'build.gradle');
  const buildGradle = fs.existsSync(buildGradlePath) ? fs.readFileSync(buildGradlePath, 'utf8') : '';
  const usesKotlin = fs.existsSync(ktMainPath) || buildGradle.includes('kotlin-android') || buildGradle.includes('org.jetbrains.kotlin');

  if (usesKotlin) {
    // Используем нативные исходники на Kotlin
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
    // Используем нативные исходники на Java (стандартный шаблон Capacitor Android SDK)
    const mainJavaCode = `package studio.pixset.pixchats;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final String CHANNEL_ID = "pixchats_alerts";
    public static final String CHANNEL_NAME = "Уведомления PixChats";
    public static final int REQ_CODE_NOTIFICATIONS = 1001;

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
        }

        handleNotificationIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    public void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33) {
            String perm = "android.permission.POST_NOTIFICATIONS";
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, new String[]{perm}, REQ_CODE_NOTIFICATIONS);
            }
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
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.JavascriptInterface;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class PixChatsNativeBridge {
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

    @JavascriptInterface
    public void downloadAndInstallApk(final String apkUrl) {
        activity.runOnUiThread(() -> {
            try {
                Uri uri = Uri.parse(apkUrl);
                DownloadManager.Request req = new DownloadManager.Request(uri)
                    .setTitle("Обновление PixChats")
                    .setDescription("Загрузка новой версии PixChats.apk…")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "PixChats-Update.apk")
                    .setMimeType("application/vnd.android.package-archive");

                DownloadManager dm = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.enqueue(req);
                }

                Intent viewIntent = new Intent(Intent.ACTION_VIEW, uri);
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(viewIntent);
            } catch (Exception ignored) {
            }
        });
    }
}
`;

    fs.writeFileSync(path.join(PACKAGE_DIR, 'MainActivity.java'), mainJavaCode, 'utf8');
    fs.writeFileSync(path.join(PACKAGE_DIR, 'PixChatsNativeBridge.java'), bridgeJavaCode, 'utf8');
    console.log('[configure-android-native] Injected Native Android MainActivity.java & PixChatsNativeBridge.java');
  }
}

patchAndroidManifest();
injectNativeAndroidSources();
