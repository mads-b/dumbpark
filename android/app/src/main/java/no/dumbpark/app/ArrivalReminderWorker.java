package no.dumbpark.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.time.LocalDate;
import java.time.ZoneId;
import java.io.IOException;

public final class ArrivalReminderWorker extends Worker {
    private static final String CHANNEL = ArrivalDiagnostics.CHANNEL;

    public ArrivalReminderWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        if (!ArrivalGeofences.enabled(context)) return Result.success();
        if (!ArrivalGeofences.permissionsGranted(context)) {
            ArrivalDiagnostics.record(context, "check", "Skipped: background location or notification permission is missing.");
            return Result.success();
        }
        long triggeredAt = getInputData().getLong("triggeredAt", 0);
        if (!ArrivalCheckPolicy.fresh(triggeredAt, System.currentTimeMillis())) {
            ArrivalDiagnostics.record(context, "check", "Skipped: Android delayed this arrival check by over 20 minutes.");
            return Result.success();
        }
        ArrivalDiagnostics.record(context, "check", "Checking SmartPark for an active permit…");
        try {
            if (PermitReminderChecker.confirmedMissing(context)) {
                ArrivalDiagnostics.record(context, "check", "SmartPark confirmed no current permit.");
                postNotification(context);
            } else {
                ArrivalDiagnostics.record(context, "check", "No reminder: a permit exists or its dates could not be verified.");
            }
        } catch (SmartParkSession.SignInRequiredException ignored) {
            ArrivalDiagnostics.record(context, "check", "Sign-in required. Open DumbPark and sign in to SmartPark again.");
        } catch (IOException ignored) {
            boolean retry = ArrivalCheckPolicy.retry(triggeredAt, System.currentTimeMillis(), getRunAttemptCount());
            ArrivalDiagnostics.record(context, "check", retry
                ? "Network or SmartPark temporarily unavailable; this arrival check will retry."
                : "Permit check failed after bounded retries; no notification was sent.");
            return retry ? Result.retry() : Result.success();
        } catch (Exception ignored) {
            ArrivalDiagnostics.record(context, "check", "SmartPark response or saved session could not be verified; no notification was sent.");
        }
        return Result.success();
    }

    private static synchronized void postNotification(Context context) {
        if (!ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return;
        if (!ArrivalDiagnostics.notificationsEnabled(context)) {
            ArrivalDiagnostics.record(context, "notification", "Blocked by Android notification settings.");
            return;
        }
        String today = LocalDate.now(ZoneId.of("Europe/Oslo")).toString();
        android.content.SharedPreferences prefs = context.getSharedPreferences("arrival-reminders", Context.MODE_PRIVATE);
        if (today.equals(prefs.getString("last-notified-day", ""))) {
            ArrivalDiagnostics.record(context, "notification", "Already reminded today; another notification was suppressed.");
            return;
        }

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
        ArrivalDiagnostics.record(context, "notification", "Reminder submitted to Android.");
        prefs.edit().putString("last-notified-day", today).apply();
    }
}
