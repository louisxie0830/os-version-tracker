import type http from 'node:http';
import https from 'node:https';
import { describe, USER_AGENT } from './net.js';

/**
 * A bounded GET over node:https, for the two requests that can't use the fetch API because they need Apple's
 * root CA (fetch can't be given extra roots without a dependency): gdmf.apple.com (fetchers/ios.ts) and the
 * robots.txt check (check-robots.ts).
 *
 * - One absolute deadline covers DNS, connecting, the headers and the whole body. A socket inactivity timeout
 *   alone would not: a server dripping a byte every few seconds would never trip it.
 * - The body is capped: past `maxBytes` the request is destroyed at once (no more bytes are buffered) and it
 *   fails, or with `truncate` keeps the first `maxBytes` (RFC 9309 lets a robots.txt parser stop at a limit).
 * - Settles exactly once; the timer is cleared then, and the request is destroyed whenever it didn't end on
 *   its own. The error listeners stay on the (dead) request and response so a late error can't go unhandled.
 * - Errors name host and path only, and keep the original error (with its code) as the cause.
 */

export interface BoundedGetOptions {
  headers?: Record<string, string>;
  ca?: string[];
  /** Absolute time (ms since the epoch) by which everything must be done; shared across redirects and retries */
  deadline: number;
  maxBytes: number;
  /** What a body over maxBytes means: an error (default), or keep the first maxBytes */
  oversize?: 'fail' | 'truncate';
  /** For tests: http.get against a local server */
  get?: typeof https.get;
}

export interface BoundedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  /** The body was cut at maxBytes (oversize: 'truncate') */
  truncated: boolean;
}

export class DeadlineError extends Error {
  override name = 'DeadlineError';
}

export function boundedGet(url: string, options: BoundedGetOptions): Promise<BoundedResponse> {
  const { deadline, maxBytes, oversize = 'fail', get = https.get } = options;
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return reject(new DeadlineError(`Timed out (deadline passed before the request): ${describe(url)}`));
    let settled = false;
    let req: http.ClientRequest | undefined;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const fail = (err: Error) => settle(() => {
      req?.destroy();
      reject(err);
    });
    const timer = setTimeout(() => fail(new DeadlineError(`Timed out (deadline reached): ${describe(url)}`)), remaining);
    const networkError = (err: Error) => fail(new Error(`${err.message} (${describe(url)})`, { cause: err }));
    try {
      req = get(url, { headers: { 'User-Agent': USER_AGENT, ...options.headers }, ca: options.ca }, res => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        const declared = Number(res.headers['content-length']);
        if (oversize === 'fail' && declared > maxBytes) {
          res.on('error', () => {});
          fail(new Error(`Response of ${declared} bytes is over the ${maxBytes}-byte limit: ${describe(url)}`));
          return;
        }
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size <= maxBytes) {
            chunks.push(chunk);
            return;
          }
          if (oversize === 'truncate') {
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            settle(() => {
              req?.destroy();
              resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: true });
            });
          } else {
            fail(new Error(`Response is over the ${maxBytes}-byte limit: ${describe(url)}`));
          }
        });
        res.on('end', () => settle(() => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), truncated: false })));
        res.on('error', networkError);
        // Closed without 'end' (the connection dropped mid-body) and without an error event
        res.on('close', () => { if (!res.complete) networkError(new Error('connection closed before the response was complete')); });
      });
    } catch (err) {
      // get() throws synchronously for a URL it can't request (e.g. an http: URL given to https.get)
      return fail(err as Error);
    }
    req.on('error', networkError);
  });
}

/** Network errors worth one more try: the connection, not the server's answer or our own deadline */
const TRANSIENT = new Set(['ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
export function isTransient(err: unknown): boolean {
  if (err instanceof DeadlineError) return false;
  for (let e = err as { code?: string; cause?: unknown; message?: string } | undefined; e; e = e.cause as typeof e) {
    if (e.code && TRANSIENT.has(e.code)) return true;
    if (e.message === 'connection closed before the response was complete') return true;
  }
  return false;
}
