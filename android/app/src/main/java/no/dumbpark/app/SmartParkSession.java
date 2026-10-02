package no.dumbpark.app;

import org.json.JSONObject;

// The background worker has no WebView. This adapter renews its read-only API session.
final class SmartParkSession {
    interface Transport { JSONObject request(String path, String method, String token, String body) throws Exception; }
    interface StateStore {
        String read();
        String renewToken(String refreshToken, String rejectedToken, String newToken) throws Exception;
    }

    private final Transport transport;
    private final StateStore store;

    SmartParkSession(Transport transport, StateStore store) {
        this.transport = transport;
        this.store = store;
    }

    JSONObject request(String path, String method, String body) throws Exception {
        JSONObject session = new JSONObject(store.read()).getJSONObject("session");
        String token = session.optString("token", "");
        if (token.isEmpty()) throw new IllegalStateException("SmartPark sign-in required.");
        JSONObject response = transport.request(path, method, token, body);
        JSONObject data = parse(response);
        if (response.getInt("status") == 401 || "SESSION_NOT_FOUND".equals(data.optString("errorCode"))) {
            String refreshToken = session.optString("refreshToken", "");
            if (refreshToken.isEmpty()) throw new IllegalStateException("SmartPark sign-in expired.");
            // SmartPark's public Android client identifier, not an account secret.
            String renewal = new JSONObject().put("refreshToken", refreshToken)
                .put("clientIdentifier", "SNWKJJSP7NZ4J1DY").toString();
            JSONObject renewed = success(transport.request("client/reauth", "POST", token, renewal));
            String newToken = renewed.optString("token", "");
            if (newToken.isEmpty()) throw new IllegalStateException("SmartPark session renewal failed.");
            token = store.renewToken(refreshToken, token, newToken);
            response = transport.request(path, method, token, body);
        }
        return success(response);
    }

    private static JSONObject parse(JSONObject response) {
        try { return new JSONObject(response.getString("body")); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private static JSONObject success(JSONObject response) throws Exception {
        JSONObject data = parse(response);
        if (response.getInt("status") != 200 || !"SUCCESS".equals(data.optString("resultCode"))) {
            throw new IllegalStateException("SmartPark permit check failed.");
        }
        return data;
    }
}
