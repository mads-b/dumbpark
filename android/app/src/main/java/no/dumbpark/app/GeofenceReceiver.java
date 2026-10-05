package no.dumbpark.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.work.Constraints;
import androidx.work.BackoffPolicy;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;
import com.google.android.gms.location.GeofenceStatusCodes;
import java.util.concurrent.TimeUnit;

public final class GeofenceReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return;
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;
        if (event.hasError()) {
            ArrivalDiagnostics.prefs(context).edit().putBoolean("registration-ok", false).apply();
            ArrivalDiagnostics.record(context, "arrival", "Geofence error " + event.getErrorCode() + "; no arrival check was made.");
            if (event.getErrorCode() == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                GeofenceRecoveryWorker.schedule(context, "location service lost the geofences");
            }
            return;
        }
        if (event.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_DWELL) return;
        ArrivalDiagnostics.record(context, "arrival", "Five-minute dwell received; permit check queued.");
        OneTimeWorkRequest check = new OneTimeWorkRequest.Builder(ArrivalReminderWorker.class)
            .setInputData(new Data.Builder().putLong("triggeredAt", System.currentTimeMillis()).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("arrival-permit-check", ExistingWorkPolicy.KEEP, check);
    }
}
