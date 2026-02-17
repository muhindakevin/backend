require('dotenv').config();
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

const BIRD_API_URL = 'https://api.bird.com/v1/email/send';

async function sendViaBird(to, subject, htmlContent) {
  const apiKey = process.env.BIRD_API_KEY;
  const senderEmail = process.env.BIRD_SENDER_EMAIL;

  if (!apiKey || !senderEmail) {
    throw new Error('Bird.com email service not configured');
  }

  const response = await fetch(BIRD_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: senderEmail,
      to,
      subject,
      html: htmlContent
    })
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bird API error: ${error}`);
  }
  return await response.json();
}

async function getSmtpConfig() {
  // Try to get from database settings first
  try {
    const { Setting } = require('../src/models');
    const emailSetting = await Setting.findOne({ where: { key: 'system_email' } });
    if (emailSetting && emailSetting.value) {
      const emailConfig = JSON.parse(emailSetting.value);
      if (emailConfig.smtpHost && emailConfig.username && emailConfig.password) {
        return {
          host: emailConfig.smtpHost,
          port: parseInt(emailConfig.smtpPort || '587', 10),
          user: emailConfig.username,
          pass: emailConfig.password,
          from: emailConfig.username,
          enabled: emailConfig.enabled !== false
        };
      }
    }
  } catch (error) {
    console.warn('[getSmtpConfig] Error reading from database, using env vars:', error.message);
  }

  // Fall back to environment variables
  return {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    enabled: true
  };
}

async function sendViaSmtp(to, subject, htmlContent) {
  const config = await getSmtpConfig();

  if (!config.enabled) {
    throw new Error('Email service is disabled in system settings');
  }

  if (!config.host || !config.user || !config.pass) {
    throw new Error('SMTP not configured');
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass }
  });

  const info = await transporter.sendMail({ from: config.from, to, subject, html: htmlContent });
  return { success: true, messageId: info.messageId };
}

module.exports = {
  sendEmail: async (to, subject, htmlContent) => {
    // Prefer Bird if configured; otherwise fall back to SMTP (e.g., Gmail App Password)
    try {
      if (process.env.BIRD_API_KEY && process.env.BIRD_SENDER_EMAIL) {
        return await sendViaBird(to, subject, htmlContent);
      }
    } catch (err) {
      console.warn('Bird.com send failed, attempting SMTP fallback:', err.message);
    }

    try {
      return await sendViaSmtp(to, subject, htmlContent);
    } catch (err) {
      console.error('SMTP email send failed:', err.message);
      throw new Error('Email service not configured');
    }
  }
};

