export interface SSEEvent {
  type: string;
  data: any;
}

// POST-then-stream: opens a fetch stream (SSE-style) for POST bodies.
export function streamPost(url: string, body: any, onEvent: (e: SSEEvent) => void, onError?: (err: Error) => void) {
  const ctrl = new AbortController();
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`stream failed: ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error('stream failed: empty response body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.replace(/^data: /, '');
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* ignore keep-alive/partial */
          }
        }
      }
    })
    .catch((err) => {
      if (!ctrl.signal.aborted) onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  return () => ctrl.abort();
}

export function streamGet(url: string, onEvent: (e: SSEEvent) => void, onError?: (err: Error) => void) {
  const ctrl = new AbortController();
  fetch(url, { signal: ctrl.signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`stream failed: ${res.status} ${res.statusText}`);
      if (!res.body) throw new Error('stream failed: empty response body');
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.replace(/^data: /, '');
          try {
            onEvent(JSON.parse(line));
          } catch {
            /* ignore keep-alive/partial */
          }
        }
      }
    })
    .catch((err) => {
      if (!ctrl.signal.aborted) onError?.(err instanceof Error ? err : new Error(String(err)));
    });
  return () => ctrl.abort();
}
