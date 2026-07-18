import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPayload(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

export function verifySignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (header === undefined) return false;
  const expected = Buffer.from(signPayload(rawBody, secret));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
