const { Branch } = require('../models');
const { logAction } = require('../utils/auditLogger');

const listBranches = async (req, res) => {
  try {
    const branches = await Branch.findAll({ order: [['createdAt', 'DESC']] });
    return res.json({ success: true, data: branches });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch branches', error: error.message });
  }
};

const createBranch = async (req, res) => {
  try {
    console.log('[createBranch] ========== STARTING BRANCH CREATION ==========');
    console.log('[createBranch] Request body:', req.body);
    console.log('[createBranch] User:', req.user?.id, req.user?.role);
    
    // Verify Branch model is available
    if (!Branch) {
      console.error('[createBranch] Branch model is not available!');
      return res.status(500).json({ success: false, message: 'Branch model not initialized' });
    }

    const { name, code, address } = req.body;
    
    // Validate name
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Branch name is required' });
    }

    const trimmedName = name.trim();
    
    // Generate a unique code if not provided - simplified approach
    let branchCode = null;
    if (code && typeof code === 'string' && code.trim().length > 0) {
      branchCode = code.trim().substring(0, 20);
    } else {
      // Simple code generation: prefix + timestamp
      const namePrefix = trimmedName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'BRN';
      const timestamp = Date.now().toString().slice(-8); // Last 8 digits
      branchCode = `${namePrefix}${timestamp}`.substring(0, 20);
      
      // Quick uniqueness check (only one attempt to keep it simple)
      try {
        const existing = await Branch.findOne({ where: { code: branchCode } });
        if (existing) {
          // If exists, add random suffix
          const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
          branchCode = `${namePrefix}${timestamp.slice(-5)}${random}`.substring(0, 20);
        }
      } catch (checkError) {
        console.warn('[createBranch] Could not check code uniqueness, proceeding anyway:', checkError.message);
      }
    }
    
    console.log('[createBranch] Using code:', branchCode, 'Length:', branchCode.length);
    
    // Prepare branch data
    const branchData = {
      name: trimmedName,
      code: branchCode,
      status: 'active'
    };
    
    if (address && typeof address === 'string' && address.trim()) {
      branchData.address = address.trim();
    }

    console.log('[createBranch] Branch data to create:', branchData);
    
    // Create branch with error handling
    let branch;
    try {
      branch = await Branch.create(branchData);
      console.log('[createBranch] Branch created successfully. ID:', branch.id);
    } catch (createError) {
      console.error('[createBranch] Error in Branch.create():', createError);
      console.error('[createBranch] Error name:', createError.name);
      console.error('[createBranch] Error message:', createError.message);
      if (createError.errors) {
        console.error('[createBranch] Validation errors:', createError.errors);
      }
      throw createError; // Re-throw to be caught by outer catch
    }

    // Log action if user is available
    if (req.user && req.user.id) {
      try {
        await logAction(req.user.id, 'CREATE_BRANCH', 'Branch', branch.id, { name, code: branchCode }, req);
      } catch (logError) {
        console.error('[createBranch] Error logging action:', logError);
        // Don't fail the request if logging fails
      }
    }

    return res.json({ success: true, message: 'Branch created', data: branch });
  } catch (error) {
    console.error('[createBranch] ========== ERROR CREATING BRANCH ==========');
    console.error('[createBranch] Error name:', error.name);
    console.error('[createBranch] Error message:', error.message);
    console.error('[createBranch] Error stack:', error.stack);
    if (error.errors) {
      console.error('[createBranch] Validation errors:', JSON.stringify(error.errors, null, 2));
    }
    if (error.parent) {
      console.error('[createBranch] Database error:', error.parent.message);
      console.error('[createBranch] SQL:', error.parent.sql);
    }
    // Try to serialize error safely
    try {
      console.error('[createBranch] Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    } catch (serializeError) {
      console.error('[createBranch] Could not serialize error:', serializeError);
    }
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create branch';
    let statusCode = 500;
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      errorMessage = 'Branch name or code already exists. Please use a different name.';
      statusCode = 409; // Conflict
    } else if (error.name === 'SequelizeValidationError') {
      errorMessage = 'Invalid branch data provided. Please check your input.';
      const validationErrors = error.errors?.map(e => e.message).join(', ') || '';
      if (validationErrors) {
        errorMessage += ` Details: ${validationErrors}`;
      }
      statusCode = 400; // Bad Request
    } else if (error.name === 'SequelizeDatabaseError') {
      errorMessage = 'Database error occurred. Please contact support.';
    }
    
    return res.status(statusCode).json({ 
      success: false, 
      message: errorMessage, 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

const updateBranch = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    const { name, code, address } = req.body;
    if (name !== undefined) branch.name = name;
    if (code !== undefined) branch.code = code;
    if (address !== undefined) branch.address = address;
    await branch.save();
    logAction(req.user.id, 'UPDATE_BRANCH', 'Branch', branch.id, {}, req);
    return res.json({ success: true, message: 'Branch updated', data: branch });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update branch', error: error.message });
  }
};

const deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findByPk(req.params.id);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
    await branch.destroy();
    logAction(req.user.id, 'DELETE_BRANCH', 'Branch', req.params.id, {}, req);
    return res.json({ success: true, message: 'Branch deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete branch', error: error.message });
  }
};

module.exports = {
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch
};


