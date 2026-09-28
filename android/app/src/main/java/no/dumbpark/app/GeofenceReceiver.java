package no.dumbpark.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public final class GeofenceReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "arrival-reminders";

    @Override public void onReceive(Context context, Intent intent) {
        if (!ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return;
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError() || event.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_DWELL) return;
        SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        dateFormat.setTimeZone(TimeZone.getTimeZone("Europe/Oslo"));
        String today = dateFormat.format(new Date());
        android.content.SharedPreferences prefs = context.getSharedPreferences("arrival-reminders", Context.MODE_PRIVATE);
        if (today.equals(prefs.getString("last-notified-day", ""))) return;
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Work parking reminders", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(context, MainActivity.class).setAction(MainActivity.ACTION_BOOK_FROM_REMINDER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_dumbpark)
            .setContentTitle("At work? Book your parking")
            .setContentText("Tap to check your Tieto P40 permit and book if needed.")
            .setContentIntent(tap).setAutoCancel(true).build();
        manager.notify(40, notification);
        prefs.edit().putString("last-notified-day", today).apply();
    }
}
