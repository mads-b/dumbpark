package no.dumbpark.app;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class SmartParkApi {
    private static final String ORIGIN = "https://parko.giantleap.no";
    private SmartParkApi() {}

    static JSONObject headers(String token) throws Exception {
        JSONObject headers = new JSONObject()
            .put("User-Agent", "Android/Cardboard(trondheimparkering-4.11.6)/1.3.39")
            .put("X-PartnerId", "trondheimparkering")
            .put("X-GLTLocale", "en_NO_trondheimparkering")
            .put("Content-Type", "application/json;charset=UTF-8");
        if (token != null && !token.isEmpty()) headers.put("X-Token", token);
        return headers;
    }

    static JSONObject request(String rawUrl, String method, JSONObject headers, String body) throws Exception {
        URL url = new URL(rawUrl);
        if (!"https".equals(url.getProtocol()) || !"parko.giantleap.no".equals(url.getHost()) ||
            url.getPort() != -1 || url.getUserInfo() != null || !url.getPath().startsWith("/")) {
            throw new IllegalArgumentException("Unexpected SmartPark API address.");
        }
        if (!method.equals("GET") && !method.equals("POST")) throw new IllegalArgumentException("Unexpected SmartPark API method.");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod(method);
            for (String name : new String[]{"User-Agent", "X-PartnerId", "X-GLTLocale", "Content-Type", "X-Token", "X-GLT-IDEMPOTENCY-KEY"}) {
                if (headers.has(name)) connection.setRequestProperty(name, headers.getString(name));
            }
            if (method.equals("POST")) {
                connection.setDoOutput(true);
                byte[] bytes = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 65536) throw new IllegalArgumentException("Request is too large.");
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream input = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (input != null) try (InputStream source = input) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = source.read(buffer)) != -1) {
                    if (bytes.size() + n > 2_000_000) throw new IllegalStateException("SmartPark response is too large.");
                    bytes.write(buffer, 0, n);
                }
            }
            return new JSONObject().put("status", status)
                .put("body", new String(bytes.toByteArray(), StandardCharsets.UTF_8));
        } finally { connection.disconnect(); }
    }

    static JSONObject authenticated(String path, String method, String token, String body) throws Exception {
        if (path == null || path.isEmpty() || path.contains("..")) throw new IllegalArgumentException("Invalid SmartPark path.");
        URL url = new URL(new URL(ORIGIN + "/"), path);
        JSONObject response = request(url.toString(), method, headers(token), body);
        if (response.getInt("status") != 200) throw new IllegalStateException("SmartPark permit check failed.");
        JSONObject data = new JSONObject(response.getString("body"));
        if (!"SUCCESS".equals(data.optString("resultCode"))) throw new IllegalStateException("SmartPark permit check failed.");
        return data;
    }
}
