import crypto from 'crypto';

export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + 1);
  return result;
}

export function addOneYear(date: Date): Date {
  const result = new Date(date);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}
