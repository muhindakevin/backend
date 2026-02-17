const { Setting, User } = require('../models');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');

/**
 * Get all system settings
 * GET /api/system-admin/settings
 */
const getSystemSettings = async (req, res) => {
  try {
    console.log('[getSystemSettings] Fetching system settings...');

    // Check if Setting model is available
    if (!Setting) {
      console.error('[getSystemSettings] Setting model is not available');
      return res.status(500).json({
        success: false,
        message: 'Settings model not available',
        error: 'Setting model not found'
      });
    }

    const settings = await Setting.findAll({
      where: {
        key: {
          [Op.like]: 'system_%'
        }
      }
    });
    console.log(`[getSystemSettings] Found ${settings.length} settings`);

    const settingsMap = {};
    settings.forEach(s => {
      if (!s || !s.key) return;
      const key = s.key.replace('system_', '');
      if (!key) return;
      try {
        // Try to parse as JSON first
        const parsed = JSON.parse(s.value);
        settingsMap[key] = parsed;
      } catch (e) {
        // If not JSON, use as string
        settingsMap[key] = s.value || '';
      }
    });

    // Default values if not set
    const defaults = {
      // General Settings
      organizationName: 'Umurenge SACCO',
      organizationLogo: '',
      primaryColor: '#3B82F6',
      secondaryColor: '#10B981',
      timezone: 'Africa/Kigali',
      currency: 'RWF',
      language: 'en',

      // API Integrations
      integrations: {
        mtn: { apiKey: '', apiSecret: '', enabled: false },
        airtel: { apiKey: '', apiSecret: '', enabled: false },
        bank: { endpoint: '', apiKey: '', enabled: false },
        twilio: { accountSid: '', authToken: '', phoneNumber: '', enabled: false },
        googleMaps: { apiKey: '', enabled: false },
        custom: []
      },

      // Notification Settings
      email: {
        smtpHost: 'smtp.gmail.com',
        smtpPort: '587',
        username: '',
        password: '',
        enabled: true
      },
      smsEnabled: true,
      whatsappEnabled: true,
      pushNotificationsEnabled: true,

      // Security Settings
      passwordMinLength: 8,
      passwordRequireSpecial: true,
      sessionTimeout: 30, // minutes
      twoFactorEnabled: false,
      ipWhitelist: '',
      auditLogRetention: 365,

      // Terms
      termsOfService: 'By using this platform, you agree to our terms of service...',
      privacyPolicy: 'We respect your privacy and protect your personal data...',
      loanTerms: 'Loan terms and conditions apply...'
    };

    // Merge with defaults
    const merged = { ...defaults };

    // Merge flat settings
    Object.keys(settingsMap).forEach(key => {
      if (key !== 'integrations' && key !== 'email') {
        merged[key] = settingsMap[key];
      }
    });

    // Ensure nested objects are merged properly
    if (settingsMap.integrations) {
      try {
        const integrations = typeof settingsMap.integrations === 'string'
          ? JSON.parse(settingsMap.integrations)
          : settingsMap.integrations;
        merged.integrations = { ...defaults.integrations, ...integrations };
      } catch (e) {
        console.error('[getSystemSettings] Error parsing integrations:', e);
        merged.integrations = defaults.integrations;
      }
    }

    if (settingsMap.email) {
      try {
        const email = typeof settingsMap.email === 'string'
          ? JSON.parse(settingsMap.email)
          : settingsMap.email;
        merged.email = { ...defaults.email, ...email };
      } catch (e) {
        console.error('[getSystemSettings] Error parsing email:', e);
        merged.email = defaults.email;
      }
    }

    console.log('[getSystemSettings] Returning merged settings');
    res.json({ success: true, data: merged });
  } catch (error) {
    console.error('[getSystemSettings] Error:', error);
    console.error('[getSystemSettings] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Save system settings
 * PUT /api/system-admin/settings
 */
const saveSystemSettings = async (req, res) => {
  try {
    const settings = req.body;
    const changes = [];

    // Save each setting
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined && value !== null) {
        const settingKey = `system_${key}`;
        const [setting] = await Setting.findOrCreate({
          where: { key: settingKey },
          defaults: { value: typeof value === 'object' ? JSON.stringify(value) : String(value) }
        });

        const oldValue = setting.value;
        setting.value = typeof value === 'object' ? JSON.stringify(value) : String(value);
        await setting.save();

        if (oldValue !== setting.value) {
          changes.push(key);
        }
      }
    }

    // Update email service configuration if email settings changed
    if (settings.email) {
      // This will be picked up by email service on next use
      console.log('[saveSystemSettings] Email settings updated');
    }

    logAction(req.user.id, 'SAVE_SYSTEM_SETTINGS', 'Setting', null, { changes }, req);

    res.json({ success: true, message: 'Settings saved successfully', data: { changes: changes.length } });
  } catch (error) {
    console.error('[saveSystemSettings] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to save settings', error: error.message });
  }
};

/**
 * Test API connection
 * POST /api/system-admin/settings/test-connection
 */
