package com.naluno.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class BeaconBootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    String a = intent.getAction();
    if (a == null) return;
    if (!Intent.ACTION_BOOT_COMPLETED.equals(a)
        && !"android.intent.action.LOCKED_BOOT_COMPLETED".equals(a)
        && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)) {
      return;
    }
    if (!BeaconFindService.isEnabled(context)) return;
    try {
      Intent i = new Intent(context, BeaconFindService.class);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(i);
      } else {
        context.startService(i);
      }
    } catch (Exception ignored) {}
  }
}
