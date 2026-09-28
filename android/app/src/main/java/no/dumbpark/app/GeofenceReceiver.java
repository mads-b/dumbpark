package no.dumbpark.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

public final class GeofenceReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return;
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError() || event.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_DWELL) return;
        OneTimeWorkRequest check = new OneTimeWorkRequest.Builder(ArrivalReminderWorker.class)
            .setInputData(new Data.Builder().putLong("triggeredAt", System.currentTimeMillis()).build())
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("arrival-permit-check", ExistingWorkPolicy.KEEP, check);
    }
}
