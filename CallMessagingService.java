package com.naluno.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Handles FCM data messages for incoming calls.
 * Wakes the screen, starts IncomingCallActivity, and posts a full-screen notification.
 */
public class CallMessagingService extends FirebaseMessagingService {

  public static final String CHANNEL_ID = "naluno_incoming_calls";
  public static final int NOTIFICATION_ID = 44001;
  private static final String WAKE_LOCK_TAG = "naluno:incoming_call";

  @Override
  public void onMessageReceived(RemoteMessage message) {
    Map<String, String> data = message.getData();
    if (data == null || data.isEmpty()) return;

    String type = data.get("type");
    boolean isCall = "incoming_call".equals(type)
      || "call".equals(type)
      || data.containsKey("callId")
      || data.containsKey("call_id");

    if (!isCall) return;

    String callId = firstNonEmpty(data.get("callId"), data.get("call_id"));
    String callerName = firstNonEmpty(
      data.get("callerName"),
      data.get("caller_name"),
      data.get("title"),
      data.get("body")
    );
    if (callerName == null || callerName.isEmpty()) callerName = "Incoming call";

    wakeScreen();
    ensureChannel();

    // Try to bring the full-screen UI up immediately.
    try {
      Intent activityIntent = new Intent(this, IncomingCallActivity.class);
      activityIntent.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
      activityIntent.putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName);
      activityIntent.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP
          | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
      );
      startActivity(activityIntent);
    } catch (Exception e) {
      // Fall through to notification full-screen intent.
    }

    showFullScreenCallNotification(callId, callerName);
  }

  @Override
  public void onNewToken(String token) {
    super.onNewToken(token);
    if (token == null || token.isEmpty()) return;
    try {
      getSharedPreferences("naluno_fcm_prefs", MODE_PRIVATE)
        .edit()
        .putString("fcmToken", token)
        .putLong("fcmTokenAt", System.currentTimeMillis())
        .apply();
    } catch (Exception e) {
      // best-effort
    }
  }

  /** JS / MainActivity can read the last native FCM token. */
  public static String readStoredToken(Context ctx) {
    if (ctx == null) return null;
    try {
      return ctx.getSharedPreferences("naluno_fcm_prefs", MODE_PRIVATE).getString("fcmToken", null);
    } catch (Exception e) {
      return null;
    }
  }

  @SuppressWarnings("deprecation")
  private void wakeScreen() {
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm == null) return;
      PowerManager.WakeLock wakeLock = pm.newWakeLock(
        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
          | PowerManager.ACQUIRE_CAUSES_WAKEUP
          | PowerManager.ON_AFTER_RELEASE,
        WAKE_LOCK_TAG
      );
      wakeLock.acquire(45_000L);
    } catch (Exception e) {
      // Best-effort.
    }
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm == null) return;
    // Recreate so importance / sound / bypass-DND updates apply after upgrades.
    nm.deleteNotificationChannel(CHANNEL_ID);

    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      "Incoming calls",
      NotificationManager.IMPORTANCE_HIGH
    );
    channel.setDescription("Naluno incoming call alerts");
    channel.enableVibration(true);
    channel.setVibrationPattern(new long[]{500, 200, 500, 200, 500, 200, 500});
    channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
    channel.setBypassDnd(true);
    try {
      Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
      AudioAttributes audioAttrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build();
      channel.setSound(sound, audioAttrs);
    } catch (Exception e) {
      // Best-effort sound.
    }
    nm.createNotificationChannel(channel);
  }

  private void showFullScreenCallNotification(String callId, String callerName) {
    Intent fullScreen = new Intent(this, IncomingCallActivity.class);
    fullScreen.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
    fullScreen.putExtra(IncomingCallActivity.EXTRA_CALLER_NAME, callerName);
    fullScreen.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= PendingIntent.FLAG_IMMUTABLE;
    }
    PendingIntent fullScreenPi = PendingIntent.getActivity(this, 0, fullScreen, flags);
    PendingIntent contentPi = PendingIntent.getActivity(this, 1, fullScreen, flags);

    Notification.Builder builder;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      builder = new Notification.Builder(this, CHANNEL_ID);
    } else {
      builder = new Notification.Builder(this);
      builder.setPriority(Notification.PRIORITY_MAX);
    }

    builder
      .setSmallIcon(android.R.drawable.ic_menu_call)
      .setContentTitle(callerName)
      .setContentText("Incoming call — Naluno")
      .setCategory(Notification.CATEGORY_CALL)
      .setOngoing(true)
      .setAutoCancel(true)
      .setContentIntent(contentPi)
      .setFullScreenIntent(fullScreenPi, true);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      builder.setVisibility(Notification.VISIBILITY_PUBLIC);
    }

    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (nm != null) {
      nm.notify(NOTIFICATION_ID, builder.build());
    }
  }

  private static String firstNonEmpty(String... values) {
    if (values == null) return null;
    for (String v : values) {
      if (v != null && !v.trim().isEmpty()) return v.trim();
    }
    return null;
  }
}
