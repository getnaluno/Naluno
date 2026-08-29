package com.naluno.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Criteria;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * Reports this phone's place to Firestore while Find Naluno is on.
 * Runs as a location foreground service so the WebView does not need to be open.
 * A powered-off phone cannot report — last ping is what remains.
 */
public class BeaconFindService extends Service implements LocationListener {

  public static final String PREFS = "naluno_find";
  public static final String CHANNEL_ID = "naluno_find";
  public static final String ACTION_PING_NOW = "com.naluno.app.PING_NOW";
  public static final int NOTIFICATION_ID = 44021;
  public static volatile boolean running = false;

  private static final long PING_MS = 3 * 60 * 1000L;

  /** SECURITY FIX (found reading the live repo): persistAuth() below stores a
   *  Firebase refresh token — a long-lived credential that can mint fresh ID
   *  tokens indefinitely, i.e. ongoing re-authentication as that person,
   *  until explicitly revoked server-side — in plain, unencrypted
   *  SharedPreferences. Combined with android:allowBackup="true" (also fixed,
   *  in AndroidManifest.xml), this meant the token could be pulled off the
   *  device via `adb backup` with no root required, or read directly on a
   *  rooted device. Routes every read/write through Android's own
   *  Keystore-backed EncryptedSharedPreferences instead — the standard,
   *  documented AndroidX Security approach for exactly this case — with a
   *  narrow fallback to plain prefs only if the encrypted store genuinely
   *  can't be created (a real possibility on some older/unusual devices),
   *  so a Keystore hiccup degrades rather than crashes the service; that
   *  fallback path is logged so it's visible, not silent.
   *  Requires the `androidx.security:security-crypto` Gradle dependency —
   *  this repository holds Android source files but not the Gradle project
   *  itself, so this could not be added or compiled against here. Add:
   *    implementation "androidx.security:security-crypto:1.1.0-alpha06"
   *  to the app module's build.gradle before this can build. */
  private static SharedPreferences securePrefs(Context ctx){
    try{
      androidx.security.crypto.MasterKey masterKey =
        new androidx.security.crypto.MasterKey.Builder(ctx)
          .setKeyScheme(androidx.security.crypto.MasterKey.KeyScheme.AES256_GCM)
          .build();
      return androidx.security.crypto.EncryptedSharedPreferences.create(
        ctx,
        PREFS,
        masterKey,
        androidx.security.crypto.EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        androidx.security.crypto.EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
      );
    }catch(Exception e){
      android.util.Log.w("BeaconFindService", "Encrypted prefs unavailable, falling back to plain (device/Keystore issue): " + e);
      return ctx.getSharedPreferences(PREFS, MODE_PRIVATE);
    }
  }

