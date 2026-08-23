package com.naluno.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor entry activity.
 * GoogleAuth is auto-registered by Capacitor 6 from npm plugins.
 * Call deep-links still forwarded into the web app.
 * Upload keep-alive: JS calls NalunoNative.startUploadKeepAlive so WebView
 * timers are not frozen when the screen is off or Naluno is in the background.
 */
public class MainActivity extends BridgeActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleCallIntent(getIntent());
    injectNativeFcmToken();
    injectKeepAliveBridge();
    enableWebViewGeolocation();
    resumeFindNalunoService();
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
    injectNativeFcmToken();
    injectKeepAliveBridge();
    enableWebViewGeolocation();
    resumeFindNalunoService();
  }

  @Override
  public void onPause() {
    super.onPause();
    // Capacitor pauses WebView timers here — that stops chunked uploads
    // and offline queues on Android 13+. Resume them while a keep-alive is on.
    if (UploadKeepAliveService.running) {
      try {
        WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) {
          wv.onResume();
          wv.resumeTimers();
        }
      } catch (Exception e) {
        // best-effort
      }
    }
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
}
