const { ComplianceRule, ComplianceViolation, Group, User, Notification, Setting } = require('../models');
const { Op } = require('sequelize');
const { logAction } = require('../utils/auditLogger');

/**
 * Get compliance summary statistics
 * GET /api/compliance/summary
 */
const getComplianceSummary = async (req, res) => {
  try {
    const user = req.user;
    let groupId = null;

    if (user.groupId) {
      groupId = parseInt(user.groupId);
    } else {
      return res.json({
        success: true,
        data: {
          activeRules: 0,
          pendingViolations: 0,
          resolvedViolations: 0,
          activeAgreements: 0
        }
      });
    }

    const whereClause = { groupId };

    // Get active rules from ComplianceRules table
    let activeRules = 0;
    try {
      activeRules = await ComplianceRule.count({
        where: {
          ...whereClause,
          status: 'active'
        }
      });
    } catch (error) {
      console.log('[getComplianceSummary] ComplianceRules table may not exist yet:', error.message);
    }

    // Also count active fine rules from Settings
    try {
      const fineRuleSettings = await Setting.findAll({
        where: {
          key: {
            [Op.like]: `group_${groupId}_fineRule_%_isActive`
          }
        }
      });

      const activeFineRules = fineRuleSettings.filter(s => s.value === 'true').length;
      activeRules += activeFineRules;
    } catch (error) {
      console.log('[getComplianceSummary] Error counting fine rules:', error.message);
    }

    // Get pending violations
    const pendingViolations = await ComplianceViolation.count({
      where: {
        ...whereClause,
        status: 'pending'
      }
    });

    // Get resolved violations
    const resolvedViolations = await ComplianceViolation.count({
      where: {
        ...whereClause,
        status: 'resolved'
      }
    });

    // Active agreements = approved votes (we'll use Vote model for this)
    const { Vote } = require('../models');
    const activeAgreements = await Vote.count({
      where: {
        groupId,
        status: 'approved'
      }
    });

    res.json({
      success: true,
      data: {
        activeRules,
        pendingViolations,
        resolvedViolations,
        activeAgreements
      }
    });
  } catch (error) {
    console.error('Get compliance summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch compliance summary',
      error: error.message
    });
  }
};

/**
 * Get all compliance rules
 * GET /api/compliance/rules
 */