const testConnection = async (req, res) => {
  try {
    const { type, config } = req.body;

    console.log('[testConnection] Received request:', { type, configKeys: config ? Object.keys(config) : 'no config' });

    if (!type) {
      return res.status(400).json({ success: false, message: 'Connection type is required' });
    }

    if (!config) {
      return res.status(400).json({ success: false, message: 'Configuration is required' });
    }

    let result = { success: false, message: 'Unknown connection type' };

    switch (type) {
      case 'email':
        // Test SMTP connection
        try {
          const nodemailer = require('nodemailer');
          const transporter = nodemailer.createTransport({
            host: config.smtpHost,
            port: parseInt(config.smtpPort || '587'),
            secure: config.smtpPort === '465',
            auth: {
              user: config.username,
              pass: config.password
            }
          });
          await transporter.verify();
          result = { success: true, message: 'SMTP connection successful' };
        } catch (error) {
          result = { success: false, message: `SMTP connection failed: ${error.message}` };
        }
        break;

      case 'mtn':
      case 'airtel':
        // Test mobile money API
        result = { success: true, message: `${type.toUpperCase()} API connection test (mock)` };
        break;

      case 'bank':
        // Test bank API
        try {
          const fetch = require('node-fetch');
          const response = await fetch(config.endpoint, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${config.apiKey}`,
              'Content-Type': 'application/json'
            }
          });
          result = { success: response.ok, message: response.ok ? 'Bank API connection successful' : 'Bank API connection failed' };
        } catch (error) {
          result = { success: false, message: `Bank API connection failed: ${error.message}` };
        }
        break;

      case 'twilio':
        // Test Twilio connection
        try {
          const twilio = require('twilio');
          const client = twilio(config.accountSid, config.authToken);
          await client.api.accounts(config.accountSid).fetch();
          result = { success: true, message: 'Twilio connection successful' };
        } catch (error) {
          result = { success: false, message: `Twilio connection failed: ${error.message}` };
        }
        break;

      case 'googleMaps':
        // Test Google Maps API key
        try {
          if (!config.apiKey) {
            result = { success: false, message: 'Google Maps API key is required' };
            break;
          }

          console.log('[testConnection] Testing Google Maps API key...');

          // Use Node.js built-in https module for better compatibility
          const https = require('https');
          const url = require('url');

          // Try multiple endpoints to test the API key
          // First, try Places API (most commonly used)
          const testUrls = [
            {
              name: 'Places API',
              url: `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=Kigali&inputtype=textquery&fields=formatted_address&key=${config.apiKey}`
            },
            {
              name: 'Geocoding API',
              url: `https://maps.googleapis.com/maps/api/geocode/json?address=Kigali,Rwanda&key=${config.apiKey}`
            },
            {
              name: 'Maps JavaScript API',
              url: `https://maps.googleapis.com/maps/api/js?key=${config.apiKey}`
            }
          ];

          let lastError = null;
          let successCount = 0;

          for (const test of testUrls) {
            try {
              const parsedUrl = url.parse(test.url);

              const requestPromise = new Promise((resolve, reject) => {
                const req = https.get({
                  hostname: parsedUrl.hostname,
                  path: parsedUrl.path,
                  method: 'GET'
                }, (res) => {
                  let data = '';
                  res.on('data', (chunk) => {
                    data += chunk;
                  });
                  res.on('end', () => {
                    // For Maps JavaScript API, it returns HTML/JS, not JSON
                    if (test.name === 'Maps JavaScript API') {
                      if (res.statusCode === 200 && !data.includes('RefererNotAllowedMapError') && !data.includes('ApiNotActivatedMapError')) {
                        resolve({ status: 'OK', api: test.name });
                      } else {
                        resolve({ status: 'ERROR', api: test.name, error: data.substring(0, 200) });
                      }
                    } else {
                      try {
                        const jsonData = JSON.parse(data);
                        resolve({ ...jsonData, api: test.name });
                      } catch (e) {
                        resolve({ status: 'ERROR', api: test.name, error: 'Invalid JSON response' });
                      }
                    }
                  });
                });

                req.on('error', (error) => {
                  reject({ error, api: test.name });
                });

                req.setTimeout(10000, () => {
                  req.destroy();
                  reject({ error: new Error('Request timeout'), api: test.name });
                });
              });

              const data = await requestPromise;
              console.log(`[testConnection] ${test.name} response:`, data.status || 'OK');

              if (data.status === 'OK' || data.status === 'ZERO_RESULTS' || (test.name === 'Maps JavaScript API' && data.status === 'OK')) {
                successCount++;
                if (successCount === 1) {
                  // First successful test is enough
                  result = {
                    success: true,
                    message: `Google Maps API key is valid! ${test.name} is working.`
                  };
                  break;
                }
              } else if (data.status === 'REQUEST_DENIED') {
                lastError = {
                  api: test.name,
                  message: data.error_message || 'API key is restricted or invalid',
                  details: `For ${test.name}, you need to: 1) Enable the API in Google Cloud Console, 2) Check API key restrictions, 3) Ensure billing is enabled`
                };
              } else if (data.status === 'OVER_QUERY_LIMIT') {
                lastError = {
                  api: test.name,
                  message: 'API quota exceeded. Please check your billing.',
                  details: 'Your Google Cloud project may have exceeded the free tier or billing is not enabled'
                };
              } else {
                lastError = {
                  api: test.name,
                  message: data.error_message || `API returned status: ${data.status}`,
                  details: `Check if ${test.name} is enabled in Google Cloud Console`
                };
              }
            } catch (error) {
              console.error(`[testConnection] ${test.name} test error:`, error);
              lastError = {
                api: test.name,
                message: error.error?.message || error.message || 'Request failed',
                details: 'Network or configuration issue'
              };
            }
          }

          // If we got here and no success, use the last error
          if (!result.success && lastError) {
            result = {
              success: false,
              message: `${lastError.api}: ${lastError.message}`,
              details: lastError.details
            };
          } else if (!result.success) {
            result = {
              success: false,
              message: 'Could not validate API key. Please check:',
              details: '1) Enable "Maps JavaScript API" in Google Cloud Console\n2) Check API key restrictions\n3) Ensure billing is enabled\n4) Verify the API key is correct'
            };
          }
        } catch (error) {
          console.error('[testConnection] Google Maps test error:', error);
          result = { success: false, message: `Google Maps API test failed: ${error.message}` };
        }
        break;

      default:
        console.log('[testConnection] Unknown connection type:', type);
        result = { success: false, message: `Unknown connection type: ${type}` };
    }

    console.log('[testConnection] Returning result:', result);
    res.json(result);
  } catch (error) {
    console.error('[testConnection] Error:', error);
    res.status(500).json({ success: false, message: 'Connection test failed', error: error.message });
  }
};

