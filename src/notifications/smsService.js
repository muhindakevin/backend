const getTwilioClient = require('../../config/twilio');
const { Notification, Setting } = require('../models');

/**
 * Check if SMS notifications are enabled
 */
const isSmsEnabled = async () => {
  try {
    const setting = await Setting.findOne({ where: { key: 'system_smsEnabled' } });
    if (setting) {
      return setting.value === 'true' || setting.value === true;
    }
    return true; // Default enabled
  } catch (error) {
    console.error('[isSmsEnabled] Error:', error);
    return true; // Default enabled
  }
};

/**
 * Send SMS via Twilio
 * @param {string} to - Phone number (format: +250788123456)
 * @param {string} message - Message content
 * @param {number} userId - User ID for notification log
 * @param {string} type - Notification type
 */
const sendSMS = async (to, message, userId = null, type = 'sms') => {
  try {
    // Check if SMS is enabled
    const enabled = await isSmsEnabled();
    if (!enabled) {
      console.warn(`⚠️  SMS not sent to ${to}: SMS notifications are disabled in system settings`);
      return { success: false, message: 'SMS notifications are disabled' };
    }

    const twilioClient = getTwilioClient();
    
    if (!twilioClient) {
      console.warn(`⚠️  SMS not sent to ${to}: Twilio not configured. Message: ${message}`);
      // Still log notification as pending/failed
      if (userId) {
        await Notification.create({
          userId,
          type,
          channel: 'sms',
          title: 'SMS Notification',
          recipient: to,
          content: message,
          status: 'failed',
          error: 'Twilio not configured'
        });
      }
      return { success: false, message: 'SMS service not configured' };
    }

    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to
    });

    // Log notification
    if (userId) {
      await Notification.create({
        userId,
        type,
        channel: 'sms',
        title: 'SMS Notification',
        recipient: to,
        content: message,
        status: 'sent'
      });
    }

    return { success: true, message: 'SMS sent successfully' };
  } catch (error) {
    console.error('SMS sending error:', error);
    
    // Log failed notification
    if (userId) {
      await Notification.create({
        userId,
        type,
        channel: 'sms',
        title: 'SMS Notification',
        recipient: to,
        content: message,
        status: 'failed',
        error: error.message
      });
    }
    
    throw error;
  }
};

/**
 * Send OTP SMS
 */
const sendOTP = async (phone, otp) => {
  const message = `Your IKIMINA WALLET OTP code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
  return await sendSMS(phone, message, null, 'otp');
};

/**
 * Send registration confirmation SMS
 */
const sendRegistrationConfirmation = async (phone, userName) => {
  const message = `Welcome to IKIMINA WALLET, ${userName}! Your account has been successfully registered.`;
  return await sendSMS(phone, message, null, 'registration');
};

/**
 * Send loan approval SMS
 */
const sendLoanApproval = async (phone, memberName, loanAmount) => {
  const message = `Congratulations ${memberName}! Your loan request of RWF ${loanAmount.toLocaleString()} has been approved.`;
  return await sendSMS(phone, message, null, 'loan_approval');
};

/**
 * Send loan rejection SMS
 */
const sendLoanRejection = async (phone, memberName, reason) => {
  const message = `Dear ${memberName}, your loan request has been declined. Reason: ${reason}. Please contact your group admin for more information.`;
  return await sendSMS(phone, message, null, 'loan_rejection');
};

/**
 * Send contribution confirmation SMS
 */
const sendContributionConfirmation = async (phone, memberName, amount) => {
  const message = `Dear ${memberName}, your contribution of RWF ${amount.toLocaleString()} has been received and confirmed. Thank you!`;
  return await sendSMS(phone, message, null, 'contribution_confirmation');
};

/**
 * Send fine notification SMS
 */
const sendFineNotification = async (phone, memberName, amount, reason) => {
  const message = `Dear ${memberName}, a fine of RWF ${amount.toLocaleString()} has been issued. Reason: ${reason}. Please pay promptly.`;
  return await sendSMS(phone, message, null, 'fine_issued');
};

/**
 * Send meeting reminder SMS
 */
const sendMeetingReminder = async (phone, memberName, meetingDate, meetingTime) => {
  const message = `Reminder: ${memberName}, you have a group meeting on ${meetingDate} at ${meetingTime}. Please attend.`;
  return await sendSMS(phone, message, null, 'meeting_reminder');
};

module.exports = {
  sendSMS,
  sendOTP,
  sendRegistrationConfirmation,
  sendLoanApproval,
  sendLoanRejection,
  sendContributionConfirmation,
  sendFineNotification,
  sendMeetingReminder
};

