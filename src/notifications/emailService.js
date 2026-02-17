const birdService = require('../../config/bird');
const { Notification, Setting } = require('../models');

/**
 * Check if email notifications are enabled
 */
const isEmailEnabled = async () => {
  try {
    const emailSetting = await Setting.findOne({ where: { key: 'system_email' } });
    if (emailSetting && emailSetting.value) {
      const emailConfig = JSON.parse(emailSetting.value);
      return emailConfig.enabled !== false;
    }
    return true; // Default enabled
  } catch (error) {
    console.error('[isEmailEnabled] Error:', error);
    return true; // Default enabled
  }
};

/**
 * Send Email via Bird.com
 * @param {string} to - Email address
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML email content
 * @param {number} userId - User ID for notification log
 * @param {string} type - Notification type
 */
const sendEmail = async (to, subject, htmlContent, userId = null, type = 'email') => {
  try {
    // Check if email is enabled
    const enabled = await isEmailEnabled();
    if (!enabled) {
      console.warn(`⚠️  Email not sent to ${to}: Email notifications are disabled in system settings`);
      return { success: false, message: 'Email notifications are disabled' };
    }

    await birdService.sendEmail(to, subject, htmlContent);

    // Log notification on success (only for email channel, don't create in-app notification)
    // Email notifications are logged separately and shouldn't appear in in-app notifications
    // In-app notifications should be created separately with plain text content

    return { success: true, message: 'Email sent successfully' };
  } catch (error) {
    // If service not configured, log but don't fail the main operation
    if (error.message && error.message.includes('not configured')) {
      console.warn(`⚠️  Email not sent to ${to}: ${error.message}`);
      // Don't create in-app notification for failed emails
      // Email failures are logged separately
      return { success: false, message: 'Email service not configured' };
    }

    // Log failed notification for other errors
    console.error('Email sending error:', error);
    
    // Don't create in-app notification for failed emails
    // Email failures are logged separately

    // Don't throw - return error response instead
    return { success: false, message: error.message || 'Failed to send email' };
  }
};

/**
 * Send welcome email
 */
const sendWelcomeEmail = async (email, userName) => {
  const subject = 'Welcome to IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">Welcome to IKIMINA WALLET!</h1>
      <p>Dear ${userName},</p>
      <p>Your account has been successfully registered. Welcome to Rwanda's digital microfinance platform for saving groups.</p>
      <p>You can now:</p>
      <ul>
        <li>Make contributions to your group</li>
        <li>Apply for loans</li>
        <li>Track your savings</li>
        <li>Participate in group activities</li>
      </ul>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'registration');
};

/**
 * Send welcome email with credentials
 */
const sendWelcomeEmailWithCredentials = async (email, userName, phone, password, groupName) => {
  const subject = 'Welcome to IKIMINA WALLET - Your Account Credentials';
  const emailOrPhone = email || phone;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #1e40af; font-size: 28px; margin-bottom: 20px;">Welcome to IKIMINA WALLET!</h1>
      <p style="color: #000; font-size: 16px; line-height: 1.6; margin-bottom: 10px;">Dear ${userName},</p>
      <p style="color: #000; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">Your account has been successfully registered in <strong>${groupName || 'your group'}</strong>. Welcome to Rwanda's digital microfinance platform for saving groups.</p>
      
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1e40af;">
        <h2 style="color: #1e40af; margin-top: 0; font-size: 20px; margin-bottom: 15px;">Your Login Credentials</h2>
        <p style="margin: 10px 0; font-size: 16px; color: #000;"><strong>Email/Phone:</strong> <a href="mailto:${emailOrPhone}" style="color: #1e40af; text-decoration: underline;">${emailOrPhone}</a></p>
        <p style="margin: 10px 0; font-size: 16px; color: #000;"><strong>Password:</strong> <span style="font-family: monospace; font-size: 16px; font-weight: bold; color: #059669;">${password}</span></p>
        <p style="margin: 10px 0; font-size: 14px; color: #666;">Please keep these credentials secure. You can change your password after logging in.</p>
      </div>
      
      <p style="color: #000; font-size: 16px; font-weight: bold; margin-top: 25px; margin-bottom: 10px;"><strong>What you can do now:</strong></p>
      <ul style="color: #000; font-size: 16px; line-height: 1.8; padding-left: 20px; margin-bottom: 20px;">
        <li>Log in to your account using your email/phone and password</li>
        <li>Make contributions to your group</li>
        <li>Apply for loans</li>
        <li>Track your savings</li>
        <li>Participate in group activities</li>
      </ul>
      
      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 0; font-weight: bold;">⚠️ Important:</p>
        <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 5px 0 0 0;">Please save this email securely. Your password is: <strong style="color: #f59e0b;">${password}</strong></p>
      </div>
      
      <p style="color: #000; font-size: 16px; margin-top: 30px;">Best regards,<br><strong>IKIMINA WALLET Team</strong></p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'registration');
};

