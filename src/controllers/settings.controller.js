const bcrypt = require('bcryptjs');
const { Group, User, Setting, Notification, Announcement, AuditLog } = require('../models');
const { logAction } = require('../utils/auditLogger');
const { sendSMS } = require('../notifications/smsService');
const { sendEmail } = require('../notifications/emailService');
const { Op } = require('sequelize');

/**
 * Get group settings
 * GET /api/groups/:id/settings
 */
const getGroupSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Check permissions first
    if (user.role === 'Group Admin' && user.groupId !== parseInt(id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Fetch group directly from database
    const group = await Group.findByPk(id, {
      attributes: ['id', 'name', 'description', 'district', 'sector', 'cell', 'registrationDate']
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Fetch settings from database
    const settings = await Setting.findAll({
      where: {
        key: {
          [Op.like]: `group_${id}_%`
        }
      },
      attributes: ['key', 'value']
    });

    // Convert settings array to object
    const settingsObj = {};
    if (settings && Array.isArray(settings)) {
      settings.forEach(setting => {
        const key = setting.key.replace(`group_${id}_`, '');
        try {
          settingsObj[key] = JSON.parse(setting.value);
        } catch {
          settingsObj[key] = setting.value;
        }
      });
    }

    // Build location string from group data
    const locationParts = [];
    if (group.district) locationParts.push(group.district);
    if (group.sector) locationParts.push(group.sector);
    if (group.cell) locationParts.push(group.cell);
    const groupLocation = locationParts.join(', ');

    // Merge with group data - fetch directly from database
    const defaultSettings = {
      // General - fetched directly from Group table
      groupName: group.name || '',
      groupDescription: group.description || '',
      groupLocation: groupLocation,
      establishedDate: group.registrationDate ? new Date(group.registrationDate).toISOString().split('T')[0] : '',
      meetingDay: settingsObj.meetingDay || 'Saturday',
      meetingTime: settingsObj.meetingTime || '14:00',
      
      // Contributions
      minimumContribution: settingsObj.minimumContribution || 5000,
      maximumContribution: settingsObj.maximumContribution || 50000,
      contributionDueDate: settingsObj.contributionDueDate || 15,
      lateFee: settingsObj.lateFee || 500,
      gracePeriod: settingsObj.gracePeriod || 5,
      
      // Loans
      maxLoanAmount: settingsObj.maxLoanAmount || 200000,
      loanInterestRate: settingsObj.loanInterestRate || 2.5,
      loanDuration: settingsObj.loanDuration || 6,
      loanProcessingFee: settingsObj.loanProcessingFee || 1000,
      
      // Notifications
      emailNotifications: settingsObj.emailNotifications !== undefined ? settingsObj.emailNotifications : true,
      smsNotifications: settingsObj.smsNotifications !== undefined ? settingsObj.smsNotifications : true,
      meetingReminders: settingsObj.meetingReminders !== undefined ? settingsObj.meetingReminders : true,
      paymentReminders: settingsObj.paymentReminders !== undefined ? settingsObj.paymentReminders : true,
      
      // Security
      requireTwoFactor: settingsObj.requireTwoFactor !== undefined ? settingsObj.requireTwoFactor : false,
      sessionTimeout: settingsObj.sessionTimeout || 30,
      passwordPolicy: settingsObj.passwordPolicy || 'medium',
      auditLogging: settingsObj.auditLogging !== undefined ? settingsObj.auditLogging : true
    };

    res.json({
      success: true,
      data: defaultSettings
    });
  } catch (error) {
    console.error('[getGroupSettings] Error:', error);
    console.error('[getGroupSettings] Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
      error: error.message
    });
  }
};

/**
 * Update group settings
 * PUT /api/groups/:id/settings
 */
const updateGroupSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const settings = req.body;

    // Verify user has access
    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check permissions
    if (user.role === 'Group Admin' && user.groupId !== parseInt(id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const changes = [];
    const oldValues = {};

    // Update group basic info
    if (settings.groupName && settings.groupName !== group.name) {
      oldValues.name = group.name;
      group.name = settings.groupName;
      changes.push(`Group name changed from "${oldValues.name}" to "${settings.groupName}"`);
    }

    if (settings.groupDescription !== undefined && settings.groupDescription !== group.description) {
      oldValues.description = group.description;
      group.description = settings.groupDescription;
      changes.push('Group description updated');
    }

    // Parse location if provided
    if (settings.groupLocation) {
      const locationParts = settings.groupLocation.split(',').map(s => s.trim());
      if (locationParts.length >= 1) group.district = locationParts[0];
      if (locationParts.length >= 2) group.sector = locationParts[1];
      if (locationParts.length >= 3) group.cell = locationParts[2];
    }

    if (settings.establishedDate) {
      group.registrationDate = new Date(settings.establishedDate);
    }

    await group.save();

    // Save other settings to Setting model
    const settingsToSave = {
      meetingDay: settings.meetingDay,
      meetingTime: settings.meetingTime,
      minimumContribution: settings.minimumContribution,
      maximumContribution: settings.maximumContribution,
      contributionDueDate: settings.contributionDueDate,
      lateFee: settings.lateFee,
      gracePeriod: settings.gracePeriod,
      maxLoanAmount: settings.maxLoanAmount,
      loanInterestRate: settings.loanInterestRate,
      loanDuration: settings.loanDuration,
      loanProcessingFee: settings.loanProcessingFee,
      emailNotifications: settings.emailNotifications,
      smsNotifications: settings.smsNotifications,
      meetingReminders: settings.meetingReminders,
      paymentReminders: settings.paymentReminders,
      requireTwoFactor: settings.requireTwoFactor,
      sessionTimeout: settings.sessionTimeout,
      passwordPolicy: settings.passwordPolicy,
      auditLogging: settings.auditLogging
    };

    for (const [key, value] of Object.entries(settingsToSave)) {
      if (value !== undefined) {
        const settingKey = `group_${id}_${key}`;
        const [setting] = await Setting.findOrCreate({
          where: { key: settingKey },
          defaults: { value: JSON.stringify(value) }
        });
        
        if (setting.value !== JSON.stringify(value)) {
          oldValues[key] = setting.value;
          setting.value = JSON.stringify(value);
          await setting.save();
          changes.push(`${key} updated`);
        }
      }
    }

    // Log changes
    if (changes.length > 0) {
      logAction(user.id, 'UPDATE_GROUP_SETTINGS', 'Group', id, { changes, oldValues }, req);

      // Send notifications to all group members
      const members = await User.findAll({
        where: {
          groupId: parseInt(id),
          status: 'active'
        },
        attributes: ['id', 'name', 'phone', 'email']
      });

      const notificationMessage = `Group settings have been updated:\n${changes.join('\n')}`;
      
      // Create announcement
      await Announcement.create({
        groupId: parseInt(id),
        title: 'Group Settings Updated',
        content: notificationMessage,
        priority: 'high',
        createdBy: user.id,
        status: 'sent',
        sentAt: new Date()
      });

      // Create notifications for all members
      const notifications = members.map(member => ({
        userId: member.id,
        type: 'settings_update',
        channel: 'in_app',
        title: 'Group Settings Updated',
        content: notificationMessage,
        status: 'sent'
      }));

      await Notification.bulkCreate(notifications);

      // Send SMS/Email to members (if enabled)
      for (const member of members) {
        if (settings.smsNotifications && member.phone) {
          try {
            await sendSMS(member.phone, `IKIMINA WALLET: ${notificationMessage}`, member.id, 'settings');
          } catch (err) {
            console.error(`Failed to send SMS to ${member.phone}:`, err);
          }
        }
        if (settings.emailNotifications && member.email) {
          try {
            await sendEmail(member.email, 'Group Settings Updated', notificationMessage, member.id, 'settings');
          } catch (err) {
            console.error(`Failed to send email to ${member.email}:`, err);
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: { changes: changes.length }
    });
  } catch (error) {
    console.error('Update group settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update settings',
      error: error.message
    });
  }
};

/**
 * Reset group settings to default
 * POST /api/groups/:id/settings/reset
 */
const resetGroupSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Verify user has access
    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check permissions
    if (user.role === 'Group Admin' && user.groupId !== parseInt(id)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Delete all group settings
    await Setting.destroy({
      where: {
        key: {
          [Op.like]: `group_${id}_%`
        }
      }
    });

    logAction(user.id, 'RESET_GROUP_SETTINGS', 'Group', id, {}, req);

    res.json({
      success: true,
      message: 'Settings reset to default values'
    });
  } catch (error) {
    console.error('Reset group settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset settings',
      error: error.message
    });
  }
};

