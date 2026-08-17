package com.naluno.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen incoming-call UI shown over the lock screen.
 * Answer → opens MainActivity and hands callId to the web app.
 * Decline → cancels the notification and finishes.
 */
public class IncomingCallActivity extends Activity {

  public static final String EXTRA_CALL_ID = "callId";
  public static final String EXTRA_CALLER_NAME = "callerName";

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true);
      setTurnScreenOn(true);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
      if (km != null) {
        km.requestDismissKeyguard(this, null);
      }
    } else {
      getWindow().addFlags(
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
          | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
          | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      );
    }

    // Extra wake lock for devices that ignore turnScreenOn alone (common on Samsung).
    try {
      PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (pm != null) {
        @SuppressWarnings("deprecation")
        PowerManager.WakeLock wakeLock = pm.newWakeLock(
          PowerManager.SCREEN_BRIGHT_WAKE_LOCK
            | PowerManager.ACQUIRE_CAUSES_WAKEUP
            | PowerManager.ON_AFTER_RELEASE,
          "naluno:incoming_call_activity"
        );
        wakeLock.acquire(30_000L);
      }
    } catch (Exception e) {
      // Best-effort.
    }

    setContentView(buildLayout());

    final String callId = getIntent().getStringExtra(EXTRA_CALL_ID);
    final String callerName = getIntent().getStringExtra(EXTRA_CALLER_NAME);

    TextView nameView = findViewById(1001);
    if (nameView != null) {
      nameView.setText(callerName != null && !callerName.isEmpty() ? callerName : "Incoming call");
    }

    Button answer = findViewById(1002);
    Button decline = findViewById(1003);

    if (answer != null) {
      answer.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View v) {
          Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
          if (launch == null) {
            launch = new Intent(IncomingCallActivity.this, MainActivity.class);
          }
          launch.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
              | Intent.FLAG_ACTIVITY_CLEAR_TOP
              | Intent.FLAG_ACTIVITY_SINGLE_TOP
          );
          if (callId != null && !callId.isEmpty()) {
            launch.putExtra("callId", callId);
            launch.setData(Uri.parse("https://getnaluno.com/?call=" + callId));
          }
          startActivity(launch);

          NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
          if (nm != null) nm.cancel(CallMessagingService.NOTIFICATION_ID);
          finish();
        }
      });
    }

    if (decline != null) {
      decline.setOnClickListener(new View.OnClickListener() {
        @Override
        public void onClick(View v) {
          NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
          if (nm != null) nm.cancel(CallMessagingService.NOTIFICATION_ID);
          finish();
        }
      });
    }
  }

  private android.view.View buildLayout() {
    android.widget.LinearLayout root = new android.widget.LinearLayout(this);
    root.setOrientation(android.widget.LinearLayout.VERTICAL);
    root.setGravity(android.view.Gravity.CENTER);
    root.setBackgroundColor(0xFF0D0F17);
    int pad = (int) (24 * getResources().getDisplayMetrics().density);
    root.setPadding(pad, pad, pad, pad);

    android.widget.TextView eyebrow = new android.widget.TextView(this);
    eyebrow.setText("NALUNO");
    eyebrow.setTextColor(0xFF7CFFB2);
    eyebrow.setTextSize(12);
    eyebrow.setGravity(android.view.Gravity.CENTER);
    root.addView(eyebrow);

    android.widget.TextView name = new android.widget.TextView(this);
    name.setId(1001);
    name.setText("Incoming call");
    name.setTextColor(0xFFEDEFF7);
    name.setTextSize(28);
    name.setGravity(android.view.Gravity.CENTER);
    name.setPadding(0, pad, 0, pad / 2);
    root.addView(name);

    android.widget.TextView status = new android.widget.TextView(this);
    status.setText("incoming call…");
    status.setTextColor(0xFF8B90A8);
    status.setTextSize(14);
    status.setGravity(android.view.Gravity.CENTER);
    root.addView(status);

    android.widget.LinearLayout actions = new android.widget.LinearLayout(this);
    actions.setOrientation(android.widget.LinearLayout.HORIZONTAL);
    actions.setGravity(android.view.Gravity.CENTER);
    actions.setPadding(0, pad * 2, 0, 0);

    Button decline = new Button(this);
    decline.setId(1003);
    decline.setText("Decline");
    decline.setTextColor(0xFFFFFFFF);
    decline.setBackgroundColor(0xFFFF5470);
    android.widget.LinearLayout.LayoutParams lp =
      new android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
    lp.setMargins(pad / 2, 0, pad / 2, 0);
    decline.setLayoutParams(lp);
    actions.addView(decline);

    Button answer = new Button(this);
    answer.setId(1002);
    answer.setText("Answer");
    answer.setTextColor(0xFF0D0F17);
    answer.setBackgroundColor(0xFF7CFFB2);
    answer.setLayoutParams(lp);
    actions.addView(answer);

    root.addView(actions);
    return root;
  }
}