/**
 * Send loan approval email
 */
const sendLoanApprovalEmail = async (email, memberName, loanAmount, monthlyPayment, duration) => {
  const subject = 'Loan Approved - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #059669;">Loan Approved!</h1>
      <p>Dear ${memberName},</p>
      <p>Congratulations! Your loan request has been approved.</p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Loan Amount:</strong> RWF ${loanAmount.toLocaleString()}</p>
        <p><strong>Monthly Payment:</strong> RWF ${monthlyPayment.toLocaleString()}</p>
        <p><strong>Duration:</strong> ${duration} months</p>
      </div>
      <p>Please log in to your account to view full details.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'loan_approval');
};

/**
 * Send loan rejection email
 */
const sendLoanRejectionEmail = async (email, memberName, reason) => {
  const subject = 'Loan Request Update - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #dc2626;">Loan Request Update</h1>
      <p>Dear ${memberName},</p>
      <p>We regret to inform you that your loan request has been declined.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Please contact your group administrator for more information or to discuss alternative options.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'loan_rejection');
};

/**
 * Send contribution summary email
 */
const sendContributionSummary = async (email, memberName, amount, balance) => {
  const subject = 'Contribution Confirmed - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">Contribution Received</h1>
      <p>Dear ${memberName},</p>
      <p>Your contribution has been successfully processed.</p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Amount:</strong> RWF ${amount.toLocaleString()}</p>
        <p><strong>New Balance:</strong> RWF ${balance.toLocaleString()}</p>
      </div>
      <p>Thank you for your continued participation.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'contribution_confirmation');
};

/**
 * Send Learn & Grow content update email
 */
const sendLearnGrowUpdate = async (email, memberName, contentTitle) => {
  const subject = 'New Learning Content Available - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">New Learning Content</h1>
      <p>Dear ${memberName},</p>
      <p>New educational content is available in your "Learn & Grow" section:</p>
      <p><strong>${contentTitle}</strong></p>
      <p>Log in to access this content and enhance your financial literacy.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'learn_grow_update');
};

/**
 * Send OTP email
 */
const sendOtpEmail = async (email, memberName, otp) => {
  const subject = 'Your IKIMINA WALLET OTP Code';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">OTP Verification</h1>
      <p>Dear ${memberName || 'Member'},</p>
      <p>Your one-time password (OTP) is:</p>
      <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:12px 0;font-size:20px;letter-spacing:4px;font-weight:bold;">${otp}</div>
      <p>This code is valid for 10 minutes. Do not share it with anyone.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'otp');
};

/**
 * Send approval email
 */
const sendApprovalEmail = async (email, memberName) => {
  const subject = 'Account Approved - Welcome to IKIMINA WALLET!';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #059669;">Account Approved - Welcome!</h1>
      <p>Dear ${memberName || 'Member'},</p>
      <p>Great news! Your application has been approved by your Group Admin. You can now log in and start using the platform.</p>
      <p><strong>What you can do now:</strong></p>
      <ul>
        <li>Log in to your account using your email/phone and password</li>
        <li>Make contributions to your group</li>
        <li>Apply for loans</li>
        <li>Track your savings</li>
        <li>Participate in group activities</li>
      </ul>
      <p>Welcome to IKIMINA WALLET! We're excited to have you as part of our community.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'approval');
};

/**
 * Send loan request notification email to Group Admin
 */
const sendLoanRequestEmail = async (email, subject, htmlContent, userId) => {
  return await sendEmail(email, subject, htmlContent, userId, 'loan_request');
};

/**
 * Send password reset email
 */
