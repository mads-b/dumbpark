package no.dumbpark.app;

import android.app.ActivityManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.location.LocationManager;
import android.os.Build;
import android.os.PowerManager;
import java.text.DateFormat;
import java.util.Date;

// Local milestones only: never save coordinates, plates, credentials or API responses.
final class ArrivalDiagnostics {
    static final String CHANNEL = "arrival-reminders";
    private ArrivalDiagnostics() {}

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("arrival-reminders", Context.MODE_PRIVATE);
    }

    static void record(Context context, String key, String message) {
        prefs(context).edit().putLong(key + "-at", System.currentTimeMillis()).putString(key, message).apply();
    }

    static boolean locationEnabled(Context context) {
        LocationManager manager = context.getSystemService(LocationManager.class);
        return manager != null && (manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
            manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
    }

    static boolean notificationsEnabled(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }

    static boolean backgroundRestricted(Context context) {
        ActivityManager manager = context.getSystemService(ActivityManager.class);
        return Build.VERSION.SDK_INT >= 28 && manager != null && manager.isBackgroundRestricted();
    }

    static String summary(Context context) {
        StringBuilder result = new StringBuilder();
        try {
            result.append("DumbPark ").append(context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0).versionName).append("\n");
        } catch (Exception ignored) { }
        result.append(locationEnabled(context) ? "Device location: on" : "Device location: OFF");
        result.append("\n").append(notificationsEnabled(context) ? "Notifications: allowed" : "Notifications: BLOCKED");
        result.append("\n").append(backgroundRestricted(context) ? "Background activity: RESTRICTED" : "Background activity: no Android restriction reported");
        PowerManager power = context.getSystemService(PowerManager.class);
        if (power != null) {
            result.append("\nBattery saver: ").append(power.isPowerSaveMode() ? "on" : "off");
            result.append("\nBattery optimization: ").append(power.isIgnoringBatteryOptimizations(context.getPackageName()) ? "unrestricted" : "enabled (may delay checks)");
        }
        for (String key : new String[]{"registration", "arrival", "check", "notification"}) {
            long at = prefs(context).getLong(key + "-at", 0);
            result.append("\nLast ").append(key).append(": ");
            if (at == 0) result.append("not recorded");
            else result.append(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(at)))
                .append(" — ").append(prefs(context).getString(key, ""));
        }
        if ("samsung".equalsIgnoreCase(Build.MANUFACTURER)) {
            result.append("\nSamsung: add DumbPark to Battery → Background usage limits → Never sleeping apps. Samsung sleeping lists cannot be checked here.");
        }
        result.append("\nRegistration is the last known result; Android does not expose a live geofence inventory.");
        return result.toString();
    }
}
