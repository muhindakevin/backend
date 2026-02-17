const { Setting } = require('../models');

/**
 * Get password requirements from system settings
 */
const getPasswordRequirements = async () => {
  try {
    const minLengthSetting = await Setting.findOne({ where: { key: 'system_passwordMinLength' } });
    const requireSpecialSetting = await Setting.findOne({ where: { key: 'system_passwordRequireSpecial' } });

    return {
      minLength: minLengthSetting ? parseInt(minLengthSetting.value) || 8 : 8,
      requireSpecial: requireSpecialSetting ? requireSpecialSetting.value === 'true' || requireSpecialSetting.value === true : true
    };
  } catch (error) {
    console.error('[getPasswordRequirements] Error:', error);
    // Return defaults
    return {
      minLength: 8,
      requireSpecial: true
    };
  }
};

/**
 * Validate password against system requirements
 * @param {string} password - Password to validate
 * @returns {Object} { valid: boolean, message: string }
 */
const validatePassword = async (password) => {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required' };
  }

  const requirements = await getPasswordRequirements();

  // Check minimum length
  if (password.length < requirements.minLength) {
    return {
      valid: false,
      message: `Password must be at least ${requirements.minLength} characters long`
    };
  }

  // Check for special characters if required
  if (requirements.requireSpecial) {
    const specialCharRegex = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/;
    if (!specialCharRegex.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one special character'
      };
    }
  }

  return { valid: true, message: 'Password is valid' };
};

module.exports = {
  getPasswordRequirements,
  validatePassword
};

