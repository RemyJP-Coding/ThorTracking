import assert from 'node:assert/strict';
import test from 'node:test';
import { Response as WorkerResponse } from 'miniflare';

import { createDesktopOutboundService } from '../desktop/network.mjs';

const SOURCE_URL = 'https://www.ayntec.com/pages/shipment-dashboard.json';

test('desktop source requests use native networking without forwarding app credentials or stale compression headers', async () => {
  const payload = { page: { body_html: '<p>Fresh shipment data</p>' } };
  const calls = [];
  const service = createDesktopOutboundService({
    fetcher: async (url, options) => {
      calls.push({ url, options });
      // Chromium has already decoded the bytes but can retain upstream headers.
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': '12',
          'Set-Cookie': 'upstream-session=private', 'Cache-Control': 'max-age=3600',
        },
      });
    },
  });
  const response = await service(new Request(SOURCE_URL, {
    headers: { Cookie: 'private=1', Authorization: 'Bearer private', Accept: 'text/html' },
  }));

  assert.ok(response instanceof WorkerResponse, 'the response crosses the Miniflare service boundary');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.has('content-encoding'), false);
  assert.equal(response.headers.has('content-length'), false);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SOURCE_URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.deepEqual([...new Headers(calls[0].options.headers)], [['accept', 'application/json']]);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(calls[0].options.redirect, 'error');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
});

test('desktop networking refuses other destinations and methods before invoking the native fetcher', async () => {
  let calls = 0;
  const service = createDesktopOutboundService({
    fetcher: async () => { calls += 1; return new Response('unexpected'); },
  });
  const denied = [
    { url: 'http://www.ayntec.com/pages/shipment-dashboard.json', method: 'GET' },
    { url: 'https://www.ayntec.com.evil/pages/shipment-dashboard.json', method: 'GET' },
    { url: 'https://user:password@www.ayntec.com/pages/shipment-dashboard.json', method: 'GET' },
    { url: 'https://www.ayntec.com/pages/shipment-dashboard', method: 'GET' },
    { url: `${SOURCE_URL}?anything=1`, method: 'GET' },
    { url: 'http://127.0.0.1/private', method: 'GET' },
    { url: 'thor-track://app/api/shipments', method: 'GET' },
    { url: SOURCE_URL, method: 'POST' },
    { url: SOURCE_URL, method: 'HEAD' },
  ];
  for (const request of denied) {
    const response = await service(request);
    assert.equal(response.status, 403, `${request.method} ${request.url}`);
    await response.body?.cancel();
  }
  assert.equal(calls, 0);
});

test('upstream HTTP errors remain failures rather than becoming live data', async () => {
  const service = createDesktopOutboundService({
    fetcher: async () => new Response('Access denied', { status: 403, headers: { 'Content-Type': 'text/html' } }),
  });
  const response = await service(new Request(SOURCE_URL));
  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'Access denied');
});

test('network failures produce a bounded response even if diagnostics fail', async () => {
  const failure = new TypeError('private low-level connection details');
  const errors = [];
  const service = createDesktopOutboundService({
    fetcher: async () => { throw failure; },
    onError(error) { errors.push(error); throw new Error('diagnostics unavailable'); },
  });
  const response = await service(new Request(SOURCE_URL));
  assert.equal(response.status, 502);
  assert.equal(errors.length, 1);
  assert.equal(errors[0], failure);
  assert.doesNotMatch(await response.text(), /private low-level connection details|diagnostics unavailable/);
});

test('a stalled native request returns a timeout even when its fetcher does not settle on cancellation', { timeout: 2_000 }, async () => {
  let observedSignal;
  const errors = [];
  const service = createDesktopOutboundService({
    timeoutMs: 25,
    onError: error => errors.push(error),
    fetcher: async (_url, { signal }) => {
      observedSignal = signal;
      return new Promise(() => {});
    },
  });
  const response = await service(new Request(SOURCE_URL));
  assert.equal(response.status, 504);
  assert.equal(observedSignal.aborted, true);
  assert.equal(errors.length, 1);
  await response.body?.cancel();
});

test('the deadline includes receiving the source body and cancels a stalled stream', { timeout: 2_000 }, async () => {
  let cancelled = false;
  const service = createDesktopOutboundService({
    timeoutMs: 25,
    fetcher: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"page":')); },
      cancel() { cancelled = true; },
    }), { headers: { 'Content-Type': 'application/json' } }),
  });
  const response = await service(new Request(SOURCE_URL));
  assert.equal(response.status, 504);
  assert.equal(cancelled, true);
  await response.body?.cancel();
});

test('cancelling the worker request cancels its native request', { timeout: 2_000 }, async () => {
  const controller = new AbortController();
  let observedSignal;
  let started;
  const fetching = new Promise(resolve => { started = resolve; });
  const service = createDesktopOutboundService({
    timeoutMs: 1_000,
    fetcher: async (_url, { signal }) => {
      observedSignal = signal;
      started();
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  const pending = service(new Request(SOURCE_URL, { signal: controller.signal }));
  await fetching;
  controller.abort();
  const response = await pending;
  assert.equal(observedSignal.aborted, true);
  assert.ok(response.status >= 400);
  await response.body?.cancel();
});

test('an oversized decoded source is rejected before forwarding it into the app', async () => {
  const errors = [];
  const service = createDesktopOutboundService({
    onError: error => errors.push(error),
    fetcher: async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const response = await service(new Request(SOURCE_URL));
  assert.equal(response.status, 502);
  assert.equal(errors.length, 1);
  assert.ok((await response.arrayBuffer()).byteLength < 1_000);
});
