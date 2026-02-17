const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { User } = require('../models');
const { generateOTP, generateOTPExpiry, isOTPExpired } = require('../utils/otpGenerator');
const { sendOTP, sendRegistrationConfirmation } = require('../notifications/smsService');
const { sendWelcomeEmail, sendOtpEmail, sendPasswordResetEmail } = require('../notifications/emailService');
const { logAction } = require('../utils/auditLogger');

/**
 * Forgot Password - Generate reset token and send email
 * POST /api/auth/forgot
 */
const forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ success: false, message: 'Email or phone is required' });
    }

    // Normalize identifier
    const normalizedIdentifier = identifier.includes('@')
      ? identifier.toLowerCase().trim()
      : identifier.trim();

    const where = normalizedIdentifier.includes('@')
      ? { email: normalizedIdentifier }
      : { phone: normalizedIdentifier };

    const user = await User.findOne({ where });

    // Always return success message for security (don't reveal if user exists)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If the account exists, a password reset link has been sent to your email.'
      });
    }

    // Only send reset email if user has an email address
    if (!user.email) {
      return res.status(400).json({
        success: false,
        message: 'Password reset is only available for accounts with an email address. Please contact support.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save reset token to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    // Generate reset URL - ALWAYS use port 3000 (NEVER 5173)
    // Force port 3000 regardless of environment variables
    let frontendUrl = 'http://localhost:3000';

    // Only use environment variable if it's explicitly set AND doesn't contain 5173
    if (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes(':5173')) {
      frontendUrl = process.env.FRONTEND_URL;
    } else if (process.env.CORS_ORIGIN && !process.env.CORS_ORIGIN.includes(':5173')) {
      frontendUrl = process.env.CORS_ORIGIN;
    }

    // FORCE port 3000 - replace any port with 3000
    if (frontendUrl.includes('localhost')) {
      frontendUrl = frontendUrl.replace(/localhost:\d+/, 'localhost:3000');
      if (!frontendUrl.includes(':')) {
        frontendUrl = 'http://localhost:3000';
      }
    }

    // Final safety check - if somehow it still has 5173, force it to 3000
    if (frontendUrl.includes(':5173')) {
      frontendUrl = frontendUrl.replace(':5173', ':3000');
      console.warn(`[WARN] Forced port change from 5173 to 3000`);
    }

    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    // Log the reset URL in development for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Password reset URL generated: ${resetUrl}`);
      console.log(`[DEV] Frontend URL used: ${frontendUrl}`);
      console.log(`[DEV] If link doesn't work, go to: http://localhost:3000/reset-password and enter token manually`);
    }

    // Send reset email - try to send immediately
    let emailSent = false;
    let emailError = null;
    try {
      const emailResult = await sendPasswordResetEmail(user.email, user.name, resetToken, resetUrl, user.id);
      emailSent = emailResult?.success === true;
      if (!emailSent) {
        emailError = emailResult?.message || 'Email service returned failure';
        console.error('Password reset email failed:', emailError);
      } else {
        console.log(`Password reset email sent successfully to ${user.email}`);
      }
    } catch (emailErr) {
      emailError = emailErr?.message || emailErr?.toString() || 'Unknown email error';
      console.error('Password reset email send error:', emailError);
      // Log full error details in development
      if (process.env.NODE_ENV !== 'production') {
        console.error('Full email error stack:', emailErr?.stack || emailErr);
        // Check if email service is configured
        const hasBirdConfig = !!(process.env.BIRD_API_KEY && process.env.BIRD_SENDER_EMAIL);
        const hasSmtpConfig = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
        if (!hasBirdConfig && !hasSmtpConfig) {
          console.error('⚠️  EMAIL SERVICE NOT CONFIGURED!');
          console.error('   Please configure either:');
          console.error('   - BIRD_API_KEY and BIRD_SENDER_EMAIL (for Bird.com), or');
          console.error('   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (for SMTP)');
        }
      }
    }

    // If email failed in production, still return success for security (don't reveal if email failed)
    // But log the error for admin review
    if (!emailSent && process.env.NODE_ENV === 'production') {
      console.error(`[PROD] Password reset email failed for user ${user.id} (${user.email}): ${emailError}`);
    }

    // Log action in background
    setImmediate(() => {
      logAction(user.id, 'FORGOT_PASSWORD_REQUEST', 'User', user.id, {}, req).catch(err => {
        console.error('Failed to log audit action:', err);
      });
    });

    // Log reset token in non-production for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] Reset token for ${user.email}: ${resetToken}`);
      console.log(`[DEV] Reset URL: ${resetUrl}`);
    }

    return res.json({
      success: true,
      message: 'If the account exists, a password reset link has been sent to your email.',
      devResetUrl: process.env.NODE_ENV !== 'production' ? resetUrl : undefined,
      // Include frontend URL info for debugging
      frontendUrl: process.env.NODE_ENV !== 'production' ? frontendUrl : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process request',
      error: error.message
    });
  }
};

