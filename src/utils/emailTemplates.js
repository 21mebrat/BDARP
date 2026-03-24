export const buildVerificationEmail = (username, verifyUrl) => {
  const appName    = "Abugida Books";
  const supportUrl = process.env.CLIENT_URL;
  const expireMinutes = 12;

  const subject = `Verify your ${appName} account`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:'Segoe UI',Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table width="560" cellpadding="0" cellspacing="0" role="presentation"
               style="background:#ffffff;border-radius:12px;overflow:hidden;
                      box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
                        padding:36px 40px;text-align:center;">
              <h1 style="margin:0;color:#e2b96f;font-size:26px;font-weight:700;
                          letter-spacing:0.5px;">📚 ${appName}</h1>
              <p  style="margin:6px 0 0;color:#9ca3af;font-size:13px;letter-spacing:1px;">
                BOOK DISCOVERY PLATFORM
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:600;">
                Confirm your email address
              </h2>
              <p style="margin:0 0 8px;color:#374151;font-size:15px;line-height:1.6;">
                Hi <strong>${username}</strong>,
              </p>
              <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6;">
                Thanks for signing up! Click the button below to verify your email
                address and activate your account. The link expires in
                <strong style="color:#111827;">${expireMinutes} minutes</strong>.
              </p>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="padding-bottom:28px;">
                    <a href="${verifyUrl}"
                       style="display:inline-block;background:#e2b96f;color:#1a1a2e;
                              text-decoration:none;font-weight:700;font-size:15px;
                              padding:14px 36px;border-radius:8px;
                              letter-spacing:0.3px;">
                      ✅ Verify My Email
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;">
                Or paste this link into your browser:
              </p>
              <p style="margin:0 0 28px;word-break:break-all;">
                <a href="${verifyUrl}"
                   style="color:#2563eb;font-size:13px;text-decoration:none;">
                  ${verifyUrl}
                </a>
              </p>

              <!-- Security note -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="background:#fef9ec;border:1px solid #fcd34d;
                              border-radius:8px;padding:14px 18px;">
                    <p style="margin:0;color:#92400e;font-size:13px;line-height:1.5;">
                      🔒 <strong>Didn't create this account?</strong>
                      You can safely ignore this email — no action is required.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;
                        padding:20px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
                © ${new Date().getFullYear()} ${appName}. All rights reserved.<br/>
                Questions? <a href="${supportUrl}" style="color:#6b7280;">Contact Support</a>
              </p>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // Plain-text fallback for clients that do not render HTML
  const text = [
    `Hi ${username},`,
    ``,
    `Please verify your ${appName} account by visiting the link below:`,
    ``,
    verifyUrl,
    ``,
    `This link expires in ${expireMinutes} hours.`,
    ``,
    `If you did not create this account, you can safely ignore this email.`,
    ``,
    `— The ${appName} Team`,
  ].join("\n");

  return { subject, html, text };
};