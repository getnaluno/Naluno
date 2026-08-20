package com.naluno.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
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
        Intent i = new Intent(MainActivity.this, BeaconFindService.class);
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
    public void stopFindNaluno() {
      try {
        BeaconFindService.clearAuth(MainActivity.this);
        stopService(new Intent(MainActivity.this, BeaconFindService.class));
      } catch (Exception e) {
        // best-effort
      }
    }
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
