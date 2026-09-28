package no.dumbpark.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.time.Instant;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public final class PermitReminderCheckerTest {
    private static final long NOW = Instant.parse("2026-09-28T09:00:00Z").toEpochMilli();

    private static JSONObject permit(String plate, String end) throws Exception {
        return new JSONObject().put("name", "Tieto Booking Sluppen P40")
            .put("validFrom", "2026-09-28T07:00:00Z")
            .put("expiresAt", end)
            .put("formFields", new JSONArray().put(new JSONObject()
                .put("name", "plate_number_1").put("value", plate)));
    }

    @Test public void activePermitForSelectedCarSuppressesReminder() throws Exception {
        JSONArray permits = new JSONArray().put(permit("AB 12345", "2026-09-28T17:00:00Z"));
        assertFalse(PermitReminderChecker.confirmedMissing(permits, "AB12345", NOW));
    }

    @Test public void activePermitForAnotherCarStillReminds() throws Exception {
        JSONArray permits = new JSONArray().put(permit("AB12345", "2026-09-28T17:00:00Z"));
        assertTrue(PermitReminderChecker.confirmedMissing(permits, "CD54321", NOW));
    }

    @Test public void expiredPermitDoesNotSuppressReminder() throws Exception {
        JSONArray permits = new JSONArray().put(permit("AB12345", "2026-09-28T08:00:00Z"));
        assertTrue(PermitReminderChecker.confirmedMissing(permits, "AB12345", NOW));
    }

    @Test public void unknownExpiryDoesNotCauseReminder() throws Exception {
        JSONArray permits = new JSONArray().put(permit("AB12345", "unreadable"));
        assertFalse(PermitReminderChecker.confirmedMissing(permits, "AB12345", NOW));
    }
}
