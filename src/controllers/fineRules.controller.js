const { Group, User, Setting, Vote, VoteOption, Notification } = require('../models');
const { Op } = require('sequelize');

/**
 * Get fine rules for a group
 * GET /api/fine-rules/:groupId
 */
const getFineRules = async (req, res) => {
  try {
    const { groupId } = req.params;
    const user = req.user;

    // Check permissions
    if ((user.role === 'Group Admin' || user.role === 'Cashier') && user.groupId !== parseInt(groupId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Fetch fine rules from settings
    const settings = await Setting.findAll({
      where: {
        key: {
          [Op.like]: `group_${groupId}_fineRule_%`
        }
      }
    });

    // Default fine rules
    const defaultRules = [
      {
        id: 'late_contribution',
        name: 'Late Contribution Fine',
        description: 'Applied when contribution is paid after due date',
        amount: 500,
        gracePeriod: 1,
        isActive: true
      },
      {
        id: 'missed_loan_payment',
        name: 'Missed Loan Payment Fine',
        description: 'Applied when loan payment is overdue',
        amount: 1000,
        gracePeriod: 0,
        isActive: true
      },
      {
        id: 'meeting_absence',
        name: 'Meeting Absence Fine',
        description: 'Applied when member misses group meeting',
        amount: 300,
        gracePeriod: 0,
        isActive: false
      }
    ];

    // Parse settings into rules
    const rules = defaultRules.map(rule => {
      const amountKey = `group_${groupId}_fineRule_${rule.id}_amount`;
      const graceKey = `group_${groupId}_fineRule_${rule.id}_gracePeriod`;
      const activeKey = `group_${groupId}_fineRule_${rule.id}_isActive`;

      const amountSetting = settings.find(s => s.key === amountKey);
      const graceSetting = settings.find(s => s.key === graceKey);
      const activeSetting = settings.find(s => s.key === activeKey);

      return {
        ...rule,
        amount: amountSetting ? parseFloat(amountSetting.value) : rule.amount,
        gracePeriod: graceSetting ? parseInt(graceSetting.value) : rule.gracePeriod,
        isActive: activeSetting ? activeSetting.value === 'true' : rule.isActive
      };
    });

    res.json({
      success: true,
      data: rules
    });
  } catch (error) {
    console.error('Get fine rules error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fine rules',
      error: error.message
    });
  }
};

/**
 * Propose fine rules changes (creates a vote)
 * POST /api/fine-rules/:groupId/propose
 */
const proposeFineRulesChanges = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { rules } = req.body;
    const userId = req.user.id;

    if (!rules || !Array.isArray(rules)) {
      return res.status(400).json({
        success: false,
        message: 'Rules array is required'
      });
    }

    // Verify user has permission
    const user = await User.findByPk(userId);
    if (!user || user.groupId !== parseInt(groupId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    if (!['Group Admin', 'Cashier'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only Group Admin and Cashier can propose fine rule changes'
      });
    }

    // Get current rules for comparison
    const currentSettings = await Setting.findAll({
      where: {
        key: {
          [Op.like]: `group_${groupId}_fineRule_%`
        }
      }
    });

    // Build description with metadata
    let description = 'Proposed changes to fine rules:\n\n';
    rules.forEach(rule => {
      description += `${rule.name}:\n`;
      description += `  Amount: ${rule.amount} RWF (Grace Period: ${rule.gracePeriod} days)\n`;
      description += `  Status: ${rule.isActive ? 'Active' : 'Inactive'}\n\n`;
    });

    // Add metadata for vote processing
    const metadata = {
      type: 'fine_rules_change',
      rules: rules,
      groupId: parseInt(groupId)
    };
    description += `[VOTE_METADATA_START]${JSON.stringify(metadata)}[VOTE_METADATA_END]`;

    // Create vote
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 7); // 7 days to vote

    // Validate vote type
    const validTypes = [
      'loan_approval', 'loan_approval_override', 'member_admission', 'fine_waiver', 
      'policy_change', 'withdrawal_approval', 'contribution_change', 
      'saving_amount_change', 'fine_change', 'fine_amount_change', 
      'interest_rate_change', 'other'
    ];
    const voteType = validTypes.includes('fine_change') ? 'fine_change' : 'other';

    const vote = await Vote.create({
      groupId: parseInt(groupId),
      title: 'Fine Rules Change Proposal',
      description: description,
      type: voteType,
      endDate: endDate,
      createdBy: userId,
      status: 'open'
    });

    // Create vote options
    const voteOptions = await Promise.all([
      VoteOption.create({
        voteId: vote.id,
        option: 'Approve'
      }),
      VoteOption.create({
        voteId: vote.id,
        option: 'Reject'
      })
    ]);

    // Send notifications to Group Admin and all members
    try {
      const groupMembers = await User.findAll({
        where: {
          groupId: parseInt(groupId),
          status: 'active'
        },
        attributes: ['id', 'name', 'role']
      });

      const notificationPromises = groupMembers.map(member =>
        Notification.create({
          userId: member.id,
          type: 'vote_created',
          title: 'New Vote: Fine Rules Change Proposal',
          content: `A proposal to change fine rules has been created. Please vote in the Group Voting section.`,
          status: 'sent'
        })
      );

      await Promise.all(notificationPromises);
      console.log(`[proposeFineRulesChanges] Sent notifications to ${groupMembers.length} members`);
    } catch (notifError) {
      console.error('[proposeFineRulesChanges] Error sending notifications:', notifError);
    }

    res.json({
      success: true,
      message: 'Fine rules change proposal created. Voting is now open.',
      data: {
        voteId: vote.id,
        vote: {
          ...vote.toJSON(),
          options: voteOptions
        }
      }
    });
  } catch (error) {
    console.error('Propose fine rules changes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to propose fine rules changes',
      error: error.message
    });
  }
};

/**
 * Apply approved fine rules (called after vote is approved)
 * This is called from voting controller when vote is approved
 */
const applyFineRules = async (groupId, rules) => {
  try {
    // Delete existing fine rule settings
    await Setting.destroy({
      where: {
        key: {
          [Op.like]: `group_${groupId}_fineRule_%`
        }
      }
    });

    // Create new settings for each rule
    const settingPromises = rules.map(rule => [
      Setting.create({
        key: `group_${groupId}_fineRule_${rule.id}_amount`,
        value: rule.amount.toString()
      }),
      Setting.create({
        key: `group_${groupId}_fineRule_${rule.id}_gracePeriod`,
        value: rule.gracePeriod.toString()
      }),
      Setting.create({
        key: `group_${groupId}_fineRule_${rule.id}_isActive`,
        value: rule.isActive.toString()
      })
    ]).flat();

    await Promise.all(settingPromises);

    console.log(`[applyFineRules] Applied fine rules for group ${groupId}`);
    return true;
  } catch (error) {
    console.error('[applyFineRules] Error applying fine rules:', error);
    throw error;
  }
};

module.exports = {
  getFineRules,
  proposeFineRulesChanges,
  applyFineRules
};

