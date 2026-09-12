import { Response as WorkerResponse } from 'miniflare';

const SOURCE_URL = 'https://www.ayntec.com/pages/shipment-dashboard.json';
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

// Use the desktop's native networking for this public feed. Workerd's outbound
// request is rejected by AYN on Windows even when the same native request works.
export function createDesktopOutboundService({ fetcher, onError = () => {}, timeoutMs = 12_000 }) {
  return async (request) => {
    if (request.method !== 'GET' || request.url !== SOURCE_URL) {
      return new WorkerResponse('This request is not supported.', { status: 403 });
    }
    const controller = new AbortController();
    let timedOut = false;
    let reader;
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const abort = () => {
      const error = new Error(timedOut ? 'The AYN request timed out.' : 'The AYN request was cancelled.');
      controller.abort(error);
      rejectAbort(error);
      void reader?.cancel().catch(() => {});
    };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    request.signal?.addEventListener('abort', abort, { once: true });

    const fetchResponse = async () => {
      if (request.signal?.aborted) {
        abort();
        throw controller.signal.reason;
      }
      const response = await fetcher(SOURCE_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      reader = response.body?.getReader();
      if (controller.signal.aborted) {
        void reader?.cancel().catch(() => {});
        throw controller.signal.reason;
      }
      const chunks = [];
      let length = 0;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > MAX_RESPONSE_BYTES) {
            void reader.cancel().catch(() => {});
            throw new Error('The AYN response exceeded the supported size.');
          }
          chunks.push(value);
        }
      }
      const body = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      // Native fetch has already decoded compressed content. Forwarding its
      // original compression headers would make the worker decode it twice.
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      headers.delete('set-cookie');
      headers.set('cache-control', 'no-store');
      return new WorkerResponse([204, 205, 304].includes(response.status) ? null : body, {
        status: response.status, statusText: response.statusText, headers,
      });
    };

    try {
      return await Promise.race([fetchResponse(), aborted]);
    } catch (error) {
      try { onError(error); } catch { /* Diagnostics must not block archive fallback. */ }
      return new WorkerResponse('Unable to check AYN right now.', { status: timedOut ? 504 : 502 });
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
    }
  };
}
