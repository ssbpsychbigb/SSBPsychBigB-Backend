'use strict';

const config = require('../../config');
const { logger } = require('../utils/logger');
const { getMailerTransport, isEmailConfigured } = require('./mail.transport');
const { buildTemplate, loginUrl } = require('./mail.templates');

async function sendMail({ to, subject, html, text, meta = {} }) {
  const recipient = String(to || '').trim();
  if (!recipient) {
    logger.info('Email skipped: missing recipient', meta);
    return { sent: false, skipped: true };
  }

  if (!isEmailConfigured()) {
    logger.info('Email skipped: SMTP not configured', {
      to: recipient,
      subject,
      ...meta,
    });
    return { sent: false, skipped: true };
  }

  try {
    const transport = getMailerTransport();
    await transport.sendMail({
      from: config.email.from,
      to: recipient,
      subject,
      html,
      text,
    });
    logger.info('Email sent', { to: recipient, subject, ...meta });
    return { sent: true };
  } catch (error) {
    logger.error('Email send failed', {
      to: recipient,
      subject,
      error: error instanceof Error ? error.message : String(error),
      ...meta,
    });
    return { sent: false, skipped: false };
  }
}

function sendTemplate(to, subject, templateInput, meta) {
  const { html, text } = buildTemplate(templateInput);
  return sendMail({ to, subject, html, text, meta });
}

