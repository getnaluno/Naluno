package com.naluno.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
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
    String title = intent != null ? intent.getStringExtra("title") : null;
    if (title == null || title.isEmpty()) title = "Uploading…";
    Notification.Builder b;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      b = new Notification.Builder(this, CHANNEL_ID);
    } else {
      b = new Notification.Builder(this);
      b.setPriority(Notification.PRIORITY_LOW);
    }
    b.setContentTitle("Naluno")
      .setContentText(title)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true);
    startForeground(NOTIFICATION_ID, b.build());
    return START_STICKY;
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
}
