import { config } from '../config/env.js';

export async function sendEmail(to: string, subject: string, html: string) {
  if (!config.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY missing; skipping email send to', to);
    return { skipped: true } as any;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('Resend error:', txt);
    throw new Error('Failed to send email');
  }
  return res.json();
}

export async function sendVerificationEmail(to: string, code: string) {
  const html = `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:520px;margin:auto;padding:24px">
    <h2 style="color:#111827;margin:0 0 12px">Verify your email</h2>
    <p style="color:#374151;margin:0 0 16px">Use the code below to verify your PicStory account. This code expires in 15 minutes.</p>
    <div style="font-size:28px;font-weight:700;letter-spacing:4px;color:#2563eb;background:#eff6ff;display:inline-block;padding:8px 12px;border-radius:8px">${code}</div>
    <p style="color:#6b7280;margin:16px 0 0">If you didn’t request this, you can ignore this email.</p>
  </div>`;
  return sendEmail(to, 'Verify your PicStory email', html);
}