/**
 * Add custom API integration
 * POST /api/system-admin/settings/integrations/custom
 */
const addCustomIntegration = async (req, res) => {
  try {
    const { name, type, endpoint, apiKey, apiSecret, config } = req.body;

    // Get current integrations
    const setting = await Setting.findOne({ where: { key: 'system_integrations' } });
    let integrations = { custom: [] };

    if (setting) {
      try {
        integrations = JSON.parse(setting.value);
      } catch {
        integrations = { custom: [] };
      }
    }

    if (!integrations.custom) {
      integrations.custom = [];
    }

    // Add new custom integration
    const newIntegration = {
      id: Date.now(),
      name,
      type,
      endpoint,
      apiKey,
      apiSecret,
      config: config || {},
      enabled: true,
      createdAt: new Date().toISOString()
    };

    integrations.custom.push(newIntegration);

    // Save
    await Setting.upsert({
      key: 'system_integrations',
      value: JSON.stringify(integrations)
    });

    logAction(req.user.id, 'ADD_CUSTOM_INTEGRATION', 'Setting', null, { name, type }, req);

    res.json({ success: true, message: 'Custom integration added successfully', data: newIntegration });
  } catch (error) {
    console.error('[addCustomIntegration] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to add custom integration', error: error.message });
  }
};

/**
 * Get terms and conditions for members
 * GET /api/public/terms
 */
const getTerms = async (req, res) => {
  try {
    const termsSetting = await Setting.findOne({ where: { key: 'system_termsOfService' } });
    const privacySetting = await Setting.findOne({ where: { key: 'system_privacyPolicy' } });
    const loanTermsSetting = await Setting.findOne({ where: { key: 'system_loanTerms' } });

    res.json({
      success: true,
      data: {
        termsOfService: termsSetting?.value || 'By using this platform, you agree to our terms of service...',
        privacyPolicy: privacySetting?.value || 'We respect your privacy and protect your personal data...',
        loanTerms: loanTermsSetting?.value || 'Loan terms and conditions apply...'
      }
    });
  } catch (error) {
    console.error('[getTerms] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch terms', error: error.message });
  }
};

