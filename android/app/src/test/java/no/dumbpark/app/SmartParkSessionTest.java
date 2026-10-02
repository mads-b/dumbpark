package no.dumbpark.app;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.junit.Test;

public final class SmartParkSessionTest {
    private static JSONObject response(int status, String body) throws Exception {
        return new JSONObject().put("status", status).put("body", body);
    }

    private static final class MemoryStore implements SmartParkSession.StateStore {
        String token = "old";
        public String read() {
            return "{\"session\":{\"token\":\"" + token + "\",\"refreshToken\":\"remember-me\"}}";
        }
        public String renewToken(String refresh, String rejected, String renewed) {
            assertEquals("remember-me", refresh);
            assertEquals("old", rejected);
            token = renewed;
            return token;
        }
    }

    @Test public void backgroundReadRenewsAndUsesPersistedToken() throws Exception {
        MemoryStore store = new MemoryStore();
        int[] calls = {0};
        SmartParkSession client = new SmartParkSession((path, method, token, body) -> {
            calls[0]++;
            if (path.equals("client/reauth")) {
                assertEquals("POST", method);
                JSONObject renewal = new JSONObject(body);
                assertEquals("remember-me", renewal.getString("refreshToken"));
                assertEquals("SNWKJJSP7NZ4J1DY", renewal.getString("clientIdentifier"));
                return response(200, "{\"resultCode\":\"SUCCESS\",\"token\":\"new\"}");
            }
            assertEquals("POST", method);
            assertEquals("\"\"", body);
            if (token.equals("old")) return response(200, "{\"errorCode\":\"SESSION_NOT_FOUND\"}");
            assertEquals("new", store.token);
            return response(200, "{\"resultCode\":\"SUCCESS\",\"permits\":[]}");
        }, store);
        assertEquals(0, client.request("permit/list", "POST", "\"\"").getJSONArray("permits").length());
        assertEquals(3, calls[0]);
        client.request("permit/list", "POST", "\"\"");
        assertEquals(4, calls[0]);
    }

    @Test public void revokedRefreshDoesNotRetryPermitRead() throws Exception {
        int[] calls = {0};
        SmartParkSession client = new SmartParkSession((path, method, token, body) -> {
            calls[0]++;
            return response(401, "{}");
        }, new MemoryStore());
        assertThrows(IllegalStateException.class, () -> client.request("permit/list", "POST", "\"\""));
        assertEquals(2, calls[0]);
    }

    @Test public void unavailableServiceDoesNotRenew() throws Exception {
        int[] calls = {0};
        SmartParkSession client = new SmartParkSession((path, method, token, body) -> {
            calls[0]++;
            return response(503, "{}");
        }, new MemoryStore());
        assertThrows(IllegalStateException.class, () -> client.request("permit/list", "POST", "\"\""));
        assertEquals(1, calls[0]);
    }
}
