'use strict';

const { Router } = require('express');
const config = require('../../config');
const { mailService } = require('./mail.service');
const { isEmailConfigured } = require('./mail.transport');

/**
 * ! Dev-only route for testing email delivery + template preview.
 * Mounted only when NODE_ENV !== "production".
 */
const mailTestRouter = Router();

mailTestRouter.post('/send-test', async (req, res) => {
  if (config.isProduction) {
    return res.status(403).json({ success: false, message: 'Disabled in production' });
  }

  const { to } = req.body;
  if (!to) {
    return res.status(400).json({ success: false, message: '"to" email address is required' });
  }

  if (!isEmailConfigured()) {
    return res.status(503).json({
      success: false,
      message: 'SMTP not configured. Set EMAIL_ENABLED=true and SMTP_* in .env',
    });
  }

  const result = await mailService.notifyRegistrationReceived({
    to,
    name: 'Test User',
    roleLabel: 'Educator',
  });

  return res.status(200).json({
    success: true,
    message: result.sent ? 'Test email sent — check your inbox' : 'Email was skipped',
    data: result,
  });
});

// * Preview branded template as HTML (no email sent)
mailTestRouter.get('/preview', (_req, res) => {
  if (config.isProduction) {
    return res.status(403).json({ success: false, message: 'Disabled in production' });
  }

  const { buildTemplate, loginUrl } = require('./mail.templates');
  const { html } = buildTemplate({
    title: 'Application approved',
    intro: 'Hi Milan, your Educator application has been approved. Welcome aboard!',
    bullets: [
      'You can now sign in with your mobile OTP.',
      'Explore institutes and start collaborating.',
    ],
    ctaLabel: 'Login to BIGB',
    ctaUrl: loginUrl('/login'),
  });

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});

module.exports = { mailTestRouter };
