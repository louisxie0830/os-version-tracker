import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { APPLE_ROOT_CA } from '../src/fetchers/apple-root-ca.ts';

test('the bundled Apple Root CA is the published certificate and still valid for a while', () => {
  const cert = new X509Certificate(APPLE_ROOT_CA);
  // The fingerprint in Apple's root store list (and in the file's comment)
  assert.equal(cert.fingerprint256, 'B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24');
  assert.match(cert.subject, /CN=Apple Root CA/);
  assert.ok(cert.ca);
  assert.ok(cert.verify(cert.publicKey), 'self-signed root');
  // Fails a year ahead of expiry, so there's time to replace it
  const yearAhead = Date.now() + 365 * 24 * 60 * 60 * 1000;
  assert.ok(new Date(cert.validTo).getTime() > yearAhead, `expires ${cert.validTo}`);
});
