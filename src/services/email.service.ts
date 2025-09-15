import { config } from "../config/env.js";

export async function sendEmail(to: string, subject: string, html: string) {
  if (!config.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY missing; skipping email send to", to);
    return { skipped: true } as any;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.EMAIL_FROM, to, subject, html }),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error("Resend error:", txt);
    throw new Error("Failed to send email");
  }
  return res.json();
}

export async function sendVerificationEmail(to: string, code: string) {
  const appName = "PicStory";
  const appUrl =
    (config as any).APP_URL || (config as any).PUBLIC_SITE_URL || "#";
  const html = `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0b1020;margin:0;padding:0">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden">
          <!-- Header / Brand Bar -->
          <tr>
            <td style="background:#1f2937;padding:16px 18px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="width:34px;height:34px;background:#4f46e5;border-radius:9px;color:#ffffff;font-weight:700;text-align:center;vertical-align:middle;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px">PS</td>
                        <td style="width:8px"></td>
                        <td style="color:#e5e7eb;font-weight:700;font-family:Inter,system-ui,Arial,sans-serif;font-size:15px">${appName}</td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="color:#9ca3af;font-family:Inter,system-ui,Arial,sans-serif;font-size:12px">Verify your email</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Intro -->
          <tr>
            <td style="padding:20px 18px 6px;background:#f8fafc">
              <h2 style="margin:0;color:#0b1020;font-family:Inter,system-ui,Arial,sans-serif;font-size:20px;line-height:1.3">Enter this code to continue</h2>
              <p style="margin:8px 0 0;color:#334155;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;line-height:1.6">Use the code below to verify your ${appName} account. It expires in 15 minutes.</p>
            </td>
          </tr>
          <!-- Code Card -->
          <tr>
            <td style="padding:10px 18px 0;background:#f8fafc">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px">
                <tr>
                  <td align="center" style="padding:14px 16px">
                    <div style="display:inline-block;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px">
                      <div style="font-family:Inter,system-ui,Arial,sans-serif;font-weight:800;font-size:26px;letter-spacing:6px;color:#1d4ed8">${code}</div>
                    </div>
                    <div style="font-family:Inter,system-ui,Arial,sans-serif;font-size:12px;color:#6b7280;margin-top:10px">Do not share this code with anyone.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:14px 18px 20px;background:#f8fafc">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <a href="${appUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px">Open ${appName}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;color:#64748b;font-family:Inter,system-ui,Arial,sans-serif;font-size:12px;line-height:1.6">Didn’t request this? You can safely ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
  return sendEmail(to, "Verify your PicStory email", html);
}

export async function sendWelcomeEmail(to: string, name?: string) {
  const appName = "PicStories AI";
  const firstName = (name || "").trim().split(" ")[0] || "Friend";
  // Best-effort URL selection without breaking if not configured
  const appUrl =
    (config as any).APP_URL || (config as any).PUBLIC_SITE_URL || "#";
  const html = `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#0b1020;margin:0;padding:0">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden">
          <!-- Header / Brand Bar -->
          <tr>
            <td style="background:#1f2937;padding:18px 20px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align:middle">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="width:36px;height:36px;background:#4f46e5;border-radius:10px;color:#ffffff;font-weight:700;text-align:center;vertical-align:middle;font-family:Inter,system-ui,Arial,sans-serif;font-size:14px">PS</td>
                        <td style="width:10px"></td>
                        <td style="color:#e5e7eb;font-weight:700;font-family:Inter,system-ui,Arial,sans-serif;font-size:16px">${appName}</td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="color:#9ca3af;font-family:Inter,system-ui,Arial,sans-serif;font-size:12px">Create with AI ✨</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Hero -->
          <tr>
            <td style="padding:22px 20px 6px;background:#f8fafc">
              <h1 style="margin:0;color:#0b1020;font-family:Inter,system-ui,Arial,sans-serif;font-size:24px;line-height:1.25">Welcome, ${firstName}! 🎉</h1>
              <p style="margin:8px 0 0;color:#334155;font-family:Inter,system-ui,Arial,sans-serif;font-size:14px;line-height:1.6">Thanks for joining ${appName}. You can plan stories, generate artwork, and export beautiful print‑ready PDFs in minutes.</p>
            </td>
          </tr>
          <!-- Feature Highlights -->
          <tr>
            <td style="padding:10px 20px 0;background:#f8fafc">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
                <tr>
                  <td style="padding:14px 16px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="font-family:Inter,system-ui,Arial,sans-serif;font-size:14px;color:#111827;font-weight:600;padding-bottom:6px">What you can do</td>
                      </tr>
                      <tr>
                        <td style="font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;color:#334155;line-height:1.6">
                          • AI plan for storybooks and coloring books<br/>
                          • Generate cohesive art and kid‑friendly line‑art<br/>
                          • Attach reference images for consistent characters<br/>
                          • Edit prompts page‑by‑page and review as images generate<br/>
                          • Export a print‑ready PDF at common sizes
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Credits Card -->
          <tr>
            <td style="padding:12px 20px 0;background:#f8fafc">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px">
                <tr>
                  <td style="padding:14px 16px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="font-family:Inter,system-ui,Arial,sans-serif;font-size:14px;color:#111827;font-weight:700">How credits work</td>
                      </tr>
                      <tr>
                        <td style="padding-top:6px;font-family:Inter,system-ui,Arial,sans-serif;font-size:13px;color:#1f2937;line-height:1.6">
                          • Each generated page or image uses credits.<br/>
                          • Choose a plan in the app (Lite / Pro / Elite) to add more credits instantly.<br/>
                          • You start with some free credits to try your first book.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:16px 20px 22px;background:#f8fafc">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td>
                    <a href="${appUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:700;font-family:Inter,system-ui,Arial,sans-serif;font-size:14px">Open ${appName}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;color:#64748b;font-family:Inter,system-ui,Arial,sans-serif;font-size:12px;line-height:1.6">Tip: Create a short 6‑page storybook first to see the full flow — plan → generate → edit → export.</p>
            </td>
          </tr>
          <!-- Footer note -->
          <tr>
            <td style="padding:14px 20px;background:#ffffff;border-top:1px solid #e5e7eb">
              <p style="margin:0;color:#94a3b8;font-family:Inter,system-ui,Arial,sans-serif;font-size:12px">You’re receiving this because you created a ${appName} account. If this wasn’t you, just ignore this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
  return sendEmail(to, `Welcome to ${appName}!`, html);
}