const sendPasswordResetEmail = async (email, userName, resetToken, resetUrl, userId = null) => {
  const subject = 'Password Reset Request - IKIMINA WALLET';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f5f5f5;">
      <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
        <tr>
          <td style="padding: 20px;">
            <table role="presentation" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 40px 30px; text-align: center; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); border-radius: 8px 8px 0 0;">
                  <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">IKIMINA WALLET</h1>
                </td>
              </tr>
              <tr>
                <td style="padding: 30px;">
                  <h2 style="color: #1e40af; margin: 0 0 20px 0; font-size: 24px;">Password Reset Request</h2>
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">Dear ${userName || 'User'},</p>
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">We received a request to reset your password for your IKIMINA WALLET account.</p>
                  <p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">Click the button below to reset your password:</p>
                  
                  <!-- Reset Password Button -->
                  <table role="presentation" style="width: 100%; margin: 30px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="${resetUrl}" 
                           style="background-color: #1e40af; 
                                  color: #ffffff; 
                                  padding: 14px 40px; 
                                  text-decoration: none; 
                                  border-radius: 6px; 
                                  display: inline-block; 
                                  font-weight: bold; 
                                  font-size: 16px;
                                  border: none;
                                  cursor: pointer;">
                          Reset Password
                        </a>
                      </td>
                    </tr>
                  </table>
                  
                  <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 30px 0 10px 0; text-align: center;">Or copy and paste this link into your browser:</p>
                  <p style="word-break: break-all; color: #1e40af; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0; padding: 15px; background-color: #f3f4f6; border-radius: 4px; border: 1px solid #e5e7eb;">
                    <a href="${resetUrl}" style="color: #1e40af; text-decoration: underline;">${resetUrl}</a>
                  </p>
                  
                  <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <p style="color: #1e40af; font-size: 14px; line-height: 1.6; margin: 0; font-weight: bold;">💡 If the link doesn't work:</p>
                    <p style="color: #1e40af; font-size: 13px; line-height: 1.6; margin: 5px 0 0 0;">
                      1. Go to your app's reset password page<br/>
                      2. Enter your email: <strong>${userName || email}</strong><br/>
                      3. Enter this token: <strong style="font-family: monospace; font-size: 12px;">${resetToken}</strong>
                    </p>
                  </div>
                  
                  <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 30px 0; border-radius: 4px;">
                    <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 0; font-weight: bold;">⚠️ Important:</p>
                    <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 5px 0 0 0;">This link will expire in 1 hour. If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
                  </div>
                  
                  <p style="color: #666666; font-size: 14px; line-height: 1.6; margin: 30px 0 0 0;">Best regards,<br><strong>IKIMINA WALLET Team</strong></p>
                </td>
              </tr>
              <tr>
                <td style="padding: 20px 30px; text-align: center; background-color: #f9fafb; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
                  <p style="color: #9ca3af; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
  return await sendEmail(email, subject, html, userId, 'password_reset');
};

/**
 * Send role assignment email
 */
const sendRoleAssignmentEmail = async (email, userName, role, groupName) => {
  const subject = 'Role Assignment - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">Role Assignment Notification</h1>
      <p>Dear ${userName || 'Member'},</p>
      <p>Your role has been updated in IKIMINA WALLET.</p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>New Role:</strong> ${role}</p>
        <p><strong>Group:</strong> ${groupName || 'N/A'}</p>
      </div>
      <p>Please log in to your account to access your new role's features and permissions.</p>
      <p><strong>Note:</strong> When you log in, your role will automatically be set based on your account. You no longer need to manually select your role during login.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'role_assignment');
};

/**
 * Send user transfer email
 */
const sendUserTransferEmail = async (email, userName, fromGroupName, toGroupName, reason) => {
  const subject = 'Group Transfer - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #1e40af;">Group Transfer Notification</h1>
      <p>Dear ${userName || 'Member'},</p>
      <p>You have been transferred to a new group in IKIMINA WALLET.</p>
      <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p><strong>From Group:</strong> ${fromGroupName || 'N/A'}</p>
        <p><strong>To Group:</strong> ${toGroupName}</p>
        ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}
      </div>
      <p>Please log in to your account to access your new group's features and activities.</p>
      <p>Best regards,<br>IKIMINA WALLET Team</p>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'user_transfer');
};

/**
 * Send account burned email
 */
const sendAccountBurnedEmail = async (email, userName, groupName, reason) => {
  const subject = 'Account Status Update - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background-color: #dc2626; padding: 25px; text-align: center;">
        <h1 style="color: #ffffff; font-size: 28px; margin: 0;">Account Status Update</h1>
      </div>
      <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333333; margin-bottom: 15px;">Dear ${userName},</p>
        <p style="font-size: 16px; color: #333333; margin-bottom: 25px;">We are writing to inform you that your account in <strong style="color: #1e40af;">${groupName || 'your group'}</strong> has been marked as <strong style="color: #dc2626;">burned</strong>.</p>
        
        <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #dc2626; font-size: 20px; margin-top: 0; margin-bottom: 15px;">What This Means</h2>
          <p style="margin: 10px 0; font-size: 16px; color: #991b1b;">Your account has been temporarily suspended. You will not be able to:</p>
          <ul style="margin: 10px 0; padding-left: 20px; font-size: 16px; color: #991b1b;">
            <li>Access your account</li>
            <li>Make contributions</li>
            <li>Apply for loans</li>
            <li>Participate in group activities</li>
          </ul>
          ${reason ? `<p style="margin: 15px 0 0 0; font-size: 14px; color: #991b1b;"><strong>Reason:</strong> ${reason}</p>` : ''}
        </div>
        
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 25px 0; border-radius: 4px;">
          <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 0; font-weight: bold;">⚠️ Important:</p>
          <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 5px 0 0 0;">If you believe this is an error or have questions, please contact your Group Admin or the IKIMINA WALLET support team.</p>
        </div>
        
        <p style="font-size: 16px; color: #333333; margin-top: 30px;">Best regards,<br><strong style="color: #1e40af;">IKIMINA WALLET Team</strong></p>
      </div>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'account_burned');
};