const getComplianceRules = async (req, res) => {
  try {
    const user = req.user;
    const { status, category } = req.query;
    let groupId = null;

    if (user.groupId) {
      groupId = parseInt(user.groupId);
    } else {
      return res.json({
        success: true,
        data: []
      });
    }

    let whereClause = { groupId };

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (category && category !== 'all') {
      whereClause.category = category;
    }

    // Fetch compliance rules from ComplianceRules table
    let rules = [];
    try {
      rules = await ComplianceRule.findAll({
        where: whereClause,
        include: [
          { association: 'creator', attributes: ['id', 'name'] },
          { association: 'updater', attributes: ['id', 'name'], required: false }
        ],
        order: [['createdAt', 'DESC']]
      });
    } catch (error) {
      // If table doesn't exist yet, rules will be empty array
      console.log('[getComplianceRules] ComplianceRules table may not exist yet:', error.message);
    }

    // Also fetch existing fine rules from Settings and convert them to compliance rules format
    try {
      const fineRuleSettings = await Setting.findAll({
        where: {
          key: {
            [Op.like]: `group_${groupId}_fineRule_%`
          }
        }
      });

      // Default fine rules that might exist
      const defaultFineRules = [
        {
          id: 'late_contribution',
          name: 'Late Contribution Fine',
          description: 'Applied when contribution is paid after due date',
          category: 'Financial'
        },
        {
          id: 'missed_loan_payment',
          name: 'Missed Loan Payment Fine',
          description: 'Applied when loan payment is overdue',
          category: 'Financial'
        },
        {
          id: 'meeting_absence',
          name: 'Meeting Absence Fine',
          description: 'Applied when member misses group meeting',
          category: 'Attendance'
        }
      ];

      // Process fine rules from settings
      const fineRulesMap = new Map();
      defaultFineRules.forEach(rule => {
        const amountKey = `group_${groupId}_fineRule_${rule.id}_amount`;
        const graceKey = `group_${groupId}_fineRule_${rule.id}_gracePeriod`;
        const activeKey = `group_${groupId}_fineRule_${rule.id}_isActive`;

        const amountSetting = fineRuleSettings.find(s => s.key === amountKey);
        const graceSetting = fineRuleSettings.find(s => s.key === graceKey);
        const activeSetting = fineRuleSettings.find(s => s.key === activeKey);

        const isActive = activeSetting ? activeSetting.value === 'true' : (rule.id === 'late_contribution' || rule.id === 'missed_loan_payment');

        if (isActive) {
          fineRulesMap.set(rule.id, {
            id: `fine_rule_${rule.id}`,
            title: rule.name,
            description: rule.description,
            category: rule.category,
            status: 'active',
            createdAt: new Date(),
            updatedAt: new Date(),
            creator: { id: 0, name: 'System' },
            updater: null,
            isFineRule: true,
            amount: amountSetting ? parseFloat(amountSetting.value) : null,
            gracePeriod: graceSetting ? parseInt(graceSetting.value) : null
          });
        }
      });

      // Convert fine rules to compliance rules format and add to rules array
      fineRulesMap.forEach((fineRule, key) => {
        // Check if we should include this rule based on filters
        let shouldInclude = true;
        if (status && status !== 'all' && fineRule.status !== status) {
          shouldInclude = false;
        }
        if (category && category !== 'all' && fineRule.category !== category) {
          shouldInclude = false;
        }

        if (shouldInclude) {
          rules.push(fineRule);
        }
      });
    } catch (error) {
      console.log('[getComplianceRules] Error fetching fine rules from settings:', error.message);
    }

    // Get violation counts for each rule
    const rulesWithViolations = await Promise.all(
      rules.map(async (rule) => {
        let violationCount = 0;
        
        // For fine rules, count violations differently (we can't link them directly)
        if (rule.isFineRule) {
          // Count fines that match this rule's description
          try {
            const { Fine } = require('../models');
            violationCount = await Fine.count({
              where: {
                groupId: groupId,
                reason: {
                  [Op.like]: `%${rule.title}%`
                }
              }
            });
          } catch (error) {
            console.log('[getComplianceRules] Error counting fine violations:', error.message);
          }
        } else {
          // For compliance rules, count violations from ComplianceViolations table
          try {
            violationCount = await ComplianceViolation.count({
              where: { ruleId: rule.id }
            });
          } catch (error) {
            console.log('[getComplianceRules] Error counting compliance violations:', error.message);
          }
        }

        const ruleData = rule.toJSON ? rule.toJSON() : rule;
        return {
          ...ruleData,
          violations: violationCount
        };
      })
    );

    res.json({
      success: true,
      data: rulesWithViolations
    });
  } catch (error) {
    console.error('Get compliance rules error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch compliance rules',
      error: error.message
    });
  }
};

/**
 * Create compliance rule
 * POST /api/compliance/rules
 */
const createComplianceRule = async (req, res) => {
  try {
    const { title, description, category } = req.body;
    const createdBy = req.user.id;
    const user = req.user;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Title and description are required'
      });
    }

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    const rule = await ComplianceRule.create({
      groupId: user.groupId,
      title: title.trim(),
      description: description.trim(),
      category: category || 'General',
      status: 'active',
      createdBy,
      updatedBy: createdBy
    });

    logAction(createdBy, 'COMPLIANCE_RULE_CREATED', 'ComplianceRule', rule.id, { title }, req);

    res.status(201).json({
      success: true,
      message: 'Compliance rule created successfully',
      data: rule
    });
  } catch (error) {
    console.error('Create compliance rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create compliance rule',
      error: error.message
    });
  }
};

/**
 * Update compliance rule
 * PUT /api/compliance/rules/:id
 */
const updateComplianceRule = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, status } = req.body;
    const user = req.user;

    const rule = await ComplianceRule.findByPk(id);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Compliance rule not found'
      });
    }

    // Verify user has permission
    if (user.groupId && rule.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update rules for your own group.'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can update rules.'
      });
    }

    // Update fields
    if (title) rule.title = title.trim();
    if (description !== undefined) rule.description = description.trim();
    if (category) rule.category = category;
    if (status) rule.status = status;
    rule.updatedBy = user.id;

    await rule.save();

    logAction(user.id, 'COMPLIANCE_RULE_UPDATED', 'ComplianceRule', rule.id, { title: rule.title }, req);

    res.json({
      success: true,
      message: 'Compliance rule updated successfully',
      data: rule
    });
  } catch (error) {
    console.error('Update compliance rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update compliance rule',
      error: error.message
    });
  }
};

