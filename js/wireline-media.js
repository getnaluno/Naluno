/* Wireline attachments. Policy is not Broadcast policy.
   The phone classifies a file, refuses it with a reason, then uploads it
   to /w/ on the media worker. Reach passes, Broadcast length limits and
   creator upload quotas are never sent and never applied here.
   Broadcast's own /b/ routes are not used. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NalunoWireMedia = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var LIMITS = {
    batch: 20,
    photo: 25 * 1024 * 1024,
    video: 256 * 1024 * 1024,
    audio: 64 * 1024 * 1024,
    voice: 16 * 1024 * 1024,
    document: 100 * 1024 * 1024,
    perDay: 80,
    bytesPerDay: 1024 * 1024 * 1024,
    concurrent: 3,
  };
  var DOC_EXT = { pdf: 1, doc: 1, docx: 1, xls: 1, xlsx: 1, ppt: 1, pptx: 1, txt: 1, csv: 1, rtf: 1, zip: 1 };
  var DOC_MIME = {
    'application/pdf': 1,
    'application/msword': 1,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1,
    'application/vnd.ms-excel': 1,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1,
    'application/vnd.ms-powerpoint': 1,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 1,
    'text/plain': 1,
    'text/csv': 1,
    'application/rtf': 1,
    'application/zip': 1,
    'application/x-zip-compressed': 1,
  };
  var VIDEO_EXT = { mp4: 1, webm: 1, mov: 1, m4v: 1, '3gp': 1, mkv: 1 };
  var AUDIO_EXT = { mp3: 1, m4a: 1, aac: 1, wav: 1, ogg: 1, opus: 1 };
  var IMAGE_EXT = { jpg: 1, jpeg: 1, png: 1, webp: 1, gif: 1 };

  function extOf(name) {
    var n = String(name || '').toLowerCase();
    var i = n.lastIndexOf('.');
    return i >= 0 ? n.slice(i + 1).replace(/[^a-z0-9]/g, '') : '';
  }
  function mimeOf(file) {
    return String((file && file.type) || '').split(';')[0].trim().toLowerCase();
  }
  function mb(n) {
    return (Math.round((n / (1024 * 1024)) * 10) / 10) + ' MB';
  }

  /* kind is photo | video | audio | voice | document, or '' if refused. */
  function classify(file, hint) {
    if (!file) return { ok: false, error: 'No file' };
    var name = String(file.name || file._nalunoName || '');
    var ext = extOf(name);
    var type = mimeOf(file);
    var size = Number(file.size) || 0;
    if (size < 1) return { ok: false, error: 'That file is empty' };
    var kind = '';
    if (hint === 'voice') kind = 'voice';
    else if (type.indexOf('image/') === 0 || IMAGE_EXT[ext]) kind = 'photo';
    else if (type.indexOf('video/') === 0 || VIDEO_EXT[ext]) kind = 'video';
    else if (hint === 'audio' || type.indexOf('audio/') === 0 || AUDIO_EXT[ext]) kind = 'audio';
    else if (DOC_MIME[type] || DOC_EXT[ext]) kind = 'document';
    else return { ok: false, error: 'That file type is not accepted in a conversation' };
    if (type === 'image/svg+xml' || type === 'text/html' || type.indexOf('javascript') >= 0) {
      return { ok: false, error: 'That file type is not accepted in a conversation' };
    }
    var cap = LIMITS[kind] || 0;
    if (cap && size > cap) {
      return { ok: false, kind: kind, error: 'That ' + kind + ' is ' + mb(size) + '. The Wireline limit is ' + mb(cap) + '.' };
    }
    var contentType = type;
    if (!contentType || contentType === 'application/octet-stream') {
      if (kind === 'photo') contentType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : (ext === 'gif' ? 'image/gif' : 'image/jpeg'));
      else if (kind === 'video') contentType = ext === 'webm' ? 'video/webm' : (ext === 'mov' ? 'video/quicktime' : 'video/mp4');
      else if (kind === 'audio' || kind === 'voice') contentType = ext === 'mp3' ? 'audio/mpeg' : (ext === 'wav' ? 'audio/wav' : (ext === 'm4a' ? 'audio/mp4' : 'audio/webm'));
      else if (ext === 'pdf') contentType = 'application/pdf';
      else if (ext === 'txt') contentType = 'text/plain';
      else if (ext === 'csv') contentType = 'text/csv';
      else if (ext === 'zip') contentType = 'application/zip';
      else if (ext === 'doc') contentType = 'application/msword';
      else if (ext === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (ext === 'xls') contentType = 'application/vnd.ms-excel';
      else if (ext === 'xlsx') contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (ext === 'ppt') contentType = 'application/vnd.ms-powerpoint';
      else if (ext === 'pptx') contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      else if (ext === 'rtf') contentType = 'application/rtf';
      else contentType = 'application/octet-stream';
    }
    return {
      ok: true,
      kind: kind,
      contentType: contentType,
      name: name.slice(0, 120) || (kind + '.' + (ext || 'bin')),
      size: size,
    };
  }

  function planBatch(files, hint) {
    var list = [];
    var input = files || [];
    for (var i = 0; i < input.length; i++) list.push(input[i]);
    var accepted = [];
    var rejected = [];
    if (list.length > LIMITS.batch) {
      list.slice(LIMITS.batch).forEach(function (f) {
        rejected.push({ file: f, error: 'Only ' + LIMITS.batch + ' files can go in one send' });
      });
      list = list.slice(0, LIMITS.batch);
    }
    list.forEach(function (f) {
      var c = classify(f, hint);
      if (!c.ok) rejected.push({ file: f, error: c.error });
      else accepted.push({ file: f, plan: c });
    });
    return { accepted: accepted, rejected: rejected };
  }

  /* Sent is true only after the bytes are stored AND the message is written.
     A failed upload stays retryable and is not Sent.
     A stored file whose message write failed keeps the URL so a retry does not upload again. */
  function delivery(uploadOk, writeOk) {
    if (!uploadOk) return { status: 'failed', sent: false, retry: true, keepUrl: false };
    if (!writeOk) return { status: 'waiting', sent: false, retry: true, keepUrl: true };
    return { status: 'sent', sent: true, retry: false, keepUrl: true };
  }

  /* One item in a batch. retry skips items that already delivered. */
  function stepItem(item, event) {
    var next = Object.assign({}, item || {});
    next.status = (item && item.status) || 'selected';
    next.mediaUrl = (item && item.mediaUrl) || '';
    next.error = (item && item.error) || '';
    next.attempts = (item && item.attempts) || 0;
    if (event === 'upload-ok') {
      next.status = 'uploaded';
      next.error = '';
      return next;
    }
    if (event === 'upload-fail') {
      next.status = 'failed';
      next.attempts += 1;
      next.mediaUrl = '';
      return next;
    }
    if (event === 'write-ok') {
      if (!next.mediaUrl && item.status !== 'uploaded') {
        next.status = 'failed';
        next.error = 'No file';
        return next;
      }
      next.status = 'delivered';
      next.error = '';
      return next;
    }
    if (event === 'write-fail') {
      next.status = next.mediaUrl ? 'uploaded' : 'failed';
      next.attempts += 1;
      return next;
    }
    if (event === 'retry') {
      if (next.status === 'delivered') return next;
      next.status = next.mediaUrl ? 'uploaded' : 'selected';
      next.error = '';
      return next;
    }
    return next;
  }

  /* The tray calls this with whatever sendRealMessage returned.
     Delivered only when the write itself succeeded.
     A timeout or an offline queue keeps the URL and is not Sent. */
  function settleSend(item, result) {
    var url = (result && result.url) || (item && item.mediaUrl) || '';
    var withUrl = Object.assign({}, item, { mediaUrl: url });
    if (result && result.ok) return stepItem(withUrl, 'write-ok');
    var failed = stepItem(withUrl, 'write-fail');
    if (result && (result.timedOut || result.queued)) {
      failed.status = 'queued';
      failed.error = '';
      return failed;
    }
    if (result && result.error) failed.error = result.error;
    return failed;
  }

  function shouldUpload(item) {
    return item && item.status !== 'delivered' && item.status !== 'uploaded' && !item.mediaUrl;
  }

  async function uploadOne(file, plan, onProgress, deps) {
    deps = deps || {};
    var fetchImpl = deps.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchImpl) throw new Error('Upload is not available');
    var base = String(deps.base || (typeof BROADCAST_UPLOAD_WORKER_URL === 'string' ? BROADCAST_UPLOAD_WORKER_URL : 'https://naluno-broadcast-upload.naluno.workers.dev')).replace(/\/+$/, '');
    var auth = deps.auth;
    if (!auth && typeof currentUser !== 'undefined' && currentUser && currentUser.getIdToken) {
      auth = { Authorization: 'Bearer ' + await currentUser.getIdToken(false) };
    }
    if (!auth || !auth.Authorization) throw new Error('Sign in again to send this');
    var size = plan.size;
    var initRes = await fetchImpl(base + '/w/init', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({
        contentType: plan.contentType,
        bytes: size,
        name: plan.name,
        kind: plan.kind,
      }),
    });
    var initBody = await initRes.json().catch(function () { return {}; });
    if (!initRes.ok) {
      var err = new Error(initBody.error || ('Could not start the upload (' + initRes.status + ')'));
      err.limit = initBody.limit || '';
      throw err;
    }
    var key = initBody.key;
    var uploadId = initBody.uploadId;
    if (!key || !uploadId) throw new Error('Upload session missing');
    var chunkBytes = 8 * 1024 * 1024;
    var totalParts = Math.max(1, Math.ceil(size / chunkBytes));
    var parts = [];
    var sent = 0;
    try {
      for (var i = 0; i < totalParts; i++) {
        var start = i * chunkBytes;
        var end = Math.min(size, start + chunkBytes);
        var chunk = file.slice(start, end);
        var part = i + 1;
        if (onProgress) onProgress(sent / size, part, totalParts);
        var partRes = await fetchImpl(base + '/w/part?key=' + encodeURIComponent(key) + '&uploadId=' + encodeURIComponent(uploadId) + '&part=' + part, {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, auth),
          body: chunk,
        });
        var partBody = await partRes.json().catch(function () { return {}; });
        if (!partRes.ok) throw new Error(partBody.error || ('Part ' + part + ' failed'));
        parts.push({ part: part, etag: partBody.etag });
        sent = end;
      }
      if (onProgress) onProgress(0.97, totalParts, totalParts);
      var doneRes = await fetchImpl(base + '/w/complete', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
        body: JSON.stringify({ key: key, uploadId: uploadId, parts: parts, bytes: size }),
      });
      var doneBody = await doneRes.json().catch(function () { return {}; });
      if (!doneRes.ok) throw new Error(doneBody.error || 'Could not finish the upload');
      var url = doneBody.url || '';
      if (!url) throw new Error('Upload finished without a file address');
      if (typeof resolveMediaUrl === 'function') url = resolveMediaUrl(url);
      if (onProgress) onProgress(1, totalParts, totalParts);
      return url;
    } catch (e) {
      try {
        fetchImpl(base + '/w/abort', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
          body: JSON.stringify({ key: key, uploadId: uploadId }),
        }).catch(function () {});
      } catch (_) {}
      throw e;
    }
  }

  return {
    LIMITS: LIMITS,
    classify: classify,
    planBatch: planBatch,
    delivery: delivery,
    stepItem: stepItem,
    settleSend: settleSend,
    shouldUpload: shouldUpload,
    uploadOne: uploadOne,
  };
});
