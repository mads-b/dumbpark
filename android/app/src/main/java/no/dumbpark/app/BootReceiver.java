package no.dumbpark.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) ||
            !ArrivalGeofences.enabled(context) || !ArrivalGeofences.permissionsGranted(context)) return;
        PendingResult pending = goAsync();
        try { ArrivalGeofences.register(context, task -> pending.finish()); }
        catch (Exception ignored) { pending.finish(); }
    }
}