/**
 * Update user profile (all fields)
 * PUT /api/auth/profile
 */
const updateProfile = async (req, res) => {
  try {
    const { 
      name, phone, email, password, currentPassword, 
      occupation, address, dateOfBirth, nationalId, 
      language, profileImage 
    } = req.body;
    const user = await User.findByPk(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const changes = [];

    // Update name
    if (name && name.trim() && name !== user.name) {
      changes.push(`Name updated from "${user.name}" to "${name}"`);
      user.name = name.trim();
    }

    // Update phone
    if (phone && phone !== user.phone) {
      // Check if phone is already taken
      const existingPhone = await User.findOne({
        where: {
          phone: phone,
          id: { [Op.ne]: user.id }
        }
      });
      if (existingPhone) {
        return res.status(400).json({
          success: false,
          message: 'Phone number already in use'
        });
      }
      changes.push('Phone number updated');
      user.phone = phone;
    }

    // Update email
    if (email !== undefined && email !== user.email) {
      // Check if email is already taken
      if (email && email.trim()) {
        const existingEmail = await User.findOne({
          where: {
            email: email.trim(),
            id: { [Op.ne]: user.id }
          }
        });
        if (existingEmail) {
          return res.status(400).json({
            success: false,
            message: 'Email already in use'
          });
        }
        user.email = email.trim();
      } else {
        user.email = null;
      }
      changes.push('Email updated');
    }

    // Update other profile fields
    if (occupation !== undefined) {
      user.occupation = occupation || null;
      changes.push('Occupation updated');
    }

    if (address !== undefined) {
      user.address = address || null;
      changes.push('Address updated');
    }

    if (dateOfBirth !== undefined) {
      user.dateOfBirth = dateOfBirth ? new Date(dateOfBirth) : null;
      changes.push('Date of birth updated');
    }

    if (nationalId !== undefined) {
      user.nationalId = nationalId || null;
      changes.push('National ID updated');
    }

    if (language !== undefined) {
      user.language = language || 'en';
      changes.push('Language updated');
    }

    if (profileImage !== undefined) {
      user.profileImage = profileImage || null;
      changes.push('Profile image updated');
    }

    // Update 2FA settings
    if (req.body.twoFactorEnabled !== undefined) {
      // Store 2FA preference (actual 2FA implementation would require TOTP setup)
      const settingKey = `user_${user.id}_twoFactorEnabled`;
      const [setting] = await Setting.findOrCreate({
        where: { key: settingKey },
        defaults: { value: JSON.stringify(req.body.twoFactorEnabled) }
      });
      if (setting.value !== JSON.stringify(req.body.twoFactorEnabled)) {
        setting.value = JSON.stringify(req.body.twoFactorEnabled);
        await setting.save();
        changes.push('2FA setting updated');
      }
    }

    if (req.body.biometricEnabled !== undefined) {
      const settingKey = `user_${user.id}_biometricEnabled`;
      const [setting] = await Setting.findOrCreate({
        where: { key: settingKey },
        defaults: { value: JSON.stringify(req.body.biometricEnabled) }
      });
      if (setting.value !== JSON.stringify(req.body.biometricEnabled)) {
        setting.value = JSON.stringify(req.body.biometricEnabled);
        await setting.save();
        changes.push('Biometric setting updated');
      }
    }

    // Update notification preferences
    if (req.body.notificationPreferences) {
      const settingKey = `user_${user.id}_notificationPreferences`;
      const [setting] = await Setting.findOrCreate({
        where: { key: settingKey },
        defaults: { value: JSON.stringify(req.body.notificationPreferences) }
      });
      setting.value = JSON.stringify(req.body.notificationPreferences);
      await setting.save();
      changes.push('Notification preferences updated');
    }

    // Update password
    if (password) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to change password'
        });
      }

      // Verify current password
      const isValid = await bcrypt.compare(currentPassword, user.password);
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      // Validate new password using system settings
      const { validatePassword } = require('../utils/passwordValidator');
      const passwordValidation = await validatePassword(password);
      if (!passwordValidation.valid) {
        return res.status(400).json({
          success: false,
          message: passwordValidation.message
        });
      }

      user.password = await bcrypt.hash(password, 10);
      changes.push('Password updated');
    }

    await user.save();

    if (changes.length > 0) {
      logAction(user.id, 'UPDATE_PROFILE', 'User', user.id, { changes }, req);
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        occupation: user.occupation,
        address: user.address,
        dateOfBirth: user.dateOfBirth,
        nationalId: user.nationalId,
        language: user.language,
        profileImage: user.profileImage
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: error.message
    });
  }
};

module.exports = {
  getGroupSettings,
  updateGroupSettings,
  resetGroupSettings,
  updateProfile
};

