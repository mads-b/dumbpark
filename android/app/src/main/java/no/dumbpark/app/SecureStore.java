package no.dumbpark.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String ALIAS = "dumbpark-session-v1";
    private static final String PREFS = "secure-state";
    private final Context context;

    SecureStore(Context context) { this.context = context; }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());
        return generator.generateKey();
    }

    synchronized String read() {
        String encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("state", null);
        if (encoded == null) return "{}";
        try {
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length < 29) return "{}";
            byte[] iv = new byte[12];
            System.arraycopy(combined, 0, iv, 0, 12);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(combined, 12, combined.length - 12), StandardCharsets.UTF_8);
        } catch (Exception ignored) { return "{}"; }
    }

    synchronized void write(String plain) throws Exception {
        if (plain == null || plain.length() > 65536) throw new IllegalArgumentException("Invalid saved state.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        byte[] payload = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[iv.length + payload.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(payload, 0, combined, iv.length, payload.length);
        String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);
        if (!context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("state", encoded).commit()) {
            throw new IllegalStateException("Could not save the session.");
        }
    }
}
