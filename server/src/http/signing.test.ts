import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signing.js';

describe('webhook signing', () => {
  it('round-trips an exact raw payload and rejects invalid signatures', () => {
    const raw = JSON.stringify({ event: 'call.completed', callId: 'call-1' });
    const signature = signPayload(raw, 'test-secret');
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(verifySignature(raw, signature, 'test-secret')).toBe(true);
    expect(verifySignature(`${raw} `, signature, 'test-secret')).toBe(false);
    expect(verifySignature(raw, undefined, 'test-secret')).toBe(false);
  });
});
