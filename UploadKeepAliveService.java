package com.naluno.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Holds a partial wake lock + foreground notification so Broadcast uploads
 * and JS timers keep running when the screen is off or Naluno is behind another app.
 */
public class UploadKeepAliveService extends Service {

  public static final String CHANNEL_ID = "naluno_uploads";
  public static final int NOTIFICATION_ID = 44012;
  public static volatile boolean running = false;

  private PowerManager.WakeLock wakeLock;

  @Override
  public void onCreate() {
    super.onCreate();
    ensureChannel();
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "naluno:upload");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(30 * 60 * 1000L);
      }
    } catch (Exception e) {
      // best-effort
    }
  }

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    running = true;
    String kind = intent != null ? intent.getStringExtra("kind") : null;
    if (kind == null || kind.isEmpty()) kind = "upload";
    String title = intent != null ? intent.getStringExtra("title") : null;
    if (title == null || title.isEmpty()) {
      if ("video".equals(kind)) title = "Video call";
      else if ("voice".equals(kind)) title = "Voice call";
      else if ("listen".equals(kind)) title = "Reading";
      else title = "Uploading…";
    }
    holdPartial(kind);
    Notification n = buildNotification(title, kind);
    int type = foregroundType(kind);
    try {
      if (Build.VERSION.SDK_INT >= 29 && type != 0) {
        startForeground(NOTIFICATION_ID, n, type);
      } else {
        startForeground(NOTIFICATION_ID, n);
      }
    } catch (Exception first) {
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
          startForeground(NOTIFICATION_ID, n);
        }
      } catch (Exception second) {
        try { startForeground(NOTIFICATION_ID, n); } catch (Exception ignored) {}
      }
    }
    return START_STICKY;
  }

  /** CPU only. A screen lock would keep the display lit; a call and a
   *  reading must continue on a black screen, including against the ear. */
  private void holdPartial(String kind) {
    try {
      if (wakeLock == null) {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "naluno:session");
        wakeLock.setReferenceCounted(false);
      }
      if (wakeLock.isHeld()) wakeLock.release();
      long ms = ("video".equals(kind) || "voice".equals(kind) || "listen".equals(kind))
        ? 6L * 60L * 60L * 1000L
        : 30L * 60L * 1000L;
      wakeLock.acquire(ms);
    } catch (Exception e) {
      // best-effort
    }
  }

  private int foregroundType(String kind) {
    if (Build.VERSION.SDK_INT < 29) return 0;
    if (Build.VERSION.SDK_INT >= 30 && "video".equals(kind)) {
      return ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
        | ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
    }
    if (Build.VERSION.SDK_INT >= 30 && "voice".equals(kind)) {
      return ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
    }
    if ("listen".equals(kind)) return ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
    return ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
  }

  private Notification buildNotification(String title, String kind) {
    boolean call = "video".equals(kind) || "voice".equals(kind);
    String channel = call ? "naluno_calls" : CHANNEL_ID;
    if (call) ensureCallChannel();
    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      b = new Notification.Builder(this, channel);
    } else {
      b = new Notification.Builder(this);
      b.setPriority(Notification.PRIORITY_LOW);
    }
    b.setContentTitle("Naluno")
      .setContentText(title)
      .setSmallIcon(call ? android.R.drawable.ic_menu_call : android.R.drawable.stat_sys_upload)
      .setOngoing(true);
    if (call) b.setCategory(Notification.CATEGORY_CALL);
    try {
      Intent open = new Intent(this, MainActivity.class);
      open.setFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
      b.setContentIntent(PendingIntent.getActivity(this, 44, open, flags));
    } catch (Exception ignored) {}
    return b.build();
  }

  @Override
  public void onDestroy() {
    running = false;
    try {
      if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    } catch (Exception e) { /* ignore */ }
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) {
    return null;
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
    NotificationChannel ch = new NotificationChannel(
      CHANNEL_ID, "Uploads", NotificationManager.IMPORTANCE_LOW
    );
    ch.setDescription("Keeps a Broadcast upload running when the screen is off");
    nm.createNotificationChannel(ch);
  }

  private void ensureCallChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null || nm.getNotificationChannel("naluno_calls") != null) return;
    NotificationChannel ch = new NotificationChannel(
      "naluno_calls", "Calls", NotificationManager.IMPORTANCE_LOW
    );
    ch.setDescription("Keeps a Naluno call connected in the background");
    ch.setSound(null, null);
    nm.createNotificationChannel(ch);
  }
}