// Create user function - FULLY IMPLEMENTED FOR GROUP ADMIN - DO NOT USE STUB
// This function creates members for Group Admin accounts
const createUser = async (req, res) => {
  // CRITICAL: If you see this log, the correct function is being called
  console.log('[createUser] ========== FULL IMPLEMENTATION CALLED (NOT STUB) ==========');
  console.log('[createUser] Request body:', req.body);
  console.log('[createUser] User role:', req.user?.role);
  console.log('[createUser] User ID:', req.user?.id);

  try {
    // User is already imported at the top of the file
    const { Group } = require('../models');
    const bcrypt = require('bcryptjs');
    const { logAction } = require('../utils/auditLogger');

    // Ensure User model is available
    if (!User) {
      console.error('[createUser] User model not available!');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    // Extract and validate input fields
    // Support both 'name' and 'fullName' for compatibility
    const fullName = req.body.fullName || req.body.name;
    const { phone, email, password, role, groupId, address, occupation, dateOfBirth } = req.body;
    const nationalId = req.body.nationalId; // Optional but validated if provided
    const userId = req.user.id;
    const userRole = req.user.role;

    // Store plain password for email (before hashing)
    const plainPassword = password;

    console.log('[createUser] Request received:', {
      fullName,
      phone,
      email: email ? 'provided' : 'not provided',
      nationalId: nationalId ? 'provided' : 'not provided',
      role,
      groupId,
      userRole
    });

    // Validate required fields: fullName (or name), phone, password, and groupId
    const missingFields = [];
    if (!fullName || !fullName.trim()) missingFields.push('fullName');
    if (!phone || !phone.trim()) missingFields.push('phone');
    if (!password || !password.trim()) missingFields.push('password');
    if (!groupId && userRole !== 'Group Admin') missingFields.push('groupId');

    if (missingFields.length > 0) {
      console.log('[createUser] Validation failed - missing required fields:', missingFields);
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    console.log('[createUser] All required fields present, proceeding with validation...');

    // Validate phone number format (Rwanda: exactly 10 digits, starting with 078, 072, 073, or 079)
    const phoneDigits = phone.replace(/\D/g, ''); // Remove all non-digits

    // Must be exactly 10 digits
    if (phoneDigits.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
      });
    }

    // Check if starts with valid prefix (078, 072, 073, or 079)
    const validPrefixes = ['078', '072', '073', '079'];
    const phonePrefix = phoneDigits.substring(0, 3);
    if (!validPrefixes.includes(phonePrefix)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must start with 078, 072, 073, or 079'
      });
    }

    // Normalize phone number: remove leading 0 and add +250
    const phoneWithoutLeadingZero = phoneDigits.startsWith('0') ? phoneDigits.substring(1) : phoneDigits;
    const normalizedPhone = `+250${phoneWithoutLeadingZero}`;

    // Validate email format if provided
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format. Please provide a valid email address'
        });
      }
    }

    // Validate national ID if provided (exactly 16 digits)
    let nationalIdDigits = null;
    if (nationalId) {
      nationalIdDigits = nationalId.replace(/\D/g, '');
      if (nationalIdDigits.length !== 16) {
        return res.status(400).json({
          success: false,
          message: 'National ID must be exactly 16 digits'
        });
      }
    }

    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Validate role
    const allowedRoles = ['Member', 'Secretary', 'Cashier', 'Group Admin'];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}`
      });
    }

    // Group Admin and Agent can only create Members in their group
    const finalRole = role || 'Member';
    if ((userRole === 'Group Admin' || userRole === 'Agent') && finalRole !== 'Member') {
      return res.status(403).json({
        success: false,
        message: 'You can only create Member accounts'
      });
    }

    // Get groupId - Group Admin uses their own group, System Admin/Agent can specify
    let targetGroupId = groupId;
    if (userRole === 'Group Admin') {
      const adminUser = await User.findByPk(userId, { attributes: ['groupId'] });
      if (!adminUser || !adminUser.groupId) {
        return res.status(400).json({
          success: false,
          message: 'Group Admin must belong to a group'
        });
      }
      targetGroupId = adminUser.groupId;
    }

    // Validate group exists if groupId provided
    if (targetGroupId) {
      const group = await Group.findByPk(targetGroupId);
      if (!group) {
        return res.status(400).json({
          success: false,
          message: 'Group not found'
        });
      }
    }

    // Check if phone already exists
    const existingPhone = await User.findOne({ where: { phone: normalizedPhone } });
    if (existingPhone) {
      return res.status(400).json({
        success: false,
        message: 'A user with this phone number already exists'
      });
    }

    // Check if email already exists (if provided) - return 409 for conflict
    if (email && email.trim()) {
      const existingEmail = await User.findOne({ where: { email: email.trim().toLowerCase() } });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: 'A user with this email address already exists'
        });
      }
    }

    // Check if national ID already exists (if provided)
    if (nationalIdDigits) {
      const existingNationalId = await User.findOne({ where: { nationalId: nationalIdDigits } });
      if (existingNationalId) {
        return res.status(409).json({
          success: false,
          message: 'A user with this national ID already exists'
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user with all required and optional fields
    const newUser = await User.create({
      name: fullName.trim(), // Use fullName (or name) as the name field
      phone: normalizedPhone,
      email: email && email.trim() ? email.trim().toLowerCase() : null,
      nationalId: nationalIdDigits || null,
      password: hashedPassword,
      role: finalRole,
      groupId: targetGroupId,
      status: 'active',
      address: address ? address.trim() : null,
      occupation: occupation ? occupation.trim() : null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      totalSavings: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Log action
    logAction(userId, 'CREATE_USER', 'User', newUser.id, {
      userName: newUser.name,
      role: newUser.role,
      groupId: newUser.groupId
    }, req);

    // Send welcome email with credentials if email is provided
    if (newUser.email) {
      try {
        const { sendWelcomeEmailWithCredentials } = require('../notifications/emailService');
        const groupName = targetGroupId ? (await Group.findByPk(targetGroupId))?.name : null;
        await sendWelcomeEmailWithCredentials(
          newUser.email,
          newUser.name,
          newUser.phone,
          plainPassword, // Plain password before hashing
          groupName
        );
        console.log('[createUser] Welcome email sent to:', newUser.email);
      } catch (emailError) {
        console.error('[createUser] Failed to send welcome email:', emailError);
        // Don't fail the user creation if email fails
      }
    }

    // Return user without password
    const userResponse = {
      id: newUser.id,
      name: newUser.name,
      phone: newUser.phone,
      email: newUser.email,
      nationalId: newUser.nationalId,
      role: newUser.role,
      status: newUser.status,
      groupId: newUser.groupId,
      createdAt: newUser.createdAt
    };

    // Return 201 Created status for successful creation
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: userResponse
    });
  } catch (error) {
    console.error('[createUser] Error:', error);
    console.error('[createUser] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create user',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

const listUsers = async (req, res) => {
  try {
    const { Group, Branch } = require('../models');
    const { Op } = require('sequelize');

    // Get query parameters for filtering
    const { role, status, groupId } = req.query;

    // Build where clause
    const where = {};
    if (role) {
      where.role = role;
    }
    if (status) {
      where.status = status;
    }
    if (groupId) {
      where.groupId = groupId;
    }

    const users = await User.findAll({
      where,
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: Branch,
          as: 'branch',
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ],
      attributes: ['id', 'name', 'email', 'phone', 'role', 'status', 'groupId', 'branchId', 'profileImage', 'nationalId', 'permissions', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });

    return res.json({ success: true, data: users });
  } catch (error) {
    console.error('[listUsers] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const { Group, Branch, Loan, Contribution } = require('../models');
    const { Op } = require('sequelize');

    // Group Admin and Agent can only access users from their group
    let whereClause = { id: parseInt(id) };
    if (userRole === 'Group Admin' || userRole === 'Agent') {
      const currentUser = await User.findByPk(userId, { attributes: ['groupId'] });
      if (!currentUser || !currentUser.groupId) {
        return res.status(403).json({ success: false, message: 'Access denied. You must belong to a group.' });
      }
      whereClause.groupId = currentUser.groupId;
    }

    const user = await User.findOne({
      where: whereClause,
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: Branch,
          as: 'branch',
          attributes: ['id', 'name', 'code', 'address'],
          required: false
        }
      ],
      attributes: ['id', 'name', 'email', 'phone', 'role', 'status', 'groupId', 'branchId', 'profileImage', 'nationalId', 'address', 'occupation', 'dateOfBirth', 'totalSavings', 'creditScore', 'language', 'permissions', 'createdAt', 'updatedAt']
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get additional financial data
    let activeLoansCount = 0;
    let totalContributions = 0;
    try {
      const activeLoans = await Loan.count({
        where: {
          memberId: user.id,
          status: { [Op.in]: ['disbursed', 'active'] },
          remainingAmount: { [Op.gt]: 0 }
        }
      });
      activeLoansCount = activeLoans;

      const contributions = await Contribution.sum('amount', {
        where: {
          memberId: user.id,
          status: 'approved'
        }
      });
      totalContributions = parseFloat(contributions || 0);
    } catch (financialError) {
      console.error('[getUserById] Error fetching financial data:', financialError);
    }

    const userData = user.toJSON ? user.toJSON() : user;
    userData.activeLoans = activeLoansCount;
    userData.totalContributions = totalContributions;

    return res.json({ success: true, data: userData });
  } catch (error) {
    console.error('[getUserById] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
  }
};

const getUserTickets = async (req, res) => {
  try {
    const { id } = req.params;

    // Only System Admin can access any user's tickets
    if (req.user.role !== 'System Admin') {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { SupportTicket } = require('../models');
    const tickets = await SupportTicket.findAll({
      where: { userId: id },
      include: [
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email', 'role']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    return res.json({ success: true, data: tickets });
  } catch (error) {
    console.error('[getUserTickets] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch user tickets', error: error.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { Group } = require('../models');
    const bcrypt = require('bcryptjs');
    const { logAction } = require('../utils/auditLogger');

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { name, phone, email, password, role, groupId, address, occupation, dateOfBirth, status } = req.body;
    const nationalId = req.body.nationalId;

    // Build update object
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.trim().toLowerCase();
    if (role) updateData.role = role;
    if (status) updateData.status = status;
    if (address !== undefined) updateData.address = address;
    if (occupation !== undefined) updateData.occupation = occupation;
    if (dateOfBirth) updateData.dateOfBirth = new Date(dateOfBirth);

    // Group ID validation if provided
    if (groupId) {
      const group = await Group.findByPk(groupId);
      if (!group) return res.status(400).json({ success: false, message: 'Group not found' });
      updateData.groupId = groupId;
    }

    // Phone validation if provided
    if (phone) {
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length === 10) {
        const phoneWithoutLeadingZero = phoneDigits.startsWith('0') ? phoneDigits.substring(1) : phoneDigits;
        updateData.phone = `+250${phoneWithoutLeadingZero}`;
      } else if (phone.startsWith('+250')) {
        updateData.phone = phone;
      }
    }

    // National ID validation if provided
    if (nationalId) {
      const nationalIdDigits = nationalId.replace(/\D/g, '');
      if (nationalIdDigits.length === 16) {
        updateData.nationalId = nationalIdDigits;
      }
    }

    // Password handling
    if (password && password.trim()) {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    await user.update(updateData);

    logAction(req.user.id, 'UPDATE_USER', 'User', user.id, {
      updatedFields: Object.keys(updateData).filter(k => k !== 'password')
    }, req);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('[updateUser] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Capture user info for logging before deletion
    const userInfo = { name: user.name, role: user.role, email: user.email };

    await user.destroy();

    const { logAction } = require('../utils/auditLogger');
    logAction(req.user.id, 'DELETE_USER', 'User', id, userInfo, req);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('[deleteUser] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
  }
};

const transferUser = async (req, res) => {
  console.log('[createUser] FULL IMPLEMENTATION CALLED');
  try {
    const { Group } = require('../models');
    const bcrypt = require('bcryptjs');
    const { logAction } = require('../utils/auditLogger');
    if (!User) return res.status(500).json({ success: false, message: 'Server configuration error' });
    const fullName = req.body.fullName || req.body.name;
    const { phone, email, password, role, groupId, address, occupation, dateOfBirth } = req.body;
    const nationalId = req.body.nationalId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const plainPassword = password;
    const missingFields = [];
    if (!fullName || !fullName.trim()) missingFields.push('fullName');
    if (!phone || !phone.trim()) missingFields.push('phone');
    if (!password || !password.trim()) missingFields.push('password');
    if (!groupId && userRole !== 'Group Admin') missingFields.push('groupId');
    if (missingFields.length > 0) return res.status(400).json({ success: false, message: `Missing required fields: ${missingFields.join(', ')}` });
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) return res.status(400).json({ success: false, message: 'Phone number must be exactly 10 digits' });
    const validPrefixes = ['078', '072', '073', '079'];
    const phonePrefix = phoneDigits.substring(0, 3);
    if (!validPrefixes.includes(phonePrefix)) return res.status(400).json({ success: false, message: 'Phone number must start with 078, 072, 073, or 079' });
    const phoneWithoutLeadingZero = phoneDigits.startsWith('0') ? phoneDigits.substring(1) : phoneDigits;
    const normalizedPhone = `+250${phoneWithoutLeadingZero}`;
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    let nationalIdDigits = null;
    if (nationalId) {
      nationalIdDigits = nationalId.replace(/\D/g, '');
      if (nationalIdDigits.length !== 16) return res.status(400).json({ success: false, message: 'National ID must be exactly 16 digits' });
    }
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    const allowedRoles = ['Member', 'Secretary', 'Cashier', 'Group Admin'];
    if (role && !allowedRoles.includes(role)) return res.status(400).json({ success: false, message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}` });
    const finalRole = role || 'Member';
    if ((userRole === 'Group Admin' || userRole === 'Agent') && finalRole !== 'Member') return res.status(403).json({ success: false, message: 'You can only create Member accounts' });
    let targetGroupId = groupId;
    if (userRole === 'Group Admin') {
      const adminUser = await User.findByPk(userId, { attributes: ['groupId'] });
      if (!adminUser || !adminUser.groupId) return res.status(400).json({ success: false, message: 'Group Admin must belong to a group' });
      targetGroupId = adminUser.groupId;
    }
    if (targetGroupId) {
      const group = await Group.findByPk(targetGroupId);
      if (!group) return res.status(400).json({ success: false, message: 'Group not found' });
    }
    const existingPhone = await User.findOne({ where: { phone: normalizedPhone } });
    if (existingPhone) return res.status(400).json({ success: false, message: 'A user with this phone number already exists' });
    if (email && email.trim()) {
      const existingEmail = await User.findOne({ where: { email: email.trim().toLowerCase() } });
      if (existingEmail) return res.status(409).json({ success: false, message: 'A user with this email address already exists' });
    }
    if (nationalIdDigits) {
      const existingNationalId = await User.findOne({ where: { nationalId: nationalIdDigits } });
      if (existingNationalId) return res.status(409).json({ success: false, message: 'A user with this national ID already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name: fullName.trim(),
      phone: normalizedPhone,
      email: email && email.trim() ? email.trim().toLowerCase() : null,
      nationalId: nationalIdDigits || null,
      password: hashedPassword,
      role: finalRole,
      groupId: targetGroupId,
      status: 'active',
      address: address ? address.trim() : null,
      occupation: occupation ? occupation.trim() : null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      totalSavings: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    logAction(userId, 'CREATE_USER', 'User', newUser.id, { userName: newUser.name, role: newUser.role, groupId: newUser.groupId }, req);
    if (newUser.email) {
      try {
        const { sendWelcomeEmailWithCredentials } = require('../notifications/emailService');
        const groupName = targetGroupId ? (await Group.findByPk(targetGroupId))?.name : null;
        await sendWelcomeEmailWithCredentials(newUser.email, newUser.name, newUser.phone, plainPassword, groupName);
        console.log('[createUser] Welcome email sent to:', newUser.email);
      } catch (emailError) {
        console.error('[createUser] Failed to send welcome email:', emailError);
      }
    }
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        name: newUser.name,
        phone: newUser.phone,
        email: newUser.email,
        nationalId: newUser.nationalId,
        role: newUser.role,
        status: newUser.status,
        groupId: newUser.groupId,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('[createUser] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
};

const remindPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { User } = require('../models');
    const crypto = require('crypto');
    const { sendPasswordResetEmail } = require('../notifications/emailService');
    const { logAction } = require('../utils/auditLogger');

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.email) {
      return res.status(400).json({
        success: false,
        message: 'This user does not have an email address associated with their account. Password reset can only be sent via email.'
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Save reset token to user
    user.resetToken = resetToken;
    user.resetTokenExpiry = resetTokenExpiry;
    await user.save();

    // Generate reset URL - force port 3000
    let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    if (frontendUrl.includes(':5173')) {
      frontendUrl = frontendUrl.replace(':5173', ':3000');
    }

    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    // Send reset email
    let emailSent = false;
    try {
      const emailResult = await sendPasswordResetEmail(user.email, user.name, resetToken, resetUrl, user.id);
      emailSent = emailResult?.success === true;
    } catch (err) {
      console.error('Failed to send reset email in remindPassword:', err);
    }

    // Log action
    logAction(req.user.id, 'ADMIN_INITIATED_PASSWORD_RESET', 'User', user.id, { email: user.email }, req);

    if (!emailSent) {
      // In dev mode, return the URL even if email fails
      return res.status(200).json({
        success: true,
        message: 'Password reset token generated (email failed to send)',
        data: process.env.NODE_ENV !== 'production' ? { resetUrl, token: resetToken } : {}
      });
    }

    return res.json({
      success: true,
      message: `Password reset instructions have been sent to ${user.email}`
    });
  } catch (error) {
    console.error('[remindPassword] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to process password reset request',
      error: error.message
    });
  }
};

/**
 * Reset user password and show it to admin
 * POST /api/system-admin/users/:id/reset-and-show-password
 */
const resetAndShowPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const bcrypt = require('bcryptjs');
    const crypto = require('crypto');

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Generate a secure random password (8 characters)
    const plainPassword = crypto.randomBytes(4).toString('hex');
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    // Update user password
    user.password = hashedPassword;
    await user.save();

    // Log action
    logAction(req.user.id, 'ADMIN_REVEALED_PASSWORD_RESET', 'User', user.id, {
      message: 'Admin generated a new temporary password for user'
    }, req);

    return res.json({
      success: true,
      message: 'New temporary password generated successfully',
      plainPassword
    });
  } catch (error) {
    console.error('[resetAndShowPassword] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset and show password',
      error: error.message
    });
  }
};



