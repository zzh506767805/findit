function createSseHandler(xhr, onEvent, resolve, reject) {
  let lastIndex = 0;
  let buffer = '';
  let eventType = '';
  let dataLines = [];
  let settled = false;

  function responseErrorMessage() {
    try {
      const data = JSON.parse(xhr.responseText || '{}');
      if (data.error) return data.error;
    } catch {}
    return xhr.responseText || `Request failed: ${xhr.status}`;
  }

  function settleSuccess() {
    if (settled) return;
    settled = true;
    resolve();
  }

  function settleError(error) {
    if (settled) return;
    settled = true;
    reject(error instanceof Error ? error : new Error(String(error)));
    try { xhr.abort(); } catch {}
  }

  function dispatchEvent() {
    if (!eventType && !dataLines.length) return;
    if (!eventType || !dataLines.length) {
      eventType = '';
      dataLines = [];
      return;
    }
    try {
      const data = JSON.parse(dataLines.join('\n'));
      if (eventType === 'error') {
        settleError(new Error(data.error || 'Agent failed'));
      } else {
        onEvent({ type: eventType, ...data });
      }
    } catch (err) {
      settleError(err);
    } finally {
      eventType = '';
      dataLines = [];
    }
  }

  function flush(text) {
    buffer += text;
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';

    for (const line of parts) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line.trim() === '') {
        dispatchEvent();
      }
    }
  }

  xhr.onreadystatechange = () => {
    if (settled) return;
    if (xhr.readyState >= 3 && xhr.responseText) {
      const chunk = xhr.responseText.substring(lastIndex);
      lastIndex = xhr.responseText.length;
      if (chunk) flush(chunk);
    }
    if (xhr.readyState === 4) {
      if (xhr.status >= 200 && xhr.status < 300) {
        settleSuccess();
      } else {
        settleError(new Error(responseErrorMessage()));
      }
    }
  };

  xhr.onerror = () => settleError(new Error('Network error'));
}

export function streamAgent(apiUrl, token, path, body, onEvent) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    createSseHandler(xhr, onEvent, resolve, reject);
    xhr.open('POST', `${apiUrl}${path}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(JSON.stringify(body));
  });
}

export function streamAgentUpload(apiUrl, token, path, fileUriOrBlob, mimeType, onEvent) {
  return new Promise(async (resolve, reject) => {
    const formData = new FormData();
    const ext = mimeType?.includes('video') ? 'mp4' : 'jpg';

    if (fileUriOrBlob instanceof Blob) {
      // Web: already a Blob/File object
      formData.append('file', fileUriOrBlob, `upload.${ext}`);
    } else {
      // React Native: { uri, type, name } object
      formData.append('file', { uri: fileUriOrBlob, type: mimeType, name: `upload.${ext}` });
    }

    const xhr = new XMLHttpRequest();
    createSseHandler(xhr, onEvent, resolve, reject);
    xhr.open('POST', `${apiUrl}${path}`, true);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Do NOT set Content-Type for FormData — XHR sets multipart boundary automatically
    xhr.send(formData);
  });
}