/**
 * Delete compliance rule
 * DELETE /api/compliance/rules/:id
 */
const deleteComplianceRule = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const rule = await ComplianceRule.findByPk(id);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Compliance rule not found'
      });
    }

    // Verify user has permission
    if (user.groupId && rule.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete rules for your own group.'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can delete rules.'
      });
    }

    await rule.destroy();

    logAction(user.id, 'COMPLIANCE_RULE_DELETED', 'ComplianceRule', id, { title: rule.title }, req);

    res.json({
      success: true,
      message: 'Compliance rule deleted successfully'
    });
  } catch (error) {
    console.error('Delete compliance rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete compliance rule',
      error: error.message
    });
  }
};

/**
 * Get compliance rule by ID
 * GET /api/compliance/rules/:id
 */
const getComplianceRuleById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const rule = await ComplianceRule.findByPk(id, {
      include: [
        { association: 'creator', attributes: ['id', 'name'] },
        { association: 'updater', attributes: ['id', 'name'], required: false },
        { association: 'group', attributes: ['id', 'name', 'code'] }
      ]
    });

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Compliance rule not found'
      });
    }

    // Verify user has permission
    if (user.groupId && rule.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view rules for your own group.'
      });
    }

    // Get violation count
    const violationCount = await ComplianceViolation.count({
      where: { ruleId: rule.id }
    });

    const ruleData = rule.toJSON();
    ruleData.violations = violationCount;

    res.json({
      success: true,
      data: ruleData
    });
  } catch (error) {
    console.error('Get compliance rule by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch compliance rule',
      error: error.message
    });
  }
};

/**
 * Get all violations
 * GET /api/compliance/violations
 */
const getComplianceViolations = async (req, res) => {
  try {
    const user = req.user;
    const { status, severity, ruleId } = req.query;
    let groupId = null;

    if (user.groupId) {
      groupId = parseInt(user.groupId);
    } else {
      return res.json({
        success: true,
        data: []
      });
    }

    let whereClause = { groupId };

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    if (severity && severity !== 'all') {
      whereClause.severity = severity;
    }

    if (ruleId) {
      whereClause.ruleId = parseInt(ruleId);
    }

    const violations = await ComplianceViolation.findAll({
      where: whereClause,
      include: [
        { association: 'rule', attributes: ['id', 'title', 'category'] },
        { association: 'member', attributes: ['id', 'name', 'phone', 'email'] },
        { association: 'reporter', attributes: ['id', 'name', 'role'] },
        { association: 'resolver', attributes: ['id', 'name', 'role'], required: false }
      ],
      order: [['reportedDate', 'DESC']]
    });

    res.json({
      success: true,
      data: violations
    });
  } catch (error) {
    console.error('Get compliance violations error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch compliance violations',
      error: error.message
    });
  }
};

/**
 * Create compliance violation
 * POST /api/compliance/violations
 */
const createComplianceViolation = async (req, res) => {
  try {
    const { ruleId, memberId, description, severity } = req.body;
    const reportedBy = req.user.id;
    const user = req.user;

    if (!ruleId || !memberId || !description) {
      return res.status(400).json({
        success: false,
        message: 'Rule ID, member ID, and description are required'
      });
    }

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    // Verify rule exists and belongs to the same group
    const rule = await ComplianceRule.findByPk(ruleId);
    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Compliance rule not found'
      });
    }

    if (rule.groupId !== user.groupId) {
      return res.status(403).json({
        success: false,
        message: 'Rule does not belong to your group'
      });
    }

    // Verify member exists and belongs to the same group
    const member = await User.findByPk(memberId);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    if (member.groupId !== user.groupId) {
      return res.status(403).json({
        success: false,
        message: 'Member does not belong to your group'
      });
    }

    const violation = await ComplianceViolation.create({
      groupId: user.groupId,
      ruleId: parseInt(ruleId),
      memberId: parseInt(memberId),
      description: description.trim(),
      severity: severity || 'medium',
      status: 'pending',
      reportedBy,
      reportedDate: new Date()
    });

    // Send notification to member
    try {
      await Notification.create({
        userId: memberId,
        type: 'violation_reported',
        channel: 'in_app',
        title: 'Compliance Violation Reported',
        content: `A violation has been reported against you for rule: ${rule.title}. ${description.substring(0, 100)}`,
        status: 'sent'
      });
    } catch (notifError) {
      console.error('[createComplianceViolation] Error sending notification:', notifError);
    }

    logAction(reportedBy, 'COMPLIANCE_VIOLATION_CREATED', 'ComplianceViolation', violation.id, { ruleId, memberId }, req);

    res.status(201).json({
      success: true,
      message: 'Compliance violation reported successfully',
      data: violation
    });
  } catch (error) {
    console.error('Create compliance violation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create compliance violation',
      error: error.message
    });
  }
};

