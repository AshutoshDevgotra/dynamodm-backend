import { AppError } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

type OtpPurpose = 'verify' | 'reset';

/** Send transactional OTP email through SMTP with branded HTML template. */
export async function sendOtpEmail(to: string, otp: string, purpose: OtpPurpose): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = (process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL)?.trim();
  if (!host || !user || !pass || !from) throw new AppError('SMTP email delivery is not configured.', 503);

  const label = purpose === 'verify' ? 'verification' : 'password reset';
  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user, pass },
  });

  // Load branded HTML template
  const templateName = purpose === 'verify' ? 'otp-verification-email.html' : 'password-reset-email.html';
  const templatePath = path.join(__dirname, '../templates', templateName);
  
  let html = `<p>Your OrangeFlow ${label} code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes.</p>`;
  
  try {
    const template = fs.readFileSync(templatePath, 'utf-8');
    html = template.replace(/{{otp}}/g, otp);
  } catch (error) {
    logger.warn(`Failed to load email template ${templateName}, using fallback HTML`);
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject: `OrangeFlow ${label} code`,
      text: `Your OrangeFlow ${label} code is ${otp}. It expires in 10 minutes.`,
      html,
    });
  } catch (error: any) {
    logger.error('SMTP delivery failed', {
      host,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      from,
      code: error?.code,
      responseCode: error?.responseCode,
      response: error?.response,
      message: error?.message,
    });
    throw new AppError('Unable to send the email right now. Please try again later.', 502);
  }
}
