package no.dumbpark.app;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import com.google.android.gms.tasks.Tasks;
import java.util.concurrent.TimeUnit;

public final class GeofenceRecoveryWorker extends Worker {
    static final String WORK = "arrival-geofence-recovery";

    public GeofenceRecoveryWorker(@NonNull Context context, @NonNull WorkerParameters parameters) {
        super(context, parameters);
    }

    static void schedule(Context context, String reason) {
        if (!ArrivalGeofences.enabled(context)) return;
        ArrivalDiagnostics.prefs(context).edit().putBoolean("registration-ok", false).apply();
        ArrivalDiagnostics.record(context, "registration", "Recovery queued: " + reason);
        WorkManager.getInstance(context).enqueueUniqueWork(WORK, ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(GeofenceRecoveryWorker.class)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build());
    }

    @NonNull @Override public Result doWork() {
        Context context = getApplicationContext();
        if (!ArrivalGeofences.enabled(context)) return Result.success();
        if (!ArrivalGeofences.permissionsGranted(context)) {
            ArrivalDiagnostics.record(context, "registration", "Open DumbPark to restore location or notification permissions.");
            return Result.success();
        }
        try {
            Tasks.await(ArrivalGeofences.registrationTask(context), 25, TimeUnit.SECONDS);
            if (!ArrivalGeofences.enabled(context)) ArrivalGeofences.unregister(context);
            return Result.success();
        } catch (Exception ignored) {
            ArrivalDiagnostics.record(context, "registration", getRunAttemptCount() < 3
                ? "Location service unavailable; recovery will retry."
                : "Recovery failed. Open DumbPark and check Android settings.");
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        }
    }
}
