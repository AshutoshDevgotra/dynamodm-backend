import { AppError } from '../middleware/errorHandler';
import nodemailer from 'nodemailer';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

interface SubscriptionEmailData {
  to: string;
  name: string;
  plan: string;
  dmLimit: number;
  amount: number;
  nextBillingDate: string;
}

/** Send branded subscription success email. */
export async function sendSubscriptionSuccessEmail(data: SubscriptionEmailData): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = (process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL)?.trim();
  
  if (!host || !user || !pass || !from) {
    logger.warn('SMTP not configured, skipping subscription success email');
    return;
  }

  const port = Number(process.env.SMTP_PORT || 465);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: { user, pass },
  });

  // Read HTML template
  const templatePath = path.join(__dirname, '../templates/subscription-success-email.html');
  let htmlTemplate: string;
  
  try {
    htmlTemplate = fs.readFileSync(templatePath, 'utf-8');
  } catch (error) {
    logger.error('Failed to read subscription email template', error);
    throw new AppError('Email template not found', 500);
  }

  // Replace variables in template
  const html = htmlTemplate
    .replace(/{{name}}/g, data.name)
    .replace(/{{plan}}/g, data.plan)
    .replace(/{{dmLimit}}/g, data.dmLimit.toString())
    .replace(/{{amount}}/g, data.amount.toString())
    .replace(/{{nextBillingDate}}/g, data.nextBillingDate);

  // Plain text version
  const text = `
Welcome to OrangeFlow, ${data.name}!

Your ${data.plan} subscription is now active! 🎉

Subscription Details:
- Plan: ${data.plan}
- Auto DMs: ${data.dmLimit}/month
- Next billing: ${data.nextBillingDate}
- Amount: ₹${data.amount}/month

Get started in 3 simple steps:
1. Connect Your Instagram - Link your Instagram Professional account in 2 minutes.
2. Create Your First Automation - Set a keyword like "GUIDE" and add your message with a link.
3. Post & Watch It Work - Create a reel asking followers to comment your keyword.

Go to your dashboard: https://orangeflow.in/creator

Need help? Email us at support@orangeflow.in

Thanks for choosing OrangeFlow!

---
OrangeFlow - Instagram Growth & Automation Platform
https://orangeflow.in
  `.trim();

  try {
    await transporter.sendMail({
      from,
      to: data.to,
      subject: `Welcome to OrangeFlow! Your ${data.plan} plan is active 🎉`,
      text,
      html,
    });
    
    logger.info(`Subscription success email sent to ${data.to}`);
  } catch (error: any) {
    logger.error('Subscription email delivery failed', {
      host,
      port,
      from,
      to: data.to,
      error: error?.message,
    });
    // Don't throw error - email failure shouldn't break subscription activation
  }
}
