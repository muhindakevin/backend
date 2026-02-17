const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { User, Setting } = require('../models');
const { logAction } = require('../utils/auditLogger');

/**
 * Generate 2FA secret and QR code
 * GET /api/auth/2fa/setup
 */
const setup2FA = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if 2FA is already enabled
    const twoFactorSetting = await Setting.findOne({
      where: { key: `user_${user.id}_twoFactorEnabled` }
    });
    
    if (twoFactorSetting && JSON.parse(twoFactorSetting.value) === true) {
      return res.status(400).json({
        success: false,
        message: '2FA is already enabled. Disable it first to set up a new one.'
      });
    }

    // Generate secret
    const secret = speakeasy.generateSecret({
      name: `IKIMINA WALLET (${user.email || user.phone})`,
      length: 32
    });

    // Store secret temporarily (will be confirmed after verification)
    const secretKey = `user_${user.id}_twoFactorSecret`;
    const [secretSetting] = await Setting.findOrCreate({
      where: { key: secretKey },
      defaults: { value: JSON.stringify(secret.base32) }
    });
    secretSetting.value = JSON.stringify(secret.base32);
    await secretSetting.save();

    // Generate QR code
    const otpauthUrl = secret.otpauth_url;
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    res.json({
      success: true,
      data: {
        secret: secret.base32,
        qrCode: qrCodeDataUrl,
        manualEntryKey: secret.base32
      }
    });
  } catch (error) {
    console.error('Setup 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to setup 2FA',
      error: error.message
    });
  }
};

/**
 * Verify 2FA token and enable 2FA
 * POST /api/auth/2fa/verify
 */
const verify2FA = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get stored secret
    const secretSetting = await Setting.findOne({
      where: { key: `user_${user.id}_twoFactorSecret` }
    });

    if (!secretSetting) {
      return res.status(400).json({
        success: false,
        message: '2FA setup not found. Please set up 2FA first.'
      });
    }

    const secret = JSON.parse(secretSetting.value);

    // Verify token
    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // Allow 2 time steps (60 seconds) of tolerance
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token. Please try again.'
      });
    }

    // Enable 2FA
    const [twoFactorSetting] = await Setting.findOrCreate({
      where: { key: `user_${user.id}_twoFactorEnabled` },
      defaults: { value: JSON.stringify(true) }
    });
    twoFactorSetting.value = JSON.stringify(true);
    await twoFactorSetting.save();

    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(Math.random().toString(36).substring(2, 10).toUpperCase());
    }

    // Store backup codes
    const backupCodesKey = `user_${user.id}_twoFactorBackupCodes`;
    const [backupCodesSetting] = await Setting.findOrCreate({
      where: { key: backupCodesKey },
      defaults: { value: JSON.stringify(backupCodes) }
    });
    backupCodesSetting.value = JSON.stringify(backupCodes);
    await backupCodesSetting.save();

    logAction(user.id, 'ENABLE_2FA', 'User', user.id, {}, req);

    res.json({
      success: true,
      message: '2FA enabled successfully',
      data: {
        backupCodes: backupCodes // Show only once
      }
    });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify 2FA',
      error: error.message
    });
  }
};

/**
 * Disable 2FA
 * POST /api/auth/2fa/disable
 */
const disable2FA = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required to disable 2FA'
      });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify password
    const bcrypt = require('bcryptjs');
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Disable 2FA
    const twoFactorSetting = await Setting.findOne({
      where: { key: `user_${user.id}_twoFactorEnabled` }
    });
    if (twoFactorSetting) {
      twoFactorSetting.value = JSON.stringify(false);
      await twoFactorSetting.save();
    }

    // Delete secret and backup codes (optional - for security)
    await Setting.destroy({
      where: { key: `user_${user.id}_twoFactorSecret` }
    });
    await Setting.destroy({
      where: { key: `user_${user.id}_twoFactorBackupCodes` }
    });

    logAction(user.id, 'DISABLE_2FA', 'User', user.id, {}, req);

    res.json({
      success: true,
      message: '2FA disabled successfully'
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to disable 2FA',
      error: error.message
    });
  }
};

/**
 * Verify 2FA token (for login)
 * POST /api/auth/2fa/verify-token
 */
const verifyToken = async (req, res) => {
  try {
    const { token, userId } = req.body;
    if (!token || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Token and userId are required'
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get stored secret
    const secretSetting = await Setting.findOne({
      where: { key: `user_${user.id}_twoFactorSecret` }
    });

    if (!secretSetting) {
      return res.status(400).json({
        success: false,
        message: '2FA not set up for this user'
      });
    }

    const secret = JSON.parse(secretSetting.value);

    // Verify token
    let verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2
    });

    // If token verification fails, check backup codes
    if (!verified) {
      const backupCodesSetting = await Setting.findOne({
        where: { key: `user_${user.id}_twoFactorBackupCodes` }
      });

      if (backupCodesSetting) {
        const backupCodes = JSON.parse(backupCodesSetting.value);
        const codeIndex = backupCodes.indexOf(token.toUpperCase());
        
        if (codeIndex !== -1) {
          // Remove used backup code
          backupCodes.splice(codeIndex, 1);
          backupCodesSetting.value = JSON.stringify(backupCodes);
          await backupCodesSetting.save();
          verified = true;
        }
      }
    }

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token'
      });
    }

    res.json({
      success: true,
      message: 'Token verified successfully'
    });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify token',
      error: error.message
    });
  }
};

module.exports = {
  setup2FA,
  verify2FA,
  disable2FA,
  verifyToken
};