/**
 * Verify Reset Token
 * GET /api/auth/verify-reset-token?token=xxx&email=xxx
 */
const verifyResetToken = async (req, res) => {
  try {
    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: 'Token and email are required'
      });
    }

    const user = await User.findOne({
      where: {
        email: email.toLowerCase().trim(),
        resetToken: token
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Check if token is expired
    if (!user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired. Please request a new one.'
      });
    }

    return res.json({
      success: true,
      message: 'Reset token is valid'
    });
  } catch (error) {
    console.error('Verify reset token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify token',
      error: error.message
    });
  }
};

/**
 * Reset Password - Validate token and update password
 * POST /api/auth/reset
 */
const resetPassword = async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token, email, and new password are required'
      });
    }

    // Validate password strength using system settings
    const { validatePassword } = require('../utils/passwordValidator');
    const passwordValidation = await validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message
      });
    }

    const user = await User.findOne({
      where: {
        email: email.toLowerCase().trim(),
        resetToken: token
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Check if token is expired
    if (!user.resetTokenExpiry || new Date() > new Date(user.resetTokenExpiry)) {
      return res.status(400).json({
        success: false,
        message: 'Reset token has expired. Please request a new one.'
      });
    }

    // Update password and clear reset token
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await user.save();

    // Log action in background
    setImmediate(() => {
      logAction(user.id, 'PASSWORD_RESET', 'User', user.id, {}, req).catch(err => {
        console.error('Failed to log audit action:', err);
      });
    });

    return res.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password',
      error: error.message
    });
  }
};
/**
 * Email/Phone + Password Login
 * POST /api/auth/login
 */
