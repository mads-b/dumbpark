package no.dumbpark.app;

import android.content.Context;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

final class PermitReminderChecker {
    private static final String TARGET = "tieto booking sluppen p40";
    private static final ZoneId OSLO = ZoneId.of("Europe/Oslo");

    private PermitReminderChecker() {}

    // An uncertain result must never become a prompt to book again.
    static boolean confirmedMissing(Context context) throws Exception {
        JSONObject saved = new JSONObject(new SecureStore(context).read());
        JSONObject session = saved.optJSONObject("session");
        if (session == null) throw new SmartParkSession.SignInRequiredException();
        String token = session.optString("token", "");
        if (token.isEmpty()) throw new SmartParkSession.SignInRequiredException();
        SmartParkSession client = new SmartParkSession(SmartParkApi::sessionRequest, new SecureStore(context));
        String path = session.optString("pathToMyPermits", "");
        if (path.isEmpty()) {
            JSONObject account = client.request("client/account", "GET", null);
            path = account.getJSONArray("parkingServices").getJSONObject(0)
                .getJSONObject("clientServices").getJSONObject("products").getString("pathToMyPermits");
        }
        JSONObject response = client.request(path, "POST", "\"\"");
        JSONObject vehicles = saved.optJSONObject("vehicles");
        String selectedPlate = vehicles == null ? "" : normalizedPlate(vehicles.optString("selectedPlate", ""));
        return confirmedMissing(response.getJSONArray("permits"), selectedPlate, System.currentTimeMillis());
    }

    static boolean confirmedMissing(JSONArray permits, String selectedPlate, long now) throws Exception {
        String normalizedSelectedPlate = normalizedPlate(selectedPlate);
        for (int i = 0; i < permits.length(); i++) {
            JSONObject permit = permits.getJSONObject(i);
            if (!TARGET.equals(permit.optString("name", "").trim().toLowerCase(Locale.ROOT))) continue;
            long expiresAt = timestamp(permit.optString("expiresAt", ""));
            if (expiresAt == Long.MIN_VALUE) return false;
            if (expiresAt <= now) continue;
            String startText = permit.optString("validFrom", "");
            long startsAt = startText.isEmpty() ? Long.MIN_VALUE : timestamp(startText);
            if (startsAt != Long.MIN_VALUE && startsAt > now) continue;
            String bookedPlate = permitPlate(permit);
            if (normalizedSelectedPlate.isEmpty() || bookedPlate.isEmpty() || normalizedSelectedPlate.equals(bookedPlate)) return false;
        }
        return true;
    }

    private static String permitPlate(JSONObject permit) {
        JSONArray fields = permit.optJSONArray("formFields");
        if (fields == null) return "";
        for (int i = 0; i < fields.length(); i++) {
            JSONObject field = fields.optJSONObject(i);
            if (field != null && "plate_number_1".equals(field.optString("name"))) {
                return normalizedPlate(field.optString("value", ""));
            }
        }
        return "";
    }

    private static String normalizedPlate(String plate) {
        return plate.replace(" ", "").replace("-", "").toUpperCase(Locale.ROOT);
    }

    private static long timestamp(String value) {
        if (value == null || value.isEmpty()) return Long.MIN_VALUE;
        try { return Instant.parse(value).toEpochMilli(); } catch (Exception ignored) { }
        try { return OffsetDateTime.parse(value).toInstant().toEpochMilli(); } catch (Exception ignored) { }
        try { return LocalDateTime.parse(value.replace(' ', 'T')).atZone(OSLO).toInstant().toEpochMilli(); }
        catch (Exception ignored) { return Long.MIN_VALUE; }
    }
}
