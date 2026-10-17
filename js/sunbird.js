/* ============================================================
   MODULE: js/sunbird.js
   Luganda (and other African languages) via Sunbird AI.
   All calls go through the economy worker so the API key stays
   server-side. TTS re-uses the existing /v1/voice/lg path.
   ============================================================ */
(function (root) {
  'use strict';

  var WORKER = 'https://naluno-economy.naluno.workers.dev';

  function authHeaders(json) {
    var token = null;
    try {
      token = (root.currentUser && root.currentUser.accessToken) ||
              (root.fbAuth && root.fbAuth.currentUser && root.fbAuth.currentUser.accessToken) ||
              (typeof getIdToken === 'function' && getIdToken());
    } catch (_) {}
    var h = {};
    if (json !== false) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function postJson(path, body) {
    var res = await fetch(WORKER + path, {
      method: 'POST',
      headers: authHeaders(true),
      body: JSON.stringify(body || {})
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || data.detail || ('Sunbird ' + res.status));
    return data;
  }

  var api = {
    /* Translate. Defaults eng → lug. Returns { output: { translated_text } } */
    translate: function (text, from, to) {
      return postJson('/v1/sunbird/translate', {
        text: String(text || ''),
        source_language: from || 'eng',
        target_language: to || 'lug'
      });
    },

    /* Speech-to-text. audioBlob = Blob|File. language defaults to 'lug'.
       Returns { audio_transcription, language, ... } */
    transcribe: async function (audioBlob, language) {
      if (!audioBlob) throw new Error('no audio');
      var fd = new FormData();
      fd.append('audio', audioBlob, 'clip.webm');
      fd.append('language', language || 'lug');
      var res = await fetch(WORKER + '/v1/sunbird/transcribe', {
        method: 'POST',
        headers: authHeaders(false),
        body: fd
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.error || data.detail || 'transcription failed');
      return data;
    },

    /* Luganda (or other) AI helper. Returns chat completion shape. */
    chat: function (prompt, language) {
      return postJson('/v1/sunbird/chat', {
        prompt: String(prompt || ''),
        language: language || 'lug'
      });
    },

    /* Text-to-speech. Returns a Blob (audio/wav). Uses existing voice path. */
    speak: async function (text) {
      var res = await fetch(WORKER + '/v1/voice/lg', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ text: String(text || '') })
      });
      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.error || 'speech failed');
      }
      return res.blob();
    },

    /* Convenience: play text immediately. */
    play: async function (text) {
      var blob = await api.speak(text);
      var url = URL.createObjectURL(blob);
      var a = new Audio(url);
      a.onended = function () { try { URL.revokeObjectURL(url); } catch (_) {} };
      await a.play();
      return a;
    }
  };

  root.sunbird = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
