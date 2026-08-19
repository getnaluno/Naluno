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
  public static final int NOTIFICATION_ID = 44021;
  public static volatile boolean running = false;

  private static final long PING_MS = 3 * 60 * 1000L;

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
    startForeground(NOTIFICATION_ID, buildNotification());
    startUpdates();
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
    SharedPreferences.Editor e = ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit();
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
    ctx.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("on", false).apply();
  }

  public static boolean isEnabled(Context ctx) {
    return ctx.getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("on", false);
  }

  private void startUpdates() {
    if (!hasLocationPermission()) return;
    try {
      locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
      if (locationManager == null) return;
      lastFix = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
      if (lastFix == null) lastFix = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
      try {
        locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 45000, 25, this);
      } catch (Exception ignored) {}
      try {
        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 60000, 20, this);
      } catch (Exception ignored) {}
    } catch (SecurityException ignored) {}
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
    SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
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
