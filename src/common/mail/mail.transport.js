'use strict';

const nodemailer = require('nodemailer');
const config = require('../../config');

let transporter = null;

function isEmailConfigured() {
  return Boolean(
    config.email.enabled &&
      config.email.from &&
      config.email.smtp.host &&
      config.email.smtp.user &&
      config.email.smtp.pass &&
      Number.isFinite(config.email.smtp.port),
  );
}

function getMailerTransport() {
  if (!isEmailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });
  }

  return transporter;
}

module.exports = {
  getMailerTransport,
  isEmailConfigured,
};
