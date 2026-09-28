package no.dumbpark.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowInsets;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.work.WorkManager;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    static final String ACTION_BOOK_FROM_REMINDER = "no.dumbpark.app.BOOK_FROM_REMINDER";
    private static final String LOCAL_ORIGIN = "https://appassets.androidplatform.net";
    private static final String SMARTPARK_ORIGIN = "https://parko.giantleap.no";
    private static final int ASK_LOCATION = 101;
    private static final int ASK_BACKGROUND = 102;
    private static final int ASK_NOTIFICATIONS = 103;
    private static final int BACKGROUND_SETTINGS = 104;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private WebView dashboard;
    private WebView challenge;
    private AlertDialog challengeDialog;
    private SecureStore store;
    private String reminderCallId;
    private boolean reminderRegistrationInProgress;
    private boolean pendingBooking;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        store = new SecureStore(this);
        pendingBooking = ACTION_BOOK_FROM_REMINDER.equals(getIntent().getAction());
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        dashboard = new WebView(this);
        dashboard.getSettings().setJavaScriptEnabled(true);
        dashboard.getSettings().setDomStorageEnabled(true);
        dashboard.getSettings().setAllowFileAccess(false);
        dashboard.getSettings().setAllowContentAccess(false);
        FrameLayout frame = new FrameLayout(this);
        int background = Color.rgb(16, 21, 20);
        frame.setBackgroundColor(background);
        getWindow().getDecorView().setBackgroundColor(background);
        getWindow().setStatusBarColor(background);
        getWindow().setNavigationBarColor(background);
        frame.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.systemBars()).top : insets.getSystemWindowInsetTop();
            int bottom = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsets.Type.systemBars()).bottom : insets.getSystemWindowInsetBottom();
            view.setPadding(0, top, 0, bottom);
            return insets;
        });
        dashboard.addJavascriptInterface(new DashboardBridge(), "DumbParkNative");
        dashboard.setWebChromeClient(new WebChromeClient());
        dashboard.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !LOCAL_ORIGIN.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost());
            }
        });
        frame.addView(dashboard, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(frame);
        dashboard.loadUrl(LOCAL_ORIGIN + "/assets/www/index.html");
    }

    @Override protected void onResume() {
        super.onResume();
        if (dashboard != null) dashboard.evaluateJavascript("window.dumbParkNativeFocus?.()", null);
        if (ArrivalGeofences.setupPending(this) && ArrivalGeofences.permissionsGranted(this)) continueReminderSetup();
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ACTION_BOOK_FROM_REMINDER.equals(intent.getAction())) {
            pendingBooking = true;
            dashboard.evaluateJavascript("window.dumbParkNativeBookRequested?.()", null);
        }
    }

    private void js(String expression) { runOnUiThread(() -> dashboard.evaluateJavascript(expression, null)); }

    private void reply(String id, Object value, String error) {
        JSONObject result = new JSONObject();
        try {
            result.put("id", id);
            if (error == null) result.put("value", value); else result.put("error", error);
            js("window.dumbParkNativeResult(" + JSONObject.quote(result.toString()) + ")");
        } catch (Exception ignored) { }
    }

    private JSONObject reminderStatus() throws Exception {
        boolean available = ArrivalGeofences.playServicesAvailable(this);
        boolean permissions = ArrivalGeofences.permissionsGranted(this);
        boolean enabled = ArrivalGeofences.enabled(this);
        boolean pending = ArrivalGeofences.setupPending(this);
        String message;
        if (!available) message = "Google Play services is needed for arrival reminders.";
        else if (enabled && !permissions) message = "Arrival reminders need precise, always-on location and notifications. Tap Enable to restore them.";
        else if (enabled) message = "On: 200 m around the parking lot and office, after five minutes inside.";
        else if (pending) message = "Finish the permission setup to turn on arrival reminders.";
        else message = "Arrival reminders are off.";
        return new JSONObject().put("enabled", available && permissions && enabled)
            .put("setupPending", pending).put("message", message);
    }

    private void continueReminderSetup() {
        if ((!ArrivalGeofences.setupPending(this) && reminderCallId == null) || reminderRegistrationInProgress) return;
        if (!ArrivalGeofences.playServicesAvailable(this)) { finishReminder("Google Play services is unavailable on this device."); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, ASK_NOTIFICATIONS); return;
        }
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, ASK_LOCATION); return;
        }
        if (Build.VERSION.SDK_INT >= 29 && checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            if (Build.VERSION.SDK_INT == 29) {
                requestPermissions(new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, ASK_BACKGROUND);
            } else {
                new AlertDialog.Builder(this).setTitle("Allow location all the time")
                    .setMessage("DumbPark only uses your location to remind you after five minutes near the parking lot or office. In Settings, open Location and choose Allow all the time.")
                    .setPositiveButton("Open settings", (dialog, which) -> {
                        Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                        startActivityForResult(settings, BACKGROUND_SETTINGS);
                    }).setNegativeButton("Not now", (dialog, which) -> finishReminder("Allow location all the time to enable arrival reminders."))
                    .show();
            }
            return;
        }
        try {
            reminderRegistrationInProgress = true;
            ArrivalGeofences.register(this, task -> {
                reminderRegistrationInProgress = false;
                try {
                    if (task.isSuccessful()) {
                        ArrivalGeofences.setEnabled(this, true);
                        finishReminder(null);
                    } else finishReminder("Could not register arrival reminders: " + task.getException().getMessage());
                } catch (Exception error) { finishReminder(error.getMessage()); }
            });
        } catch (Exception error) {
            reminderRegistrationInProgress = false;
            finishReminder(error.getMessage());
        }
    }

    private void finishReminder(String message) {
        String id = reminderCallId;
        reminderCallId = null;
        try {
            ArrivalGeofences.setSetupPending(this, false);
            JSONObject status = reminderStatus();
            if (message != null) status.put("message", message);
            if (id != null) reply(id, status, null);
            js("window.dumbParkNativeReminderChanged?.()");
        } catch (Exception error) {
            if (id != null) reply(id, null, error.getMessage());
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(requestCode, permissions, grants);
        if (requestCode == ASK_LOCATION || requestCode == ASK_BACKGROUND || requestCode == ASK_NOTIFICATIONS) {
            boolean granted = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) continueReminderSetup();
            else finishReminder("Permission denied. Enable precise location, background location and notifications to use reminders.");
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == BACKGROUND_SETTINGS) {
            if (ArrivalGeofences.permissionsGranted(this)) continueReminderSetup();
            else finishReminder("Choose Allow all the time for Location in Android Settings, then tap Enable again.");
        }
    }

    private void openChallenge(String rawUrl) throws Exception {
        Uri uri = Uri.parse(rawUrl);
        if (!"https".equals(uri.getScheme()) || !"parko.giantleap.no".equals(uri.getHost()) ||
            !"/client-challenge.html".equals(uri.getPath())) throw new IllegalArgumentException("Unexpected verification page.");
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            throw new IllegalStateException("Update Android System WebView to use SmartPark verification.");
        }
        challenge = new WebView(this);
        challenge.getSettings().setJavaScriptEnabled(true);
        challenge.getSettings().setDomStorageEnabled(true);
        challenge.addJavascriptInterface(new ChallengeBridge(), "SmartParkChallenge");
        WebViewCompat.addDocumentStartJavaScript(challenge,
            "window.webkit={messageHandlers:{handleToken:{postMessage:function(x){SmartParkChallenge.postToken(String(x))}},handleError:{postMessage:function(x){SmartParkChallenge.postError(String(x))}}}};",
            Collections.singleton(SMARTPARK_ORIGIN));
        challenge.setWebChromeClient(new WebChromeClient());
        challenge.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri next = request.getUrl();
                return !"https".equals(next.getScheme()) || !"parko.giantleap.no".equals(next.getHost()) ||
                    !"/client-challenge.html".equals(next.getPath());
            }
        });
        challengeDialog = new AlertDialog.Builder(this).setTitle("SmartPark verification")
            .setView(challenge).setNegativeButton("Cancel", (d, which) -> {}).create();
        challengeDialog.setOnDismissListener(d -> {
            if (challenge != null) { challenge.destroy(); challenge = null; }
            challengeDialog = null;
        });
        challengeDialog.show();
        challenge.loadUrl(rawUrl);
    }

    private final class ChallengeBridge {
        @JavascriptInterface public void postToken(String token) {
            if (token == null || token.length() < 20 || token.length() > 8192) return;
            js("window.dumbParkNativeChallengeComplete(" + JSONObject.quote(token) + ")");
            runOnUiThread(() -> { if (challengeDialog != null) challengeDialog.dismiss(); });
        }
        @JavascriptInterface public void postError(String message) {
            js("window.dumbParkChallengeError(" + JSONObject.quote(String.valueOf(message).substring(0, Math.min(String.valueOf(message).length(), 100))) + ")");
        }
    }

    private final class DashboardBridge {
        @JavascriptInterface public String readState() { return store.read(); }
        @JavascriptInterface public String writeState(String state) {
            try { store.write(state); return "ok"; }
            catch (Exception error) { return "Could not save encrypted state."; }
        }
        @JavascriptInterface public void call(String id, String method, String raw) {
            try {
                JSONObject payload = new JSONObject(raw);
                switch (method) {
                    case "request": network.execute(() -> performRequest(id, payload)); break;
                    case "openChallenge": runOnUiThread(() -> {
                        try { openChallenge(payload.getString("url")); reply(id, true, null); }
                        catch (Exception error) { reply(id, null, error.getMessage()); }
                    }); break;
                    case "reminderStatus": reply(id, reminderStatus(), null); break;
                    case "enableReminders": runOnUiThread(() -> {
                        try {
                            if (ArrivalGeofences.enabled(MainActivity.this) && ArrivalGeofences.permissionsGranted(MainActivity.this) &&
                                ArrivalGeofences.playServicesAvailable(MainActivity.this)) {
                                reply(id, reminderStatus(), null);
                            } else {
                                ArrivalGeofences.setEnabled(MainActivity.this, false);
                                ArrivalGeofences.setSetupPending(MainActivity.this, true);
                                reminderCallId = id;
                                continueReminderSetup();
                            }
                        } catch (Exception error) { reply(id, null, error.getMessage()); }
                    }); break;
                    case "disableReminders": runOnUiThread(() -> {
                        try {
                            ArrivalGeofences.setEnabled(MainActivity.this, false);
                            ArrivalGeofences.setSetupPending(MainActivity.this, false);
                            WorkManager.getInstance(MainActivity.this).cancelUniqueWork("arrival-permit-check");
                            getSystemService(NotificationManager.class).cancel(40);
                            try { ArrivalGeofences.unregister(MainActivity.this); } catch (Exception ignored) { }
                            reply(id, reminderStatus(), null);
                            js("window.dumbParkNativeReminderChanged?.()");
                        } catch (Exception error) { reply(id, null, error.getMessage()); }
                    }); break;
                    case "consumeBookingIntent": runOnUiThread(() -> {
                        boolean value = pendingBooking;
                        pendingBooking = false;
                        reply(id, value, null);
                    }); break;
                    default: reply(id, null, "Unknown Android action.");
                }
            } catch (Exception error) { reply(id, null, error.getMessage()); }
        }
    }

    private void performRequest(String id, JSONObject payload) {
        try {
            reply(id, SmartParkApi.request(payload.getString("url"), payload.optString("method", "GET"),
                payload.getJSONObject("headers"), payload.optString("body", "")), null);
        } catch (Exception error) { reply(id, null, "SmartPark request failed: " + error.getMessage()); }
    }

    @Override protected void onDestroy() {
        network.shutdownNow();
        if (dashboard != null) dashboard.destroy();
        super.onDestroy();
    }
}
