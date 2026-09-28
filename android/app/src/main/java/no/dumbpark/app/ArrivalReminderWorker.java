package no.dumbpark.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.time.LocalDate;
import java.time.ZoneId;

public final class ArrivalReminderWorker extends Worker {
    private static final String CHANNEL = "arrival-reminders";
    private static final long MAX_DELAY_MILLIS = 20 * 60 * 1000;

    public ArrivalReminderWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        if (!ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return Result.success();
        long triggeredAt = getInputData().getLong("triggeredAt", 0);
        if (triggeredAt <= 0 || System.currentTimeMillis() - triggeredAt > MAX_DELAY_MILLIS) return Result.success();
        try {
            if (PermitReminderChecker.confirmedMissing(context)) postNotification(context);
        } catch (Exception ignored) {
            // A failed or uncertain SmartPark read should not ask for a duplicate booking.
        }
        return Result.success();
    }

    private static synchronized void postNotification(Context context) {
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        String today = LocalDate.now(ZoneId.of("Europe/Oslo")).toString();
        android.content.SharedPreferences prefs = context.getSharedPreferences("arrival-reminders", Context.MODE_PRIVATE);
        if (today.equals(prefs.getString("last-notified-day", ""))) return;

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Work parking reminders", NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(context, MainActivity.class).setAction(MainActivity.ACTION_BOOK_FROM_REMINDER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_dumbpark)
            .setContentTitle("At work? Book your parking")
            .setContentText("Tap to check and book the Tieto P40 permit.")
            .setContentIntent(tap).setAutoCancel(true).build();
        manager.notify(40, notification);
        prefs.edit().putString("last-notified-day", today).apply();
    }
}
