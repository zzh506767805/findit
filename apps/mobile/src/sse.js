function createSseHandler(xhr, onEvent, resolve, reject) {
  let lastIndex = 0;
  let buffer = '';

  function flush(text) {
    buffer += text;
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';

    let eventType = '';
    let dataLines = [];

    for (const line of parts) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        dataLines.push(line.slice(6));
      } else if (line.trim() === '' && eventType && dataLines.length) {
        try {
          const data = JSON.parse(dataLines.join('\n'));
          onEvent({ type: eventType, ...data });
        } catch {}
        eventType = '';
        dataLines = [];
      }
    }
  }

  xhr.onreadystatechange = () => {
    if (xhr.readyState >= 3 && xhr.responseText) {
      const chunk = xhr.responseText.substring(lastIndex);
      lastIndex = xhr.responseText.length;
      if (chunk) flush(chunk);
    }
    if (xhr.readyState === 4) {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(xhr.responseText || `Request failed: ${xhr.status}`));
      }
    }
  };

  xhr.onerror = () => reject(new Error('Network error'));
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

export function streamAgentUpload(apiUrl, token, path, fileUri, mimeType, onEvent) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    const ext = mimeType?.includes('video') ? 'mp4' : 'jpg';
    formData.append('file', { uri: fileUri, type: mimeType, name: `upload.${ext}` });

    const xhr = new XMLHttpRequest();
    createSseHandler(xhr, onEvent, resolve, reject);
    xhr.open('POST', `${apiUrl}${path}`, true);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // Do NOT set Content-Type for FormData — XHR sets multipart boundary automatically
    xhr.send(formData);
  });
}