/**
 * Update violation status
 * PUT /api/compliance/violations/:id/status
 */
const updateViolationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes } = req.body;
    const user = req.user;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const violation = await ComplianceViolation.findByPk(id, {
      include: [
        { association: 'member', attributes: ['id', 'name'] },
        { association: 'rule', attributes: ['id', 'title'] }
      ]
    });

    if (!violation) {
      return res.status(404).json({
        success: false,
        message: 'Compliance violation not found'
      });
    }

    // Verify user has permission
    if (user.groupId && violation.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update violations for your own group.'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can update violations.'
      });
    }

    violation.status = status;
    if (status === 'resolved' || status === 'dismissed') {
      violation.resolvedBy = user.id;
      violation.resolvedDate = new Date();
      if (resolutionNotes) {
        violation.resolutionNotes = resolutionNotes;
      }
    }

    await violation.save();

    // Send notification to member if resolved
    if (status === 'resolved' && violation.member) {
      try {
        await Notification.create({
          userId: violation.memberId,
          type: 'violation_resolved',
          channel: 'in_app',
          title: 'Violation Resolved',
          content: `Your violation for rule "${violation.rule.title}" has been resolved.${resolutionNotes ? ` Notes: ${resolutionNotes}` : ''}`,
          status: 'sent'
        });
      } catch (notifError) {
        console.error('[updateViolationStatus] Error sending notification:', notifError);
      }
    }

    logAction(user.id, 'COMPLIANCE_VIOLATION_UPDATED', 'ComplianceViolation', violation.id, { status }, req);

    res.json({
      success: true,
      message: 'Violation status updated successfully',
      data: violation
    });
  } catch (error) {
    console.error('Update violation status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update violation status',
      error: error.message
    });
  }
};

/**
 * Get violations by rule ID
 * GET /api/compliance/rules/:id/violations
 */
const getViolationsByRule = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const rule = await ComplianceRule.findByPk(id);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: 'Compliance rule not found'
      });
    }

    // Verify user has permission
    if (user.groupId && rule.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view violations for your own group.'
      });
    }

    const violations = await ComplianceViolation.findAll({
      where: { ruleId: id },
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone', 'email'] },
        { association: 'reporter', attributes: ['id', 'name', 'role'] },
        { association: 'resolver', attributes: ['id', 'name', 'role'], required: false }
      ],
      order: [['reportedDate', 'DESC']]
    });

    res.json({
      success: true,
      data: violations
    });
  } catch (error) {
    console.error('Get violations by rule error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch violations',
      error: error.message
    });
  }
};

/**
 * Get active agreements (approved votes)
 * GET /api/compliance/agreements
 */
const getActiveAgreements = async (req, res) => {
  try {
    const user = req.user;
    let groupId = null;

    if (user.groupId) {
      groupId = parseInt(user.groupId);
    } else {
      return res.json({
        success: true,
        data: []
      });
    }

    const { Vote } = require('../models');
    const agreements = await Vote.findAll({
      where: {
        groupId,
        status: 'approved'
      },
      include: [
        { association: 'creator', attributes: ['id', 'name'] },
        { association: 'group', attributes: ['id', 'name', 'code'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Get member count for each agreement (number of members who voted)
    const agreementsWithCounts = await Promise.all(
      agreements.map(async (agreement) => {
        const { VoteResponse } = require('../models');
        const memberCount = await VoteResponse.count({
          where: { voteId: agreement.id }
        });
        const agreementData = agreement.toJSON();
        return {
          ...agreementData,
          members: memberCount
        };
      })
    );

    res.json({
      success: true,
      data: agreementsWithCounts
    });
  } catch (error) {
    console.error('Get active agreements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active agreements',
      error: error.message
    });
  }
};

module.exports = {
  getComplianceSummary,
  getComplianceRules,
  createComplianceRule,
  updateComplianceRule,
  deleteComplianceRule,
  getComplianceRuleById,
  getComplianceViolations,
  createComplianceViolation,
  updateViolationStatus,
  getViolationsByRule,
  getActiveAgreements
};