const usersCount = async (req, res) => {
  try {
    const count = await User.count();
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to count users', error: error.message });
  }
};

const agentsCount = async (req, res) => {
  try {
    const count = await User.count({ where: { role: 'Agent' } });
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to count agents', error: error.message });
  }
};

const branchesCount = async (req, res) => {
  try {
    const { Branch } = require('../models');
    const count = await Branch.count();
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to count branches', error: error.message });
  }
};

const groupsCount = async (req, res) => {
  try {
    const { Group } = require('../models');
    const count = await Group.count();
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to count groups', error: error.message });
  }
};

const membersCount = async (req, res) => {
  try {
    const count = await User.count({ where: { role: 'Member' } });
    res.json({ success: true, data: { count } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to count members', error: error.message });
  }
};

const getAgentActions = async (req, res) => {
  console.log('[createUser] FULL IMPLEMENTATION CALLED');
  try {
    const { Group } = require('../models');
    const bcrypt = require('bcryptjs');
    const { logAction } = require('../utils/auditLogger');
    if (!User) return res.status(500).json({ success: false, message: 'Server configuration error' });
    const fullName = req.body.fullName || req.body.name;
    const { phone, email, password, role, groupId, address, occupation, dateOfBirth } = req.body;
    const nationalId = req.body.nationalId;
    const userId = req.user.id;
    const userRole = req.user.role;
    const plainPassword = password;
    const missingFields = [];
    if (!fullName || !fullName.trim()) missingFields.push('fullName');
    if (!phone || !phone.trim()) missingFields.push('phone');
    if (!password || !password.trim()) missingFields.push('password');
    if (!groupId && userRole !== 'Group Admin') missingFields.push('groupId');
    if (missingFields.length > 0) return res.status(400).json({ success: false, message: `Missing required fields: ${missingFields.join(', ')}` });
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) return res.status(400).json({ success: false, message: 'Phone number must be exactly 10 digits' });
    const validPrefixes = ['078', '072', '073', '079'];
    const phonePrefix = phoneDigits.substring(0, 3);
    if (!validPrefixes.includes(phonePrefix)) return res.status(400).json({ success: false, message: 'Phone number must start with 078, 072, 073, or 079' });
    const phoneWithoutLeadingZero = phoneDigits.startsWith('0') ? phoneDigits.substring(1) : phoneDigits;
    const normalizedPhone = `+250${phoneWithoutLeadingZero}`;
    if (email && email.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) return res.status(400).json({ success: false, message: 'Invalid email format' });
    }
    let nationalIdDigits = null;
    if (nationalId) {
      nationalIdDigits = nationalId.replace(/\D/g, '');
      if (nationalIdDigits.length !== 16) return res.status(400).json({ success: false, message: 'National ID must be exactly 16 digits' });
    }
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
    const allowedRoles = ['Member', 'Secretary', 'Cashier', 'Group Admin'];
    if (role && !allowedRoles.includes(role)) return res.status(400).json({ success: false, message: `Invalid role. Allowed roles: ${allowedRoles.join(', ')}` });
    const finalRole = role || 'Member';
    if ((userRole === 'Group Admin' || userRole === 'Agent') && finalRole !== 'Member') return res.status(403).json({ success: false, message: 'You can only create Member accounts' });
    let targetGroupId = groupId;
    if (userRole === 'Group Admin') {
      const adminUser = await User.findByPk(userId, { attributes: ['groupId'] });
      if (!adminUser || !adminUser.groupId) return res.status(400).json({ success: false, message: 'Group Admin must belong to a group' });
      targetGroupId = adminUser.groupId;
    }
    if (targetGroupId) {
      const group = await Group.findByPk(targetGroupId);
      if (!group) return res.status(400).json({ success: false, message: 'Group not found' });
    }
    const existingPhone = await User.findOne({ where: { phone: normalizedPhone } });
    if (existingPhone) return res.status(400).json({ success: false, message: 'A user with this phone number already exists' });
    if (email && email.trim()) {
      const existingEmail = await User.findOne({ where: { email: email.trim().toLowerCase() } });
      if (existingEmail) return res.status(409).json({ success: false, message: 'A user with this email address already exists' });
    }
    if (nationalIdDigits) {
      const existingNationalId = await User.findOne({ where: { nationalId: nationalIdDigits } });
      if (existingNationalId) return res.status(409).json({ success: false, message: 'A user with this national ID already exists' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      name: fullName.trim(),
      phone: normalizedPhone,
      email: email && email.trim() ? email.trim().toLowerCase() : null,
      nationalId: nationalIdDigits || null,
      password: hashedPassword,
      role: finalRole,
      groupId: targetGroupId,
      status: 'active',
      address: address ? address.trim() : null,
      occupation: occupation ? occupation.trim() : null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      totalSavings: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    logAction(userId, 'CREATE_USER', 'User', newUser.id, { userName: newUser.name, role: newUser.role, groupId: newUser.groupId }, req);
    if (newUser.email) {
      try {
        const { sendWelcomeEmailWithCredentials } = require('../notifications/emailService');
        const groupName = targetGroupId ? (await Group.findByPk(targetGroupId))?.name : null;
        await sendWelcomeEmailWithCredentials(newUser.email, newUser.name, newUser.phone, plainPassword, groupName);
        console.log('[createUser] Welcome email sent to:', newUser.email);
      } catch (emailError) {
        console.error('[createUser] Failed to send welcome email:', emailError);
      }
    }
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        name: newUser.name,
        phone: newUser.phone,
        email: newUser.email,
        nationalId: newUser.nationalId,
        role: newUser.role,
        status: newUser.status,
        groupId: newUser.groupId,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('[createUser] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
};

/**
 * Update user permissions
 * PUT /api/system-admin/users/:userId/permissions
 */
const updateUserPermissions = async (req, res) => {
  try {
    const { id } = req.params;
    const { permissions } = req.body;

    console.log(`[updateUserPermissions] Updating permissions for user ${id}`);

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update permissions
    // Ensure it's stored as a JSON object
    user.permissions = permissions || {};
    await user.save();

    console.log(`[updateUserPermissions] Permissions updated for user ${id}`);

    // Log action
    const { logAction } = require('../utils/auditLogger');
    await logAction(req.user.id, 'UPDATE_USER_PERMISSIONS', 'User', id, { permissions }, req);

    res.json({
      success: true,
      message: 'User permissions updated successfully',
      data: user.permissions
    });
  } catch (error) {
    console.error('[updateUserPermissions] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user permissions',
      error: error.message
    });
  }
};

module.exports = {
  getSystemSettings,
  saveSystemSettings,
  testConnection,
  addCustomIntegration,
  getTerms,
  createUser,
  listUsers,
  getUserById,
  getUserTickets,
  updateUser,
  deleteUser,
  transferUser,
  remindPassword,
  resetAndShowPassword,
  updateUserPermissions,
  usersCount,
  agentsCount,
  branchesCount,
  groupsCount,
  membersCount,
  getAgentActions
};