/**
 * Send account reactivated email
 */
const sendAccountReactivatedEmail = async (email, userName, groupName) => {
  const subject = 'Account Reactivated - IKIMINA WALLET';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background-color: #059669; padding: 25px; text-align: center;">
        <h1 style="color: #ffffff; font-size: 28px; margin: 0;">Account Reactivated</h1>
      </div>
      <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333333; margin-bottom: 15px;">Dear ${userName},</p>
        <p style="font-size: 16px; color: #333333; margin-bottom: 25px;">Great news! Your account in <strong style="color: #1e40af;">${groupName || 'your group'}</strong> has been reactivated.</p>
        
        <div style="background: #d1fae5; border-left: 4px solid #059669; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #059669; font-size: 20px; margin-top: 0; margin-bottom: 15px;">You Can Now:</h2>
          <ul style="margin: 10px 0; padding-left: 20px; font-size: 16px; color: #065f46;">
            <li>Access your account</li>
            <li>Make contributions</li>
            <li>Apply for loans</li>
            <li>Participate in group activities</li>
            <li>Track your savings</li>
          </ul>
        </div>
        
        <p style="font-size: 16px; color: #333333; margin-top: 30px;">Welcome back! We're glad to have you back in the group.</p>
        <p style="font-size: 16px; color: #333333; margin-top: 30px;">Best regards,<br><strong style="color: #1e40af;">IKIMINA WALLET Team</strong></p>
      </div>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'account_reactivated');
};

/**
 * Send member data updated email
 */
const sendMemberDataUpdatedEmail = async (email, userName, groupName, updatedFields) => {
  const subject = 'Account Information Updated - IKIMINA WALLET';
  const fieldsList = Object.keys(updatedFields).map(field => {
    const fieldName = field.charAt(0).toUpperCase() + field.slice(1).replace(/([A-Z])/g, ' $1');
    return `<li><strong>${fieldName}:</strong> ${updatedFields[field] || 'N/A'}</li>`;
  }).join('');
  
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background-color: #1e40af; padding: 25px; text-align: center;">
        <h1 style="color: #ffffff; font-size: 28px; margin: 0;">Account Information Updated</h1>
      </div>
      <div style="padding: 30px;">
        <p style="font-size: 16px; color: #333333; margin-bottom: 15px;">Dear ${userName},</p>
        <p style="font-size: 16px; color: #333333; margin-bottom: 25px;">Your account information in <strong style="color: #1e40af;">${groupName || 'your group'}</strong> has been updated by your Group Admin.</p>
        
        <div style="background: #eff6ff; border-left: 4px solid #1e40af; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h2 style="color: #1e40af; font-size: 20px; margin-top: 0; margin-bottom: 15px;">Updated Information:</h2>
          <ul style="margin: 10px 0; padding-left: 20px; font-size: 16px; color: #1e3a8a;">
            ${fieldsList}
          </ul>
        </div>
        
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 25px 0; border-radius: 4px;">
          <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 0; font-weight: bold;">⚠️ Important:</p>
          <p style="color: #92400e; font-size: 14px; line-height: 1.6; margin: 5px 0 0 0;">If you did not authorize these changes or notice any discrepancies, please contact your Group Admin or the IKIMINA WALLET support team immediately.</p>
        </div>
        
        <p style="font-size: 16px; color: #333333; margin-top: 30px;">Best regards,<br><strong style="color: #1e40af;">IKIMINA WALLET Team</strong></p>
      </div>
    </div>
  `;
  return await sendEmail(email, subject, html, null, 'member_data_updated');
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendWelcomeEmailWithCredentials,
  sendLoanApprovalEmail,
  sendLoanRejectionEmail,
  sendContributionSummary,
  sendLearnGrowUpdate,
  sendOtpEmail,
  sendApprovalEmail,
  sendLoanRequestEmail,
  sendPasswordResetEmail,
  sendRoleAssignmentEmail,
  sendUserTransferEmail,
  sendAccountBurnedEmail,
  sendAccountReactivatedEmail,
  sendMemberDataUpdatedEmail
};
