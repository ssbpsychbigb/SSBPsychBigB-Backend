'use strict';

const config = require('../../config');

// * Brand constants — change once, applies to all emails.
const BRAND_NAME = 'BIGB';
const BRAND_COLOR = '#2563eb';
const BRAND_BG = '#f8fafc';
const FOOTER_TEXT_COLOR = '#6b7280';

/**
 * Branded HTML email shell.
 * @param {string} bodyHtml - Inner content HTML
 * @returns {string}
 */
function wrapInLayout(bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${BRAND_NAME}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND_BG};font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND_BG};padding:32px 16px;">
    <tr>
      <td align="center">
        <!-- Header -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding:0 0 24px 0;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:${BRAND_COLOR};border-radius:10px;padding:10px 22px;">
                    <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:1.5px;">${BRAND_NAME}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <!-- Card -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
          <tr>
            <td style="padding:36px 32px 32px 32px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding:24px 0 0 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:${FOOTER_TEXT_COLOR};line-height:1.5;">
                &copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved.<br/>
                You're receiving this because you have an account on ${BRAND_NAME}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * @param {{
 *   title: string,
 *   intro: string,
 *   bullets?: string[],
 *   ctaLabel?: string,
 *   ctaUrl?: string,
 *   outro?: string,
 * }} input
 */
function buildTemplate({
  title,
  intro,
  bullets = [],
  ctaLabel,
  ctaUrl,
  outro = 'Regards,\nThe BIGB Team',
}) {
  const htmlBullets =
    bullets.length > 0
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:16px 0;">
          ${bullets
            .map(
              (item) => `<tr>
              <td style="padding:4px 12px 4px 0;vertical-align:top;color:${BRAND_COLOR};font-size:16px;">•</td>
              <td style="padding:4px 0;font-size:14px;color:#374151;line-height:1.5;">${item}</td>
            </tr>`,
            )
            .join('')}
        </table>`
      : '';

  const htmlCta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px 0;">
          <tr>
            <td style="background:${BRAND_COLOR};border-radius:8px;">
              <a href="${ctaUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;">${ctaLabel}</a>
            </td>
          </tr>
        </table>`
      : '';

  const outroHtml = outro
    ? `<p style="margin:20px 0 0 0;font-size:14px;color:${FOOTER_TEXT_COLOR};white-space:pre-line;line-height:1.5;">${outro}</p>`
    : '';

  const bodyHtml = `
    <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;">${title}</h1>
    <p style="margin:0 0 8px 0;font-size:15px;color:#374151;line-height:1.6;">${intro}</p>
    ${htmlBullets}
    ${htmlCta}
    ${outroHtml}
  `;

  return {
    html: wrapInLayout(bodyHtml),
    text: [
      title,
      '',
      intro,
      bullets.length ? ['', ...bullets.map((item) => `- ${item}`)] : [],
      ctaLabel && ctaUrl ? ['', `${ctaLabel}: ${ctaUrl}`] : [],
      '',
      outro,
    ]
      .flat()
      .join('\n'),
  };
}

function loginUrl(path = '/login') {
  return `${config.email.appPublicUrl}${path}`;
}

module.exports = {
  buildTemplate,
  loginUrl,
};