  private Handler handler;
  private LocationManager locationManager;
  private PowerManager.WakeLock wakeLock;
  private Location lastFix;

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel();
    handler = new Handler(Looper.getMainLooper());
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "naluno:find");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(6 * 60 * 60 * 1000L);
      }
    } catch (Exception ignored) {}
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    running = true;
    startAsLocationForeground();
    startUpdates();
    boolean now = intent != null && ACTION_PING_NOW.equals(intent.getAction());
    if (now) requestOneShot();
    handler.removeCallbacks(pingRunnable);
    handler.post(pingRunnable);
    return START_STICKY;
  }

  @Override
  public void onDestroy() {
    running = false;
    handler.removeCallbacks(pingRunnable);
    stopUpdates();
    try {
      if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    } catch (Exception ignored) {}
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  public static void persistAuth(Context ctx, String uid, String refreshToken,
                                 String apiKey, String projectId, String deviceId, String label) {
    SharedPreferences.Editor e = securePrefs(ctx).edit();
    e.putBoolean("on", true);
    if (uid != null) e.putString("uid", uid);
    if (refreshToken != null) e.putString("refresh", refreshToken);
    if (apiKey != null) e.putString("apiKey", apiKey);
    if (projectId != null) e.putString("projectId", projectId);
    if (deviceId != null) e.putString("deviceId", deviceId);
    if (label != null) e.putString("label", label);
    e.apply();
  }

  public static void clearAuth(Context ctx) {
    securePrefs(ctx).edit().putBoolean("on", false).apply();
  }

  public static boolean isEnabled(Context ctx) {
    return securePrefs(ctx).getBoolean("on", false);
  }

  private void startAsLocationForeground() {
    Notification n = buildNotification();
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
      } else {
        startForeground(NOTIFICATION_ID, n);
      }
    } catch (Exception e) {
      try { startForeground(NOTIFICATION_ID, n); } catch (Exception ignored) {}
    }
  }

  private void startUpdates() {
    if (!hasLocationPermission()) return;
    try {
      locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
      if (locationManager == null) return;
      lastFix = bestLastKnown();
      if (lastFix != null) postPingAsync(lastFix);
      String[] providers = new String[] {
        fusedName(),
        LocationManager.NETWORK_PROVIDER,
        LocationManager.GPS_PROVIDER,
        LocationManager.PASSIVE_PROVIDER
      };
      for (int i = 0; i < providers.length; i++) {
        String p = providers[i];
        if (p == null) continue;
        try {
          if (locationManager.isProviderEnabled(p)) {
            locationManager.requestLocationUpdates(p, 30000, 12, this, Looper.getMainLooper());
          }
        } catch (Exception ignored) {}
      }
      try {
        Criteria c = new Criteria();
        c.setAccuracy(Criteria.ACCURACY_COARSE);
        c.setPowerRequirement(Criteria.POWER_LOW);
        locationManager.requestLocationUpdates(30000, 12, c, this, Looper.getMainLooper());
      } catch (Exception ignored) {}
    } catch (SecurityException ignored) {}
  }

  private String fusedName() {
    if (Build.VERSION.SDK_INT >= 31) return LocationManager.FUSED_PROVIDER;
    return "fused";
  }

  private Location bestLastKnown() {
    Location best = null;
    String[] providers = new String[] { fusedName(), LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER };
    for (int i = 0; i < providers.length; i++) {
      try {
        Location l = locationManager.getLastKnownLocation(providers[i]);
        if (l == null) continue;
        if (best == null || l.getTime() > best.getTime()) best = l;
      } catch (Exception ignored) {}
    }
    return best;
  }

  private void requestOneShot() {
    if (!hasLocationPermission() || locationManager == null) {
      try {
        locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
      } catch (Exception ignored) {}
    }
    if (locationManager == null || !hasLocationPermission()) return;
    Location known = bestLastKnown();
    if (known != null) {
      lastFix = known;
      postPingAsync(known);
    }
    if (Build.VERSION.SDK_INT >= 30) {
      String[] providers = new String[] { fusedName(), LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER };
      for (int i = 0; i < providers.length; i++) {
        final String p = providers[i];
        try {
          locationManager.getCurrentLocation(p, null, getMainExecutor(), new java.util.function.Consumer<Location>() {
            @Override public void accept(Location loc) {
              if (loc == null) return;
              lastFix = loc;
              postPingAsync(loc);
            }
          });
        } catch (Exception ignored) {}
      }
    }
  }

  private void postPingAsync(final Location loc) {
    if (loc == null) return;
    new Thread(new Runnable() {
      @Override public void run() { postPing(loc); }
    }, "naluno-find-ping").start();
  }

  private void stopUpdates() {
    try {
      if (locationManager != null) locationManager.removeUpdates(this);
    } catch (Exception ignored) {}
  }

  private boolean hasLocationPermission() {
    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
      return true;
    }
    return checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }

  @Override
  public void onLocationChanged(Location location) {
    if (location == null) return;
    lastFix = location;
    postPingAsync(location);
  }

  @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
  @Override public void onProviderEnabled(String provider) {}
  @Override public void onProviderDisabled(String provider) {}

  private final Runnable pingRunnable = new Runnable() {
    @Override
    public void run() {
      final Location loc = lastFix;
      new Thread(new Runnable() {
        @Override
        public void run() {
          if (loc != null) postPing(loc);
        }
      }, "naluno-find-ping").start();
      handler.postDelayed(this, PING_MS);
    }
  };

  private void postPing(Location loc) {
    SharedPreferences p = securePrefs(this);
    if (!p.getBoolean("on", false)) return;
    String uid = p.getString("uid", "");
    String refresh = p.getString("refresh", "");
    String apiKey = p.getString("apiKey", "");
    String projectId = p.getString("projectId", "");
    String deviceId = p.getString("deviceId", "android");
    String label = p.getString("label", "Android");
    if (uid.isEmpty() || refresh.isEmpty() || apiKey.isEmpty() || projectId.isEmpty()) return;

    String idToken = refreshIdToken(apiKey, refresh);
    if (idToken == null || idToken.isEmpty()) return;

    try {
      String path = "https://firestore.googleapis.com/v1/projects/" + projectId
          + "/databases/(default)/documents/users/" + enc(uid) + "/beacons/" + enc(deviceId)
          + "?updateMask.fieldPaths=lat&updateMask.fieldPaths=lng"
          + "&updateMask.fieldPaths=accuracy&updateMask.fieldPaths=ts"
          + "&updateMask.fieldPaths=label&updateMask.fieldPaths=deviceId"
          + "&updateMask.fieldPaths=enabled&updateMask.fieldPaths=source";
      String body = "{"
          + "\"fields\":{"
          + "\"lat\":{\"doubleValue\":" + loc.getLatitude() + "},"
          + "\"lng\":{\"doubleValue\":" + loc.getLongitude() + "},"
          + "\"accuracy\":{\"doubleValue\":" + loc.getAccuracy() + "},"
          + "\"ts\":{\"integerValue\":\"" + loc.getTime() + "\"},"
          + "\"label\":{\"stringValue\":" + jsonStr(label) + "},"
          + "\"deviceId\":{\"stringValue\":" + jsonStr(deviceId) + "},"
          + "\"enabled\":{\"booleanValue\":true},"
          + "\"source\":{\"stringValue\":\"native\"}"
          + "}}";
      HttpURLConnection c = (HttpURLConnection) new URL(path).openConnection();
      c.setRequestMethod("PATCH");
      c.setRequestProperty("Authorization", "Bearer " + idToken);
      c.setRequestProperty("Content-Type", "application/json");
      c.setDoOutput(true);
      c.setConnectTimeout(20000);
      c.setReadTimeout(20000);
      OutputStream os = c.getOutputStream();
      os.write(body.getBytes(StandardCharsets.UTF_8));
      os.close();
      c.getResponseCode();
      c.disconnect();
    } catch (Exception ignored) {}
  }

  private String refreshIdToken(String apiKey, String refreshToken) {
    try {
      URL url = new URL("https://securetoken.googleapis.com/v1/token?key=" + enc(apiKey));
      HttpURLConnection c = (HttpURLConnection) url.openConnection();
      c.setRequestMethod("POST");
      c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
      c.setDoOutput(true);
      c.setConnectTimeout(20000);
      c.setReadTimeout(20000);
      String form = "grant_type=refresh_token&refresh_token=" + enc(refreshToken);
      OutputStream os = c.getOutputStream();
      os.write(form.getBytes(StandardCharsets.UTF_8));
      os.close();
      int code = c.getResponseCode();
      BufferedReader br = new BufferedReader(new InputStreamReader(
          code >= 400 ? c.getErrorStream() : c.getInputStream(), StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      String line;
      while ((line = br.readLine()) != null) sb.append(line);
      br.close();
      c.disconnect();
      String json = sb.toString();
      int i = json.indexOf("\"id_token\"");
      if (i < 0) return null;
      int c0 = json.indexOf(':', i);
      int q1 = json.indexOf('"', c0 + 1);
      int q2 = json.indexOf('"', q1 + 1);
      if (q1 < 0 || q2 < 0) return null;
      return json.substring(q1 + 1, q2);
    } catch (Exception e) {
      return null;
    }
  }

  private static String enc(String s) {
    try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
  }

  private static String jsonStr(String s) {
    if (s == null) return "\"\"";
    return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
  }

  private Notification buildNotification() {
    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      b = new Notification.Builder(this, CHANNEL_ID);
    } else {
      b = new Notification.Builder(this);
      b.setPriority(Notification.PRIORITY_LOW);
    }
    return b.setContentTitle("Find Naluno")
        .setContentText("This phone can be found while it is on.")
        .setSmallIcon(android.R.drawable.ic_menu_mylocation)
        .setOngoing(true)
        .build();
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel ch = new NotificationChannel(
        CHANNEL_ID, "Find Naluno", NotificationManager.IMPORTANCE_LOW);
    ch.setDescription("Keeps a last-known place while this phone is on");
    nm.createNotificationChannel(ch);
  }
}
