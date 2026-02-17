require('dotenv').config();
const twilio = require('twilio');

let client = null;

/**
 * Get Twilio client (lazy initialization)
 * Only creates client when needed and credentials are available
 */
const getTwilioClient = () => {
  if (!client) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      console.warn('⚠️  Twilio credentials not configured. SMS notifications will be disabled.');
      return null;
    }

    try {
      client = twilio(accountSid, authToken);
    } catch (error) {
      console.error('⚠️  Failed to initialize Twilio client:', error.message);
      return null;
    }
  }
  return client;
};

module.exports = getTwilioClient;