const passwordLogin = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Identifier and password required' });
    }

    // Accept email or phone
    const where = identifier.includes('@') ? { email: identifier } : { phone: identifier };
    const user = await User.findOne({ where });
    if (!user || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Only approved (active) users may proceed to OTP
    if (user.status === 'burned') {
      return res.status(403).json({
        success: false,
        message: 'Your account is temporarily burned contact group admin'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Your account is awaiting approval from your Group Admin.' });
    }

    // Generate and send OTP, do not issue JWT yet
    const otp = generateOTP();
    const otpExpiry = generateOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES) || 10);
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Log OTP in non-production for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${user.email || user.phone}: ${otp}`);
    }

    // Send response immediately, don't wait for notifications
    res.json({
      success: true,
      message: 'OTP sent. Please verify to continue.',
      data: {
        otpRequired: true,
        contact: user.phone || user.email,
        devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
      }
    });

    // Send notifications in background (non-blocking)
    setImmediate(async () => {
      try {
        if (user.phone) await sendOTP(user.phone, otp);
      } catch (smsErr) {
        console.warn('OTP SMS send failed:', smsErr?.message || smsErr);
      }
      try {
        if (user.email) await sendOtpEmail(user.email, user.name, otp);
      } catch (emailErr) {
        console.warn('OTP email send failed:', emailErr?.message || emailErr);
      }
    });

    // Log action in background (non-blocking)
    setImmediate(() => {
      logAction(user.id, 'LOGIN_PASSWORD_OTP_SENT', 'User', user.id, {}, req).catch(err => {
        console.error('Failed to log audit action:', err);
      });
    });
  } catch (error) {
    console.error('Password login error:', error);
    res.status(500).json({ success: false, message: 'Failed to login', error: error.message });
  }
};


/**
 * Send OTP to phone number
 * POST /api/auth/send-otp
 */
const sendOTPCode = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Format phone number (ensure +250 prefix)
    const formattedPhone = phone.startsWith('+') ? phone : `+250${phone.replace(/^0/, '')}`;

    // Find or create user
    let user = await User.findOne({ where: { phone: formattedPhone } });

    if (!user) {
      // For demo purposes, create user if not exists
      // In production, this should be registration flow
      user = await User.create({
        phone: formattedPhone,
        name: 'User',
        role: 'Member',
        status: 'pending'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = generateOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES) || 10);

    // Save OTP to user
    user.otp = otp;
    user.otpExpiry = otpExpiry;
    await user.save();

    // Log OTP in non-production for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[DEV] OTP for ${user.email || user.phone}: ${otp}`);
    }

    // Send OTP via SMS
    try {
      await sendOTP(formattedPhone, otp);
    } catch (smsError) {
      console.error('SMS sending failed:', smsError);
      // Continue even if SMS fails (for development)
    }

    logAction(user.id, 'OTP_REQUESTED', 'User', user.id, { phone: formattedPhone }, req);

    res.json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phone: formattedPhone,
        expiry: otpExpiry,
        devOtp: process.env.NODE_ENV !== 'production' ? otp : undefined
      }
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP',
      error: error.message
    });
  }
};

/**
 * Verify OTP and login
 * POST /api/auth/verify-otp
 */
const verifyOTP = async (req, res) => {
  try {
    const { phone, otp, identifier } = req.body;

    if ((!phone && !identifier) || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Identifier/phone and OTP are required'
      });
    }

    let user;
    if (phone) {
      const formattedPhone = phone.startsWith('+') ? phone : `+250${phone.replace(/^0/, '')}`;
      user = await User.findOne({ where: { phone: formattedPhone } });
    } else if (identifier) {
      if (identifier.includes('@')) {
        user = await User.findOne({ where: { email: identifier } });
      } else {
        const formattedPhone = identifier.startsWith('+') ? identifier : `+250${identifier.replace(/^0/, '')}`;
        user = await User.findOne({ where: { phone: formattedPhone } });
      }
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if OTP matches and not expired
    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    if (isOTPExpired(user.otpExpiry)) {
      return res.status(400).json({
        success: false,
        message: 'OTP has expired. Please request a new one.'
      });
    }

    // Clear OTP
    user.otp = null;
    user.otpExpiry = null;
    user.lastLogin = new Date();
    if (user.status === 'pending') {
      user.status = 'active';
    }
    await user.save();

    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET || 'umurenge_wallet_secret_key_change_in_production_2024';
    // Get session timeout from system settings
    const { Setting } = require('../models');
    let sessionTimeoutMinutes = 30; // Default
    try {
      const timeoutSetting = await Setting.findOne({ where: { key: 'system_sessionTimeout' } });
      if (timeoutSetting) {
        sessionTimeoutMinutes = parseInt(timeoutSetting.value) || 30;
      }
    } catch (error) {
      console.error('[verifyOTP] Error getting session timeout:', error);
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      jwtSecret,
      { expiresIn: `${sessionTimeoutMinutes}m` }
    );

    // Send welcome notification if first login
    if (user.status === 'active' && !user.lastLogin) {
      try {
        if (user.email) {
          await sendWelcomeEmail(user.email, user.name);
        }
        await sendRegistrationConfirmation(user.phone, user.name);
      } catch (notifError) {
        console.error('Notification error:', notifError);
      }
    }

    logAction(user.id, 'LOGIN', 'User', user.id, {}, req);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          groupId: user.groupId,
          totalSavings: user.totalSavings,
          creditScore: user.creditScore,
          language: user.language,
          permissions: user.permissions
        }
      }
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP',
      error: error.message
    });
  }
};

