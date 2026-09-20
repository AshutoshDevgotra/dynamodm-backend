import { AppError } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';

type OtpPurpose = 'verify' | 'reset';

/** Send transactional OTP email through Resend SMTP. */
export async function sendOtpEmail(to: string, otp: string, purpose: OtpPurpose): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = (process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL)?.trim();
  if (!host || !user || !pass || !from) throw new AppError('Resend SMTP email delivery is not configured.', 503);

  const label = purpose === 'verify' ? 'verification' : 'password reset';
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    // Resend's port 465 requires implicit TLS. Port 587 uses STARTTLS.
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from,
    to,
    subject: `DynamoDM ${label} code`,
    text: `Your DynamoDM ${label} code is ${otp}. It expires in 10 minutes.`,
    html: `<p>Your DynamoDM ${label} code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes.</p>`,
  });
}
