package no.dumbpark.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.tasks.OnCompleteListener;
import java.util.Arrays;

final class ArrivalGeofences {
    static final int RADIUS_METRES = 200;
    static final int DWELL_MILLIS = 5 * 60 * 1000;
    private static final String PREFS = "arrival-reminders";
    private ArrivalGeofences() {}

    static boolean enabled(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false);
    }

    static boolean permissionsGranted(Context context) {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT >= 29 && context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) return false;
        return Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean playServicesAvailable(Context context) {
        return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS;
    }

    private static Geofence fence(String id, double latitude, double longitude) {
        return new Geofence.Builder().setRequestId(id)
            .setCircularRegion(latitude, longitude, RADIUS_METRES)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
            .setLoiteringDelay(DWELL_MILLIS)
            .setNotificationResponsiveness(5 * 60 * 1000)
            .setExpirationDuration(Geofence.NEVER_EXPIRE).build();
    }

    private static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, GeofenceReceiver.class);
        return PendingIntent.getBroadcast(context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    static void register(Context context, OnCompleteListener<Void> listener) {
        if (!permissionsGranted(context) || !playServicesAvailable(context)) {
            throw new IllegalStateException("Precise background location, notifications, and Google Play services are required.");
        }
        GeofencingRequest request = new GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_DWELL)
            .addGeofences(Arrays.asList(
                fence("parking-lot", 63.3994293, 10.3980961),
                fence("office", 63.3984618, 10.3956557)))
            .build();
        try {
            LocationServices.getGeofencingClient(context).addGeofences(request, pendingIntent(context))
                .addOnCompleteListener(listener);
        } catch (SecurityException error) { throw new IllegalStateException("Location permission was revoked.", error); }
    }

    static void setEnabled(Context context, boolean enabled) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("enabled", enabled).apply();
    }
}
