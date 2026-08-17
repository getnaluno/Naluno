package com.naluno.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * Capacitor entry activity.
 * GoogleAuth is auto-registered by Capacitor 6 from npm plugins.
 * Call deep-links still forwarded into the web app.
 */
public class MainActivity extends BridgeActivity {

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    handleCallIntent(getIntent());
    injectNativeFcmToken();
  }

  @Override
  public void onResume() {
    super.onResume();
    injectNativeFcmToken();
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
