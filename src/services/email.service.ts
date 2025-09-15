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

export async function sendWelcomeEmail(to: string, name?: string) {
  const appName = 'PicStory';
  const firstName = (name || '').trim().split(' ')[0] || 'Friend';
  const html = `
  <div style="font-family:Inter,system-ui,Arial,sans-serif;max-width:640px;margin:auto;background:#0f172a;background:linear-gradient(180deg,#0f172a 0%,#111827 100%);border-radius:16px;overflow:hidden">
    <div style="padding:28px 28px 0">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:36px;height:36px;border-radius:10px;background:#4f46e5;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">PS</div>
        <div style="color:#e5e7eb;font-size:18px;font-weight:600">${appName}</div>
      </div>
      <h1 style="color:#ffffff;font-size:28px;line-height:1.2;margin:18px 0 8px">Welcome, ${firstName}! 🎉</h1>
      <p style="color:#cbd5e1;margin:0 0 4px">We’re thrilled to have you on board. Create beautiful, printable books in minutes.</p>
      <p style="color:#cbd5e1;margin:0">Here’s what you can do with ${appName}:</p>
    </div>
    <div style="padding:14px 28px 0">
      <ul style="color:#e5e7eb;padding-left:20px;margin:0">
        <li style="margin:8px 0">Generate full-color storybooks or black-and-white coloring books</li>
        <li style="margin:8px 0">Add up to 2 reference images for consistent characters</li>
        <li style="margin:8px 0">Edit any page with new prompts or reference images</li>
        <li style="margin:8px 0">Review while images generate in the background</li>
        <li style="margin:8px 0">Export print-ready PDFs at your chosen page size</li>
      </ul>
    </div>
    <div style="padding:24px 28px 28px">
      <a href="#" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600">Open ${appName}</a>
      <p style="color:#94a3b8;margin:16px 0 0;font-size:12px">Tip: You have starter credits in your account—try creating a book now!</p>
    </div>
  </div>`;
  return sendEmail(to, `Welcome to ${appName}!`, html);
}