/**
 * Get current user
 * GET /api/auth/me
 */
const getCurrentUser = async (req, res) => {
  try {
    const { Contribution } = require('../models');

    // Fetch user with group information
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password', 'otp', 'otpExpiry'] },
      include: [{ association: 'group', attributes: ['id', 'name', 'code'] }]
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Calculate totalSavings from actual approved contributions (source of truth)
    const approvedContributions = await Contribution.findAll({
      where: {
        memberId: user.id,
        status: 'approved'
      },
      attributes: ['amount']
    });

    const calculatedTotalSavings = approvedContributions.reduce((sum, c) => {
      return sum + parseFloat(c.amount || 0);
    }, 0);

    // Sync stored value if different (update in background, don't wait)
    const storedTotalSavings = parseFloat(user.totalSavings || 0);
    if (Math.abs(storedTotalSavings - calculatedTotalSavings) > 0.01) {
      user.totalSavings = calculatedTotalSavings;
      user.save().catch(err => {
        console.warn('Failed to sync user totalSavings:', err.message);
      });
    }

    // Fetch user settings (2FA, notifications, etc.)
    const { Setting } = require('../models');
    const twoFactorSetting = await Setting.findOne({
      where: { key: `user_${user.id}_twoFactorEnabled` }
    });
    const biometricSetting = await Setting.findOne({
      where: { key: `user_${user.id}_biometricEnabled` }
    });
    const notificationSetting = await Setting.findOne({
      where: { key: `user_${user.id}_notificationPreferences` }
    });

    let twoFactorEnabled = false;
    let biometricEnabled = false;
    let notificationPreferences = {
      emailNotifications: true,
      smsNotifications: true,
      pushNotifications: true,
      contributionReminders: true,
      loanReminders: true,
      groupAnnouncements: true,
      paymentConfirmations: true
    };

    if (twoFactorSetting) {
      try {
        twoFactorEnabled = JSON.parse(twoFactorSetting.value);
      } catch (e) {
        twoFactorEnabled = false;
      }
    }

    if (biometricSetting) {
      try {
        biometricEnabled = JSON.parse(biometricSetting.value);
      } catch (e) {
        biometricEnabled = false;
      }
    }

    if (notificationSetting) {
      try {
        notificationPreferences = JSON.parse(notificationSetting.value);
      } catch (e) {
        // Use defaults if parsing fails
      }
    }

    // Send response immediately with calculated totalSavings
    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        groupId: user.groupId,
        branchId: user.branchId,
        totalSavings: calculatedTotalSavings, // Use calculated value from contributions
        creditScore: user.creditScore || 0,
        language: user.language,
        status: user.status,
        nationalId: user.nationalId,
        occupation: user.occupation,
        address: user.address,
        dateOfBirth: user.dateOfBirth,
        profileImage: user.profileImage,
        permissions: user.permissions,
        twoFactorEnabled,
        biometricEnabled,
        notificationPreferences,
        group: user.group ? {
          id: user.group.id,
          name: user.group.name,
          code: user.group.code
        } : null
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user',
      error: error.message
    });
  }
};

/**
 * Demo login (deprecated for production) - keep route but return 400 to prevent demo users
 */
const demoLogin = async (req, res) => {
  return res.status(400).json({ success: false, message: 'Demo login is disabled. Use email/phone + password.' });
};

module.exports = {
  sendOTPCode,
  verifyOTP,
  getCurrentUser,
  demoLogin,
  passwordLogin,
  forgotPassword,
  verifyResetToken,
  resetPassword
};

