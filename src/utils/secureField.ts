import crypto from 'crypto';

const key = () => Buffer.from((process.env.ENCRYPTION_KEY || '0'.repeat(64)).trim(), 'hex');

export const encryptSensitiveField = (value: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
};
