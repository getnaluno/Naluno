package com.naluno.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Picture-in-Picture buttons. A broadcast, not an activity launch,
 *  so Mute and End do not pull Naluno out of the floating window. */
public class CallPipReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (intent == null) return;
    MainActivity act = MainActivity.live == null ? null : MainActivity.live.get();
    if (act == null) return;
    act.onPipAction(intent.getStringExtra("act"));
  }
}
