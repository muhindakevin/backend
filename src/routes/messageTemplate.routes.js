const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { MessageTemplate, User } = require('../models');
const { Op } = require('sequelize');

/**
 * Get message templates
 * GET /api/message-templates
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);
    
    let whereClause = {};
    
    // Cashier, Secretary, Group Admin: get templates for their group
    if (['Cashier', 'Secretary', 'Group Admin'].includes(user.role) && user.groupId) {
      whereClause = {
        [Op.or]: [
          { userId, groupId: null }, // User's personal templates
          { groupId: user.groupId }, // Group templates
          { isDefault: true } // Default system templates
        ]
      };
    } else {
      // Other roles: only their own templates and defaults
      whereClause = {
        [Op.or]: [
          { userId },
          { isDefault: true }
        ]
      };
    }

    const templates = await MessageTemplate.findAll({
      where: whereClause,
      order: [['isDefault', 'DESC'], ['type', 'ASC'], ['name', 'ASC']]
    });

    res.json({
      success: true,
      data: templates
    });
  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: error.message
    });
  }
});

/**
 * Create message template
 * POST /api/message-templates
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, subject, content, type } = req.body;
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    if (!name || !content) {
      return res.status(400).json({
        success: false,
        message: 'Name and content are required'
      });
    }

    const template = await MessageTemplate.create({
      userId,
      groupId: user.groupId || null,
      name,
      subject: subject || name,
      content,
      type: type || 'custom',
      isDefault: false
    });

    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create template',
      error: error.message
    });
  }
});

/**
 * Update message template
 * PUT /api/message-templates/:id
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, subject, content, type } = req.body;
    const userId = req.user.id;

    const template = await MessageTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    // Can't edit default templates unless you're the owner
    if (template.isDefault && template.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Cannot edit default system templates'
      });
    }

    // Check ownership
    if (template.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (name) template.name = name;
    if (subject !== undefined) template.subject = subject;
    if (content) template.content = content;
    if (type) template.type = type;

    await template.save();

    res.json({
      success: true,
      message: 'Template updated successfully',
      data: template
    });
  } catch (error) {
    console.error('Update template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update template',
      error: error.message
    });
  }
});

/**
 * Delete message template
 * DELETE /api/message-templates/:id
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const template = await MessageTemplate.findByPk(id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found'
      });
    }

    // Can't delete default templates
    if (template.isDefault) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete default system templates'
      });
    }

    // Check ownership
    if (template.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    await template.destroy();

    res.json({
      success: true,
      message: 'Template deleted successfully'
    });
  } catch (error) {
    console.error('Delete template error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete template',
      error: error.message
    });
  }
});

module.exports = router;

