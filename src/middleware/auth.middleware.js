const jwt = require('jsonwebtoken');
const { User, Setting } = require('../models');

/**
 * Get session timeout from system settings
 */
const getSessionTimeout = async () => {
  try {
    const setting = await Setting.findOne({ where: { key: 'system_sessionTimeout' } });
    if (setting) {
      const timeout = parseInt(setting.value) || 30;
      return timeout * 60 * 1000; // Convert minutes to milliseconds
    }
    return 30 * 60 * 1000; // Default 30 minutes
  } catch (error) {
    // Silently handle database connection errors - use default timeout
    if (error.name === 'SequelizeConnectionRefusedError' || error.name === 'SequelizeConnectionError') {
      console.warn('[getSessionTimeout] Database connection unavailable, using default timeout');
    } else {
      console.error('[getSessionTimeout] Error:', error.message);
    }
    return 30 * 60 * 1000; // Default 30 minutes
  }
};

/**
 * Verify JWT token and attach user to request
 * Also checks session timeout from system settings
 */
const authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const jwtSecret = process.env.JWT_SECRET || 'umurenge_wallet_secret_key_change_in_production_2024';
    const decoded = jwt.verify(token, jwtSecret);

    // Check session timeout from system settings (with error handling)
    let sessionTimeout;
    try {
      sessionTimeout = await getSessionTimeout();
    } catch (error) {
      // If database is unavailable, use default timeout
      sessionTimeout = 30 * 60 * 1000; // 30 minutes
    }

    const tokenAge = Date.now() - (decoded.iat * 1000); // iat is in seconds

    if (tokenAge > sessionTimeout) {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.'
      });
    }

    // Fetch user with error handling for database connection issues
    let user;
    try {
      user = await User.findByPk(decoded.userId, {
        attributes: { exclude: ['password', 'otp', 'otpExpiry'] }
      });
    } catch (dbError) {
      if (dbError.name === 'SequelizeConnectionRefusedError' || dbError.name === 'SequelizeConnectionError') {
        return res.status(503).json({
          success: false,
          message: 'Database connection unavailable. Please try again later.'
        });
      }
      throw dbError; // Re-throw other errors
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account is inactive or suspended.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }
    next(error);
  }
};

/**
 * Role-based authorization middleware
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }

    next();
  };
};

/**
 * Check if user owns resource or is admin
 */
const authorizeResource = (resourceUserId, adminRoles = ['Group Admin', 'System Admin']) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (req.user.id === resourceUserId || adminRoles.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. You do not have permission to access this resource.'
    });
  };
};



/**
 * Granular permission check
 * Logic:
 * 1. If explicit permission exists (true/false), use it.
 * 2. If no explicit permission, check defaults for the user's role.
 * 3. Default to FALSE (Deny) if not found in role defaults.
 */
/**
 * Granular permission check
 * DISABLED: Always allow access.
 */
const checkPermission = (permission) => {
  return (req, res, next) => {
    // Permission system disabled - allow everything
    next();
  };
};

module.exports = {
  authenticate,
  authorize,
  authorizeResource,
  checkPermission
};

