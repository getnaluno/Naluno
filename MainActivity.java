package com.naluno.app;

import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Rational;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

/**
 * Capacitor entry activity.
 * GoogleAuth is auto-registered by Capacitor 6 from npm plugins.
 * Call deep-links still forwarded into the web app.
 * Upload keep-alive: JS calls NalunoNative.startUploadKeepAlive so WebView
 * timers are not frozen when the screen is off or Naluno is in the background.
 */
public class MainActivity extends BridgeActivity {

  static volatile WeakReference<MainActivity> live;
  private boolean callArmed = false;
  private boolean pipMicOn = true;
  private boolean pipCamOn = true;
  private AudioFocusRequest callFocus;
  private boolean callStreamsRaised;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    interceptSystemSplash();
    // Lifeline's offline mesh transport (Bluetooth / Wi-Fi, no internet).
    // Must be registered BEFORE super.onCreate so the web layer can see it.
    registerPlugin(NalunoMeshPlugin.class);
    super.onCreate(savedInstanceState);
    live = new WeakReference<MainActivity>(this);
    paintLaunchBackground();
    handleCallIntent(getIntent());
    injectNativeFcmToken();
    injectKeepAliveBridge();
    enableWebViewGeolocation();
    resumeFindNalunoService();
  }

  /** 28o: never show the launcher PNG. Android 12 splash is dismissed instantly;
   *  the window behind it is a dark field so nothing branded can flash. */
  private void interceptSystemSplash() {
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        getSplashScreen().setOnExitAnimationListener(new android.window.SplashScreen.OnExitAnimationListener() {
          @Override
          public void onSplashScreenExit(android.window.SplashScreenView view) {
            try {
              view.animate()
                .alpha(0f)
                .setDuration(220)
                .withEndAction(new Runnable() {
                  @Override public void run() {
                    try { view.remove(); } catch (Exception e) {}
                  }
                })
                .start();
            } catch (Exception e) {
              try { view.setAlpha(0f); } catch (Exception e2) {}
              try { view.remove(); } catch (Exception e2) {}
            }
          }
        });
      } catch (Exception e) {
        // best-effort — older WebView shells
      }
    }
  }

  /** 28n: drop the PNG splash. First paint is a dark field; the HTML logo draws itself. */
  private void paintLaunchBackground() {
    final int bg = 0xFF0D0F17;
    try {
      getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(bg));
      getWindow().getDecorView().setBackgroundColor(bg);
    } catch (Exception e) {
      // best-effort
    }
    getWindow().getDecorView().post(new Runnable() {
      @Override public void run() {
        try {
          android.webkit.WebView wv = getBridge() != null ? getBridge().getWebView() : null;
          if (wv != null) wv.setBackgroundColor(bg);
        } catch (Exception e) {
          // best-effort
        }
      }
    });
  }

  private void resumeFindNalunoService() {
    try {
      if (!BeaconFindService.isEnabled(this)) return;
      Intent i = new Intent(this, BeaconFindService.class);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(i);
      } else {
        startService(i);
      }
    } catch (Exception e) {
      // best-effort
    }
  }

  @Override
  public void onResume() {
    super.onResume();
    paintLaunchBackground();
    injectNativeFcmToken();
    injectKeepAliveBridge();
    enableWebViewGeolocation();
    resumeFindNalunoService();
  }

  @Override
  public void onPause() {
    super.onPause();
    // Capacitor pauses WebView timers here. A live call, including one
    // already in the system Picture-in-Picture window, must keep running.
    if (callArmed || UploadKeepAliveService.running || inPip()) {
      keepWebViewRunning();
    }
  }

  @Override
  public void onStop() {
    super.onStop();
    if (callArmed) keepWebViewRunning();
  }

  @Override
  public void onDestroy() {
    if (live != null && live.get() == this) live = null;
    abandonCallFocus();
    super.onDestroy();
  }

  @Override
  public void onUserLeaveHint() {
    super.onUserLeaveHint();
    if (callArmed) enterCallPip();
  }

  @Override
  public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, android.content.res.Configuration newConfig) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    if (isInPictureInPictureMode) keepWebViewRunning();
    evalJs("window.nalunoPip&&window.nalunoPip.onOs(" + (isInPictureInPictureMode ? "true" : "false") + ")");
  }

  public void onPipAction(String act) {
    if (act == null) return;
    if ("end".equals(act)) {
      evalJs("window.nalunoPip&&window.nalunoPip.act('end')");
      leavePip();
      return;
    }
    if ("mute".equals(act) || "cam".equals(act)) {
      evalJs("window.nalunoPip&&window.nalunoPip.act('" + act + "')");
    }
  }

  /** Loudspeaker is the default. Earpiece is only when the person asks,
   *  so the phone can sit against the ear with the screen black.
   *  Speaker audio is played by the page as media (so the volume keys the
   *  person is already pressing apply). Communication mode is only the
   *  earpiece — that mode ducks media onto the quieter call stream. */
  private void applyCallAudioRoute(String route) {
    try {
      AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
      if (am == null) return;
      if ("clear".equals(route)) {
        callStreamsRaised = false;
        if (Build.VERSION.SDK_INT >= 31) {
          try { am.clearCommunicationDevice(); } catch (Exception e) {}
        }
        try { am.setSpeakerphoneOn(false); } catch (Exception e) {}
        try { am.setMode(AudioManager.MODE_NORMAL); } catch (Exception e) {}
        return;
      }
      boolean ear = "ear".equals(route);
      if (ear) {
        try { am.setMode(AudioManager.MODE_IN_COMMUNICATION); } catch (Exception e) {}
        if (Build.VERSION.SDK_INT >= 31) {
          routeCommunicationDevice(am, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE);
        }
        try { am.setSpeakerphoneOn(false); } catch (Exception e) {}
        return;
      }
      try { am.setMode(AudioManager.MODE_NORMAL); } catch (Exception e) {}
      if (Build.VERSION.SDK_INT >= 31) {
        try { am.clearCommunicationDevice(); } catch (Exception e) {}
      }
      try { am.setSpeakerphoneOn(true); } catch (Exception e) {}
      raiseCallStreams(am);
    } catch (Exception e) {
      // best-effort
    }
  }

  private void routeCommunicationDevice(AudioManager am, int type) {
    try {
      List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
      if (devices == null) return;
      for (int i = 0; i < devices.size(); i++) {
        AudioDeviceInfo d = devices.get(i);
        if (d != null && d.getType() == type) {
          try { am.setCommunicationDevice(d); } catch (Exception e) {}
          return;
        }
      }
    } catch (Exception ignored) {}
  }

  /** If the rocker the person turns is the other stream, the call stays
   *  quiet. Lift a low media or voice level once per call; do not keep
   *  overriding it if they turn it down afterwards. */
  private void raiseCallStreams(AudioManager am) {
    if (callStreamsRaised || am == null) return;
    callStreamsRaised = true;
    raiseStreamFloor(am, AudioManager.STREAM_MUSIC, 0.85f);
    raiseStreamFloor(am, AudioManager.STREAM_VOICE_CALL, 0.85f);
  }

  private void raiseStreamFloor(AudioManager am, int stream, float frac) {
    try {
      int max = am.getStreamMaxVolume(stream);
      if (max <= 0) return;
      int cur = am.getStreamVolume(stream);
      int want = Math.max(1, Math.round(max * frac));
      if (cur < want) am.setStreamVolume(stream, want, 0);
    } catch (Exception ignored) {}
  }

  private void injectKeepAliveBridge() {
    getWindow().getDecorView().postDelayed(new Runnable() {
      @Override
      public void run() {
        try {
          if (getBridge() == null || getBridge().getWebView() == null) return;
          getBridge().getWebView().addJavascriptInterface(
            new KeepAliveBridge(),
            "NalunoNative"
          );
        } catch (Exception e) {
          // already added
        }
      }
    }, 400);
  }

  public class KeepAliveBridge {
    @JavascriptInterface
    public void startUploadKeepAlive(String title) {
      try {
        Intent i = new Intent(MainActivity.this, UploadKeepAliveService.class);
        i.putExtra("title", title != null ? title : "Uploading…");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(i);
        } else {
          startService(i);
        }
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void stopUploadKeepAlive() {
      try {
        stopService(new Intent(MainActivity.this, UploadKeepAliveService.class));
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void startSessionKeepAlive(String kind) {
      try {
        String k = kind != null ? kind : "upload";
        Intent i = new Intent(MainActivity.this, UploadKeepAliveService.class);
        i.putExtra("kind", k);
        String title = "Uploading…";
        if ("video".equals(k)) title = "Video call";
        else if ("voice".equals(k)) title = "Voice call";
        else if ("listen".equals(k)) title = "Reading";
        i.putExtra("title", title);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(i);
        } else {
          startService(i);
        }
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void stopSessionKeepAlive() {
      stopUploadKeepAlive();
    }

    @JavascriptInterface
    public void setCallAudioRoute(String route) {
      final String want = route != null ? route : "speaker";
      runOnUiThread(new Runnable() {
        @Override public void run() { applyCallAudioRoute(want); }
      });
    }

    @JavascriptInterface
    public void clearCallAudioRoute() {
      runOnUiThread(new Runnable() {
        @Override public void run() { applyCallAudioRoute("clear"); }
      });
    }

    @JavascriptInterface
    public void startFindNaluno(String uid, String refreshToken, String apiKey,
                                String projectId, String deviceId, String label) {
      try {
        BeaconFindService.persistAuth(MainActivity.this, uid, refreshToken, apiKey, projectId, deviceId, label);
        runOnUiThread(new Runnable() {
          @Override public void run() {
            requestFindPermissions();
            startFindService(false);
          }
        });
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void pingFindNow() {
      try {
        runOnUiThread(new Runnable() {
          @Override public void run() {
            requestFindPermissions();
            startFindService(true);
          }
        });
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void requestFindPermission() {
      try {
        runOnUiThread(new Runnable() {
          @Override public void run() { requestFindPermissions(); }
        });
      } catch (Exception e) {}
    }

    @JavascriptInterface
    public void stopFindNaluno() {
      try {
        BeaconFindService.clearAuth(MainActivity.this);
        stopService(new Intent(MainActivity.this, BeaconFindService.class));
      } catch (Exception e) {
        // best-effort
      }
    }

    @JavascriptInterface
    public void armCallPip(String on) {
      final boolean yes = "true".equals(on) || "1".equals(on);
      runOnUiThread(new Runnable() {
        @Override public void run() { setCallArmed(yes); }
      });
    }

    @JavascriptInterface
    public void updateCallPip(String mic, String cam) {
      pipMicOn = !"false".equals(mic);
      pipCamOn = !"false".equals(cam);
      runOnUiThread(new Runnable() {
        @Override public void run() { publishPipParams(false); }
      });
    }

    @JavascriptInterface
    public void enterCallPipNow() {
      runOnUiThread(new Runnable() {
        @Override public void run() {
          if (!callArmed) setCallArmed(true);
          enterCallPip();
        }
      });
    }
  }

  private void enableWebViewGeolocation() {
    try {
      if (getBridge() == null || getBridge().getWebView() == null) return;
      WebView wv = getBridge().getWebView();
      WebSettings s = wv.getSettings();
      s.setGeolocationEnabled(true);
      s.setJavaScriptEnabled(true);
    } catch (Exception ignored) {}
  }

  private boolean hasFineOrCoarse() {
    return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
  }

  private void requestFindPermissions() {
    try {
      java.util.ArrayList<String> need = new java.util.ArrayList<String>();
      if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        need.add(Manifest.permission.ACCESS_FINE_LOCATION);
      }
      if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
        need.add(Manifest.permission.ACCESS_COARSE_LOCATION);
      }
      if (Build.VERSION.SDK_INT >= 33
          && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        need.add(Manifest.permission.POST_NOTIFICATIONS);
      }
      if (!need.isEmpty()) {
        requestPermissions(need.toArray(new String[0]), 44021);
      }
      maybeAskIgnoreBattery();
    } catch (Exception ignored) {}
  }

  private void maybeAskIgnoreBattery() {
    try {
      if (Build.VERSION.SDK_INT < 23) return;
      PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
      if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
      Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
      i.setData(Uri.parse("package:" + getPackageName()));
      startActivity(i);
    } catch (Exception ignored) {}
  }

  private void startFindService(boolean pingNow) {
    try {
      Intent i = new Intent(this, BeaconFindService.class);
      if (pingNow) i.setAction(BeaconFindService.ACTION_PING_NOW);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        startForegroundService(i);
      } else {
        startService(i);
      }
    } catch (Exception ignored) {}
  }

  /** Push last FCM token into the WebView so JS can write fcmTokenAndroid to Firestore. */
  private void injectNativeFcmToken() {
    getWindow().getDecorView().postDelayed(new Runnable() {
      @Override
      public void run() {
        try {
          if (getBridge() == null || getBridge().getWebView() == null) return;
          String token = CallMessagingService.readStoredToken(MainActivity.this);
          if (token == null || token.isEmpty()) return;
          String safe = token.replace("\\", "").replace("'", "");
          getBridge().getWebView().evaluateJavascript(
            "(function(t){try{window.__nalunoNativeFcmToken=t;if(window.saveNativeFcmToken)window.saveNativeFcmToken(t);}catch(e){}})('" + safe + "')",
            null
          );
        } catch (Exception e) {
          // best-effort
        }
      }
    }, 1200);
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (intent != null) {
      setIntent(intent);
      handleCallIntent(intent);
    }
  }

  private void handleCallIntent(Intent intent) {
    if (intent == null) return;

    String callId = intent.getStringExtra("callId");
    if ((callId == null || callId.isEmpty()) && intent.getData() != null) {
      callId = intent.getData().getQueryParameter("call");
    }
    if (callId == null || callId.isEmpty()) return;

    final String safe = callId.replace("'", "").replace("\\", "");

    getWindow().getDecorView().postDelayed(new Runnable() {
      @Override
      public void run() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().evaluateJavascript(
          "window.handleIncomingCallFromPush && window.handleIncomingCallFromPush('" + safe + "')",
          null
        );
      }
    }, 800);
  }

  private boolean inPip() {
    if (Build.VERSION.SDK_INT < 26) return false;
    try { return isInPictureInPictureMode(); } catch (Exception e) { return false; }
  }

  private void keepWebViewRunning() {
    try {
      WebView wv = getBridge() != null ? getBridge().getWebView() : null;
      if (wv == null) return;
      wv.onResume();
      wv.resumeTimers();
    } catch (Exception ignored) {}
  }

  private void evalJs(final String js) {
    runOnUiThread(new Runnable() {
      @Override public void run() {
        try {
          WebView wv = getBridge() != null ? getBridge().getWebView() : null;
          if (wv != null) wv.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
      }
    });
  }

  private void setCallArmed(boolean on) {
    callArmed = on;
    if (on) requestCallFocus();
    else abandonCallFocus();
    publishPipParams(false);
    if (!on && inPip()) leavePip();
  }

  private void requestCallFocus() {
    try {
      AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
      if (am == null || Build.VERSION.SDK_INT < 26) return;
      if (callFocus != null) return;
      AudioAttributes attrs = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();
      callFocus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(new AudioManager.OnAudioFocusChangeListener() {
          @Override public void onAudioFocusChange(int focus) {
            boolean back = focus == AudioManager.AUDIOFOCUS_GAIN;
            evalJs("window.nalunoPip&&window.nalunoPip.onFocus(" + (back ? "true" : "false") + ")");
          }
        })
        .build();
      am.requestAudioFocus(callFocus);
    } catch (Exception ignored) {}
  }

  private void abandonCallFocus() {
    try {
      AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
      if (am != null && callFocus != null && Build.VERSION.SDK_INT >= 26) am.abandonAudioFocusRequest(callFocus);
    } catch (Exception ignored) {}
    callFocus = null;
  }

  private PendingIntent pipIntent(String act, int code) {
    Intent i = new Intent(this, CallPipReceiver.class);
    i.putExtra("act", act);
    int flags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
    return PendingIntent.getBroadcast(this, code, i, flags);
  }

  private RemoteAction pipAction(int icon, String title, String act, int code) {
    return new RemoteAction(
      Icon.createWithResource(this, icon),
      title,
      title,
      pipIntent(act, code)
    );
  }

  private void publishPipParams(boolean enter) {
    if (Build.VERSION.SDK_INT < 26) return;
    try {
      PictureInPictureParams.Builder b = new PictureInPictureParams.Builder();
      b.setAspectRatio(new Rational(3, 4));
      ArrayList<RemoteAction> actions = new ArrayList<RemoteAction>();
      actions.add(pipAction(
        pipMicOn ? android.R.drawable.ic_lock_silent_mode_off : android.R.drawable.ic_lock_silent_mode,
        pipMicOn ? "Mute" : "Unmute",
        "mute",
        71
      ));
      actions.add(pipAction(
        android.R.drawable.ic_menu_camera,
        pipCamOn ? "Camera off" : "Camera on",
        "cam",
        72
      ));
      actions.add(pipAction(
        android.R.drawable.ic_menu_close_clear_cancel,
        "End",
        "end",
        73
      ));
      b.setActions(actions);
      if (Build.VERSION.SDK_INT >= 31) {
        b.setAutoEnterEnabled(callArmed);
        b.setSeamlessResizeEnabled(true);
      }
      PictureInPictureParams params = b.build();
      setPictureInPictureParams(params);
      if (enter && callArmed && !inPip()) enterPictureInPictureMode(params);
    } catch (Exception ignored) {}
  }

  private void enterCallPip() {
    if (!callArmed || Build.VERSION.SDK_INT < 26 || inPip()) return;
    publishPipParams(true);
  }

  private void leavePip() {
    if (!inPip()) return;
    try {
      Intent i = new Intent(this, MainActivity.class);
      i.setFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
      startActivity(i);
    } catch (Exception ignored) {}
  }
}