const mailService = {
  notifyRegistrationReceived({ to, name, roleLabel, otp }) {
    const bullets = [
      'Your mobile OTP still controls sign-in.',
      'Our team will review your application and email you once approved or rejected.',
    ];

    if (otp) {
      bullets.unshift(`Your verification OTP is ${otp}. It expires shortly.`);
    }

    return sendTemplate(
      to,
      otp ? 'BIGB verification OTP' : 'BIGB application received',
      {
        title: otp ? 'Verify your BIGB account' : 'Application received',
        intro: `Hi ${name || 'there'}, we received your ${roleLabel} application on BIGB.`,
        bullets,
        ctaLabel: 'Open BIGB',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'registration_received' },
    );
  },

  notifyOtpCode({ to, name, otp, purpose }) {
    const purposeLabel =
      purpose === 'register' ? 'account verification' : 'sign-in';
    return sendTemplate(
      to,
      'BIGB verification OTP',
      {
        title: 'Your BIGB OTP',
        intro: `Hi ${name || 'there'}, use this one-time password for ${purposeLabel}.`,
        bullets: [
          `OTP: ${otp}`,
          'Do not share this code with anyone.',
          'It expires shortly. Request a new one if needed.',
        ],
        ctaLabel: 'Open BIGB',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'otp_email' },
    );
  },

  notifyApplicationApproved({ to, name, roleLabel }) {
    return sendTemplate(
      to,
      'BIGB application approved',
      {
        title: 'Application approved',
        intro: `Hi ${name || 'there'}, your ${roleLabel} application has been approved.`,
        bullets: ['You can now sign in with your mobile OTP and continue on BIGB.'],
        ctaLabel: 'Login to BIGB',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'application_approved' },
    );
  },

  notifyApplicationRejected({ to, name, roleLabel, reason }) {
    return sendTemplate(
      to,
      'BIGB application needs correction',
      {
        title: 'Application needs correction',
        intro: `Hi ${name || 'there'}, your ${roleLabel} application was reviewed but cannot be approved yet.`,
        bullets: reason ? [`Reason: ${reason}`] : [],
        ctaLabel: 'Review application',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'application_rejected' },
    );
  },

  notifyHireInvite({ to, educatorName, instituteName }) {
    return sendTemplate(
      to,
      'Institute hire invite on BIGB',
      {
        title: 'New hire invite',
        intro: `Hi ${educatorName || 'there'}, ${instituteName} invited you to join as an institute educator on BIGB.`,
        bullets: ['Accept or decline the invite from your educator collaborations page.'],
        ctaLabel: 'View collaborations',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'hire_invite' },
    );
  },

  notifyJoinRequest({ to, educatorName, instituteName }) {
    return sendTemplate(
      to,
      'New educator join request',
      {
        title: 'New join request',
        intro: `${educatorName || 'An educator'} requested to join ${instituteName} on BIGB.`,
        bullets: ['Review the request from your institute team page.'],
        ctaLabel: 'Open institute panel',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'join_request' },
    );
  },

  notifyHireAccepted({ to, educatorName, instituteName }) {
    return sendTemplate(
      to,
      'Hire invite accepted',
      {
        title: 'Hire accepted',
        intro: `${educatorName || 'An educator'} accepted the hire invite for ${instituteName}.`,
        ctaLabel: 'Open institute panel',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'hire_accepted' },
    );
  },

  notifyHireDeclined({ to, educatorName, instituteName }) {
    return sendTemplate(
      to,
      'Hire invite declined',
      {
        title: 'Hire declined',
        intro: `${educatorName || 'An educator'} declined the hire invite for ${instituteName}.`,
        ctaLabel: 'Open institute panel',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'hire_declined' },
    );
  },

  notifyJoinAccepted({ to, instituteName }) {
    return sendTemplate(
      to,
      'Join request accepted',
      {
        title: 'Join request accepted',
        intro: `${instituteName} accepted your educator collaboration request.`,
        ctaLabel: 'Open collaborations',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'join_accepted' },
    );
  },

  notifyJoinRejected({ to, instituteName }) {
    return sendTemplate(
      to,
      'Join request rejected',
      {
        title: 'Join request rejected',
        intro: `${instituteName} rejected your educator collaboration request.`,
        ctaLabel: 'Browse institutes',
        ctaUrl: loginUrl('/educator/collaborations'),
      },
      { event: 'join_rejected' },
    );
  },

  notifyLeaveRequested({ to, educatorName, instituteName, leaveStartsAt, leaveEndsAt }) {
    return sendTemplate(
      to,
      'Leave request received',
      {
        title: 'Leave request received',
        intro: `${educatorName || 'An educator'} requested temporary leave from ${instituteName}.`,
        bullets: [
          leaveStartsAt && leaveEndsAt
            ? `Requested leave: ${leaveStartsAt} to ${leaveEndsAt}`
            : 'Review the requested leave dates in the institute panel.',
        ],
        ctaLabel: 'Review request',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'leave_requested' },
    );
  },

  notifyLeaveDecided({ to, instituteName, accepted }) {
    return sendTemplate(
      to,
      accepted ? 'Leave request approved' : 'Leave request rejected',
      {
        title: accepted ? 'Leave approved' : 'Leave rejected',
        intro: accepted
          ? `${instituteName} approved your leave request.`
          : `${instituteName} rejected your leave request.`,
        ctaLabel: 'Open collaborations',
        ctaUrl: loginUrl('/educator/collaborations'),
      },
      { event: accepted ? 'leave_accepted' : 'leave_rejected' },
    );
  },

  notifyResignRequested({ to, educatorName, instituteName }) {
    return sendTemplate(
      to,
      'Resign request received',
      {
        title: 'Resign request received',
        intro: `${educatorName || 'An educator'} requested resignation from ${instituteName}.`,
        bullets: ['If you accept, a 14-day notice period starts immediately.'],
        ctaLabel: 'Review request',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'resign_requested' },
    );
  },

  notifyResignDecided({ to, instituteName, accepted }) {
    return sendTemplate(
      to,
      accepted ? 'Resign accepted' : 'Resign rejected',
      {
        title: accepted ? 'Resign accepted' : 'Resign rejected',
        intro: accepted
          ? `${instituteName} accepted your resignation. Your 14-day notice period has started.`
          : `${instituteName} rejected your resignation request.`,
        ctaLabel: 'Open collaborations',
        ctaUrl: loginUrl('/educator/collaborations'),
      },
      { event: accepted ? 'resign_accepted' : 'resign_rejected' },
    );
  },

  notifyFacultyReleased({ to, instituteName, reason }) {
    return sendTemplate(
      to,
      'Institute collaboration ended',
      {
        title: 'Collaboration ended',
        intro: `${instituteName} ended your institute educator collaboration on BIGB.`,
        bullets: reason ? [`Reason: ${reason}`] : [],
        ctaLabel: 'Open BIGB',
        ctaUrl: loginUrl('/login'),
      },
      { event: 'faculty_released' },
    );
  },
};

module.exports = {
  mailService,
  sendMail,
};
