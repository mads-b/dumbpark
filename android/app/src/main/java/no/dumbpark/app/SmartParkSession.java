package no.dumbpark.app;

import org.json.JSONObject;
import java.io.IOException;

// The background worker has no WebView. This adapter renews its read-only API session.
final class SmartParkSession {
    static final class SignInRequiredException extends IllegalStateException {
        SignInRequiredException() { super("SmartPark sign-in required."); }
    }
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
        if (token.isEmpty()) throw new SignInRequiredException();
        JSONObject response = transport.request(path, method, token, body);
        JSONObject data = parse(response);
        if (response.getInt("status") == 401 || "SESSION_NOT_FOUND".equals(data.optString("errorCode"))) {
            String refreshToken = session.optString("refreshToken", "");
            if (refreshToken.isEmpty()) throw new SignInRequiredException();
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
        int status = response.getInt("status");
        if (status == 401 || "SESSION_NOT_FOUND".equals(data.optString("errorCode"))) throw new SignInRequiredException();
        if (status == 429 || status >= 500 || "TEMPORARY_ERROR".equals(data.optString("resultCode"))) {
            throw new IOException("SmartPark is temporarily unavailable.");
        }
        if (status != 200 || !"SUCCESS".equals(data.optString("resultCode"))) {
            throw new IllegalStateException("SmartPark permit check failed.");
        }
        return data;
    }
}
