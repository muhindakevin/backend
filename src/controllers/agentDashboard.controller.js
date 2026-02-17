const models = require('../models');
const { Op } = require('sequelize');

// Safely extract models
const Group = models.Group;
const User = models.User;
const MemberApplication = models.MemberApplication;
const ComplianceViolation = models.ComplianceViolation;
const AuditLog = models.AuditLog;
const Meeting = models.Meeting;
const Loan = models.Loan;
const Contribution = models.Contribution;
const sequelize = models.sequelize;

/**
 * Get agent dashboard statistics
 * GET /api/agent/dashboard/stats
 */
const getDashboardStats = async (req, res) => {
  try {
    const user = req.user;
    console.log('[getDashboardStats] Request received from user:', user.id, user.name, user.role);

    // Verify models are available
    if (!Group || !User) {
      console.error('[getDashboardStats] Critical: Group or User model is missing');
      throw new Error('Required models are not available. Group or User is undefined.');
    }

    // MemberApplication is optional - table might not exist yet
    if (!MemberApplication) {
      console.warn('[getDashboardStats] Warning: MemberApplication model not available - pending approvals will be 0');
    }

    // Total active groups in the system
    let totalGroups = 0;
    try {
      totalGroups = await Group.count({
        where: {
          status: 'active'
        }
      });
      console.log('[getDashboardStats] Total active groups:', totalGroups);
    } catch (err) {
      console.error('[getDashboardStats] Error counting groups:', err);
      totalGroups = 0;
    }

    // Total active members in the system
    let totalMembers = 0;
    try {
      totalMembers = await User.count({
        where: {
          role: { [Op.in]: ['Member', 'Group Admin', 'Cashier', 'Secretary'] },
          status: 'active'
        }
      });
      console.log('[getDashboardStats] Total active members:', totalMembers);
    } catch (err) {
      console.error('[getDashboardStats] Error counting members:', err);
      totalMembers = 0;
    }

    // Pending approvals (member applications with pending status)
    let pendingApprovals = 0;
    try {
      // Check if MemberApplication model and table exist
      if (MemberApplication && typeof MemberApplication.count === 'function') {
        pendingApprovals = await MemberApplication.count({
          where: {
            status: 'pending'
          }
        });
        console.log('[getDashboardStats] Pending approvals:', pendingApprovals);
      } else {
        console.warn('[getDashboardStats] MemberApplication model not available, defaulting to 0');
        pendingApprovals = 0;
      }
    } catch (err) {
      console.error('[getDashboardStats] Error counting pending approvals:', err.message || err);
      console.error('[getDashboardStats] Error details:', {
        name: err.name,
        code: err.original?.code,
        sqlState: err.original?.sqlState
      });
      pendingApprovals = 0;
    }

    // Calculate compliance score
    // Compliance score = percentage of active groups without pending violations
    let complianceScore = 100; // Default to 100% (all compliant)
    try {
      // Use the totalGroups we already calculated
      const activeGroups = totalGroups;

      if (activeGroups > 0) {
        // Count distinct groups with pending or under-review violations using Sequelize
        let groupsWithViolations = 0;
        try {
          const violations = await ComplianceViolation.findAll({
            where: {
              status: { [Op.in]: ['pending', 'under-review'] }
            },
            attributes: ['groupId'],
            raw: true
          });

          // Get unique group IDs with violations
          const uniqueGroupIds = [...new Set(violations.map(v => v.groupId))];
          groupsWithViolations = uniqueGroupIds.length;
        } catch (violationError) {
          console.error('[getDashboardStats] Error querying violations (table may not exist):', violationError.message);
          // If violations table doesn't exist or query fails, assume no violations
          groupsWithViolations = 0;
        }

        // Score = (active groups without violations) / total active groups * 100
        const compliantGroups = Math.max(0, activeGroups - groupsWithViolations);
        complianceScore = Math.round((compliantGroups / activeGroups) * 100);
        console.log('[getDashboardStats] Compliance score calculated:', {
          activeGroups,
          groupsWithViolations,
          compliantGroups,
          complianceScore
        });
      } else {
        // If no active groups, set compliance to 100% (no violations possible)
        complianceScore = 100;
      }
    } catch (complianceError) {
      console.error('[getDashboardStats] Error calculating compliance score:', complianceError);
      console.error('[getDashboardStats] Compliance error details:', {
        message: complianceError.message,
        stack: complianceError.stack
      });
      // Default to 100 if calculation fails (assume all groups are compliant)
      complianceScore = 100;
    }

    // Total users (excluding Agents and System Admins) - for role management
    let totalUsers = 0;
    let activeUsers = 0;
    let suspendedUsers = 0;
    let activeMembers = 0;
    let suspendedMembers = 0;
    let pendingUsers = 0;

    try {
      totalUsers = await User.count({
        where: {
          role: { [Op.notIn]: ['Agent', 'System Admin'] }
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting total users:', err);
    }

    try {
      // Active users (excluding Agents and System Admins)
      activeUsers = await User.count({
        where: {
          role: { [Op.notIn]: ['Agent', 'System Admin'] },
          status: 'active'
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting active users:', err);
    }

    try {
      // Suspended users (excluding Agents and System Admins)
      suspendedUsers = await User.count({
        where: {
          role: { [Op.notIn]: ['Agent', 'System Admin'] },
          status: 'suspended'
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting suspended users:', err);
    }

    try {
      // Active members (all roles except Agent/System Admin)
      activeMembers = await User.count({
        where: {
          role: { [Op.in]: ['Member', 'Group Admin', 'Cashier', 'Secretary'] },
          status: 'active'
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting active members:', err);
    }

    try {
      // Suspended members (all roles except Agent/System Admin)
      suspendedMembers = await User.count({
        where: {
          role: { [Op.in]: ['Member', 'Group Admin', 'Cashier', 'Secretary'] },
          status: 'suspended'
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting suspended members:', err);
    }

    try {
      // Pending users (excluding Agents and System Admins)
      pendingUsers = await User.count({
        where: {
          role: { [Op.notIn]: ['Agent', 'System Admin'] },
          status: 'pending'
        }
      });
    } catch (err) {
      console.error('[getDashboardStats] Error counting pending users:', err);
    }

    // Ensure all values are numbers and valid
    const responseData = {
      totalGroups: isNaN(totalGroups) ? 0 : Number(totalGroups),
      totalMembers: isNaN(totalMembers) ? 0 : Number(totalMembers),
      pendingApprovals: isNaN(pendingApprovals) ? 0 : Number(pendingApprovals),
      complianceScore: isNaN(complianceScore) ? 100 : Number(complianceScore),
      // Role management statistics
      totalUsers: isNaN(totalUsers) ? 0 : Number(totalUsers),
      activeUsers: isNaN(activeUsers) ? 0 : Number(activeUsers),
      suspendedUsers: isNaN(suspendedUsers) ? 0 : Number(suspendedUsers),
      pendingUsers: isNaN(pendingUsers) ? 0 : Number(pendingUsers),
      // Member management statistics
      activeMembers: isNaN(activeMembers) ? 0 : Number(activeMembers),
      suspended: isNaN(suspendedMembers) ? 0 : Number(suspendedMembers)
    };

    console.log('[getDashboardStats] Sending response:', JSON.stringify(responseData, null, 2));

    // Check if response was already sent
    if (res.headersSent) {
      console.warn('[getDashboardStats] Response already sent, skipping');
      return;
    }

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[getDashboardStats] CRITICAL ERROR:', error);
    console.error('[getDashboardStats] Error name:', error.name);
    console.error('[getDashboardStats] Error message:', error.message);
    console.error('[getDashboardStats] Error stack:', error.stack);

    // Return a response with default values instead of failing completely
    const defaultResponse = {
      totalGroups: 0,
      totalMembers: 0,
      pendingApprovals: 0,
      complianceScore: 100,
      totalUsers: 0,
      activeUsers: 0,
      suspendedUsers: 0,
      pendingUsers: 0,
      activeMembers: 0,
      suspended: 0
    };

    console.log('[getDashboardStats] Returning default response due to error');

    res.status(200).json({
      success: true,
      data: defaultResponse,
      warning: 'Some statistics may be unavailable due to an error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get recent activities for agent
 * GET /api/agent/dashboard/activities
 */
const getRecentActivities = async (req, res) => {
  // Wrap everything in a try-catch to ensure we never return 500
  try {
    // Validate request
    if (!req || !req.user) {
      console.warn('[getRecentActivities] No user in request');
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const user = req.user;
    if (!user || !user.id) {
      console.warn('[getRecentActivities] User ID not available');
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const limit = parseInt(req.query.limit) || 10;

    let activities = [];

    try {
      // Check if AuditLog model is available
      if (!AuditLog || typeof AuditLog.findAll !== 'function') {
        console.warn('[getRecentActivities] AuditLog model not available');
        return res.json({
          success: true,
          data: []
        });
      }

      // Get recent audit logs for actions performed by the agent
      // Try without include first to avoid association errors
      activities = await AuditLog.findAll({
        where: {
          userId: user.id
        },
        order: [['createdAt', 'DESC']],
        limit: limit,
        raw: true // Use raw to avoid association issues
      });

      console.log('[getRecentActivities] Found', activities.length, 'activities');
    } catch (dbError) {
      console.error('[getRecentActivities] Error fetching audit logs:', dbError.message);
      console.error('[getRecentActivities] Error details:', {
        name: dbError.name,
        code: dbError.original?.code,
        sqlState: dbError.original?.sqlState,
        sqlMessage: dbError.original?.sqlMessage
      });
      // Return empty array if query fails
      activities = [];
    }

    // Format activities - handle both raw and model instances
    const formattedActivities = (activities || []).map(activity => {
      try {
        // Handle both raw data and model instances
        const activityData = activity.dataValues || activity;
        const action = activityData.action || '';
        let type = 'other';
        let title = action ? action.replace(/_/g, ' ').toUpperCase() : 'ACTIVITY';

        if (action && action.toLowerCase().includes('group')) {
          type = 'group';
        } else if (action && action.toLowerCase().includes('member')) {
          type = 'member';
        } else if (action && action.toLowerCase().includes('compliance')) {
          type = 'compliance';
        } else if (action && (action.toLowerCase().includes('training') || action.toLowerCase().includes('learn'))) {
          type = 'training';
        }

        // Calculate time ago
        const createdAt = activityData.createdAt ? new Date(activityData.createdAt) : new Date();
        const now = new Date();
        const diffInSeconds = Math.floor((now - createdAt) / 1000);
        let timeAgo = '';

        if (diffInSeconds < 60) {
          timeAgo = 'Just now';
        } else if (diffInSeconds < 3600) {
          timeAgo = `${Math.floor(diffInSeconds / 60)} minutes ago`;
        } else if (diffInSeconds < 86400) {
          timeAgo = `${Math.floor(diffInSeconds / 3600)} hours ago`;
        } else if (diffInSeconds < 604800) {
          timeAgo = `${Math.floor(diffInSeconds / 86400)} days ago`;
        } else {
          timeAgo = createdAt.toLocaleDateString();
        }

        return {
          id: activityData.id || Math.random(),
          type,
          title,
          entityType: activityData.entityType || 'System',
          time: timeAgo,
          timeFull: createdAt.toLocaleString(),
          status: 'completed',
          details: activityData.details || null
        };
      } catch (formatError) {
        console.error('[getRecentActivities] Error formatting activity:', formatError);
        return null;
      }
    }).filter(activity => activity !== null);

    // Check if response was already sent
    if (res.headersSent) {
      console.warn('[getRecentActivities] Response already sent, skipping');
      return;
    }

    res.json({
      success: true,
      data: formattedActivities
    });
  } catch (error) {
    console.error('[getRecentActivities] CRITICAL ERROR:', error);
    console.error('[getRecentActivities] Error stack:', error.stack);

    // Return empty array instead of failing
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        data: [],
        warning: 'Activities may be unavailable due to an error'
      });
    }
  }
};

/**
 * Get upcoming tasks for agent
 * GET /api/agent/dashboard/tasks
 */
const getUpcomingTasks = async (req, res) => {
  // Wrap everything in a try-catch to ensure we never return 500
  try {
    // Validate request
    if (!req) {
      console.warn('[getUpcomingTasks] No request object');
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const tasks = [];

    // Task 1: Pending member applications to review
    try {
      if (MemberApplication && typeof MemberApplication.count === 'function') {
        const pendingApplications = await MemberApplication.count({
          where: {
            status: 'pending'
          }
        });

        if (pendingApplications > 0) {
          tasks.push({
            id: 'pending-applications',
            task: `Review ${pendingApplications} pending member application${pendingApplications > 1 ? 's' : ''}`,
            type: 'approval',
            priority: 'high',
            dueDate: 'ASAP',
            count: pendingApplications
          });
        }
      }
    } catch (err) {
      console.error('[getUpcomingTasks] Error counting pending applications:', err.message);
    }

    // Task 2: Upcoming meetings (next 7 days)
    try {
      if (Meeting && typeof Meeting.count === 'function') {
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

        const upcomingMeetings = await Meeting.count({
          where: {
            scheduledDate: {
              [Op.between]: [new Date(), sevenDaysFromNow]
            },
            status: { [Op.in]: ['scheduled', 'ongoing'] }
          }
        });

        if (upcomingMeetings > 0) {
          tasks.push({
            id: 'upcoming-meetings',
            task: `${upcomingMeetings} meeting${upcomingMeetings > 1 ? 's' : ''} scheduled in next 7 days`,
            type: 'meeting',
            priority: 'medium',
            dueDate: 'Next 7 days',
            count: upcomingMeetings
          });
        }
      }
    } catch (err) {
      console.error('[getUpcomingTasks] Error counting upcoming meetings:', err.message);
    }

    // Task 3: Groups needing compliance review
    try {
      if (ComplianceViolation && typeof ComplianceViolation.findAll === 'function') {
        // Use a simpler query that doesn't require include
        const violations = await ComplianceViolation.findAll({
          where: {
            status: 'pending'
          },
          attributes: ['groupId'],
          raw: true
        });

        const uniqueGroupIds = [...new Set(violations.map(v => v.groupId))];
        const groupsNeedingReview = uniqueGroupIds.length;

        if (groupsNeedingReview > 0) {
          tasks.push({
            id: 'compliance-review',
            task: `${groupsNeedingReview} group${groupsNeedingReview > 1 ? 's' : ''} need${groupsNeedingReview === 1 ? 's' : ''} compliance review`,
            type: 'compliance',
            priority: 'high',
            dueDate: 'ASAP',
            count: groupsNeedingReview
          });
        }
      }
    } catch (err) {
      console.error('[getUpcomingTasks] Error counting groups needing compliance review:', err.message);
    }

    // Sort by priority (high first)
    tasks.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    // Check if response was already sent
    if (res.headersSent) {
      console.warn('[getUpcomingTasks] Response already sent, skipping');
      return;
    }

    res.json({
      success: true,
      data: tasks
    });
  } catch (error) {
    console.error('[getUpcomingTasks] CRITICAL ERROR:', error);
    console.error('[getUpcomingTasks] Error stack:', error.stack);

    // Return empty array instead of failing
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        data: [],
        warning: 'Tasks may be unavailable due to an error'
      });
    }
  }
};

/**
 * Get top performing groups
 * GET /api/agent/dashboard/top-groups
 */
const getTopPerformingGroups = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;

    // Get all active groups
    const groups = await Group.findAll({
      where: {
        status: 'active'
      },
      attributes: ['id', 'name', 'district', 'code', 'totalSavings'],
      order: [['totalSavings', 'DESC']],
      limit: limit * 2 // Get more to calculate scores, then limit
    });

    // Get additional statistics for each group
    const topGroups = await Promise.all(
      groups.map(async (group) => {
        const groupId = group.id;

        // Get total contributions
        let totalContributions = 0;
        try {
          const contribSum = await Contribution.sum('amount', {
            where: {
              groupId: groupId,
              status: 'approved'
            }
          });
          totalContributions = parseFloat(contribSum || 0);
        } catch (error) {
          console.error(`[getTopPerformingGroups] Error calculating contributions for group ${groupId}:`, error);
          totalContributions = parseFloat(group.totalSavings || 0);
        }

        // Get member count
        let memberCount = 0;
        try {
          memberCount = await User.count({
            where: {
              groupId: groupId,
              role: 'Member',
              status: 'active'
            }
          });
        } catch (error) {
          console.error(`[getTopPerformingGroups] Error counting members for group ${groupId}:`, error);
        }

        // Calculate performance score
        // Score based on: contributions per member, active members, and savings
        const contributionsPerMember = memberCount > 0 ? totalContributions / memberCount : 0;
        const savingsScore = totalContributions > 0 ? Math.min(100, Math.round((totalContributions / 100000) * 100)) : 0;
        const memberScore = Math.min(100, Math.round((memberCount / 50) * 100)); // Assuming 50 is a good group size
        const engagementScore = contributionsPerMember > 0 ? Math.min(100, Math.round((contributionsPerMember / 1000) * 100)) : 0;
        const performanceScore = Math.round((savingsScore * 0.5) + (memberScore * 0.3) + (engagementScore * 0.2));

        return {
          id: group.id,
          name: group.name,
          district: group.district || 'N/A',
          code: group.code || 'N/A',
          members: memberCount,
          contributions: totalContributions,
          score: performanceScore
        };
      })
    );

    // Sort by performance score (descending), then by contributions
    topGroups.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return b.contributions - a.contributions;
    });

    // Return top N groups
    res.json({
      success: true,
      data: topGroups.slice(0, limit)
    });
  } catch (error) {
    console.error('[getTopPerformingGroups] CRITICAL ERROR:', error);
    console.error('[getTopPerformingGroups] Error stack:', error.stack);

    // Return empty array instead of failing
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        data: [],
        warning: 'Top groups may be unavailable due to an error'
      });
    }
  }
};

/**
 * Get all members from all groups (for agent member management)
 * GET /api/agent/members
 */
const getAllMembers = async (req, res) => {
  try {
    const { groupId, status } = req.query;
    const user = req.user;

    // Only agents can access this endpoint
    if (user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can access this endpoint'
      });
    }

    let whereClause = {
      role: { [Op.in]: ['Member', 'Group Admin', 'Cashier', 'Secretary'] } // Exclude Agent and System Admin
    };

    // Filter by group if specified
    if (groupId && groupId !== 'all') {
      whereClause.groupId = parseInt(groupId);
    }

    // Filter by status if specified
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const members = await User.findAll({
      where: whereClause,
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code', 'district', 'sector'],
          required: false
        }
      ],
      attributes: [
        'id', 'name', 'phone', 'email', 'nationalId', 'role', 'status',
        'totalSavings', 'creditScore', 'createdAt', 'groupId'
      ],
      order: [['createdAt', 'DESC']]
    });

    // Format response
    const formattedMembers = members.map(member => {
      const memberData = member.toJSON ? member.toJSON() : member;
      return {
        id: memberData.id,
        name: memberData.name,
        phone: memberData.phone,
        email: memberData.email || '',
        nationalId: memberData.nationalId || '',
        role: memberData.role,
        status: memberData.status || 'active',
        groupId: memberData.groupId,
        group: memberData.group ? {
          id: memberData.group.id,
          name: memberData.group.name,
          code: memberData.group.code,
          district: memberData.group.district,
          sector: memberData.group.sector
        } : null,
        totalSavings: Number(memberData.totalSavings || 0),
        creditScore: memberData.creditScore || 0,
        registrationDate: memberData.createdAt ? new Date(memberData.createdAt).toISOString().split('T')[0] : ''
      };
    });

    res.json({
      success: true,
      data: formattedMembers
    });
  } catch (error) {
    console.error('[getAllMembers] CRITICAL ERROR:', error);
    console.error('[getAllMembers] Error stack:', error.stack);

    // Return empty array instead of failing
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        data: [],
        warning: 'Members may be unavailable due to an error'
      });
    }
  }
};

/**
 * Get agent compliance dashboard data
 * GET /api/agent/compliance/dashboard
 */
const getComplianceDashboard = async (req, res) => {
  try {
    const user = req.user;
    const { search, status, riskLevel, startDate, endDate } = req.query;

    console.log('[getComplianceDashboard] Request received:', { search, status, riskLevel, startDate, endDate });

    // Build where clause for groups
    let groupWhereClause = {};

    // Search conditions
    if (search && search.trim()) {
      const searchTerm = search.trim();
      groupWhereClause[Op.or] = [
        { name: { [Op.like]: `%${searchTerm}%` } },
        { code: { [Op.like]: `%${searchTerm}%` } },
        { district: { [Op.like]: `%${searchTerm}%` } },
        { sector: { [Op.like]: `%${searchTerm}%` } }
      ];
    }

    // Status filter
    if (status && status !== 'all') {
      groupWhereClause.status = status;
    }
    // If status is 'all', don't filter by status (show all groups)

    // Get all groups matching filters
    let groups = [];
    try {
      groups = await Group.findAll({
        where: groupWhereClause,
        attributes: ['id', 'name', 'code', 'district', 'sector', 'status', 'totalSavings', 'createdAt'],
        order: [['createdAt', 'DESC']]
      });
    } catch (err) {
      console.error('[getComplianceDashboard] Error fetching groups:', err);
      groups = [];
    }

    // Loan and Contribution models are already extracted at the top

    // Calculate compliance metrics for each group
    const groupsWithCompliance = await Promise.all(groups.map(async (group) => {
      try {
        // Get group loans
        let groupLoans = [];
        try {
          groupLoans = await Loan.findAll({
            where: { groupId: group.id },
            attributes: ['id', 'amount', 'status', 'dueDate'],
            raw: true
          });
        } catch (err) {
          console.error(`[getComplianceDashboard] Error fetching loans for group ${group.id}:`, err);
        }

        // Get group contributions
        let groupContributions = [];
        try {
          groupContributions = await Contribution.findAll({
            where: { groupId: group.id },
            attributes: ['id', 'amount', 'status'],
            raw: true
          });
        } catch (err) {
          console.error(`[getComplianceDashboard] Error fetching contributions for group ${group.id}:`, err);
        }

        // Get member count
        let memberCount = 0;
        try {
          memberCount = await User.count({
            where: {
              groupId: group.id,
              status: 'active'
            }
          });
        } catch (err) {
          console.error(`[getComplianceDashboard] Error counting members for group ${group.id}:`, err);
        }

        // Calculate repayment rate
        const paidLoans = groupLoans.filter(l => l.status === 'completed' || l.status === 'paid').length;
        const totalActiveLoans = groupLoans.filter(l => ['approved', 'disbursed', 'active'].includes(l.status)).length;
        const repaymentRate = totalActiveLoans > 0 ? Math.round((paidLoans / totalActiveLoans) * 100) : 100;

        // Calculate compliance score
        const overdueLoans = groupLoans.filter(l => l.status === 'overdue').length;
        const activeContributions = groupContributions.filter(c => c.status === 'approved' || c.status === 'completed').length;
        const pendingContributions = groupContributions.filter(c => c.status === 'pending').length;

        let complianceScore = 100;
        if (overdueLoans > 0) complianceScore -= (overdueLoans * 5);
        if (pendingContributions > activeContributions) complianceScore -= 10;
        if (group.status !== 'active') complianceScore -= 20;
        complianceScore = Math.max(0, Math.min(100, complianceScore));

        // Determine risk level
        let riskLevel = 'low';
        if (complianceScore < 70) riskLevel = 'high';
        else if (complianceScore < 85) riskLevel = 'medium';

        // Get violations count
        let violationsCount = 0;
        try {
          violationsCount = await ComplianceViolation.count({
            where: {
              groupId: group.id,
              status: { [Op.in]: ['pending', 'under-review'] }
            }
          });
        } catch (err) {
          console.error(`[getComplianceDashboard] Error counting violations for group ${group.id}:`, err);
        }

        // Get last audit date
        let lastAudit = null;
        try {
          const lastAuditLog = await AuditLog.findOne({
            where: {
              entityType: 'Group',
              entityId: group.id
            },
            order: [['createdAt', 'DESC']],
            attributes: ['createdAt'],
            raw: true
          });
          if (lastAuditLog && lastAuditLog.createdAt) {
            lastAudit = new Date(lastAuditLog.createdAt).toISOString().split('T')[0];
          }
        } catch (err) {
          console.error(`[getComplianceDashboard] Error fetching audit for group ${group.id}:`, err);
        }

        return {
          id: group.id,
          name: group.name,
          code: group.code || '',
          district: group.district || 'N/A',
          sector: group.sector || 'N/A',
          status: group.status || 'active',
          complianceScore,
          riskLevel,
          totalMembers: memberCount,
          totalContributions: Number(group.totalSavings || 0),
          totalLoans: groupLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0),
          repaymentRate,
          lastAudit: lastAudit || 'Never',
          violations: violationsCount
        };
      } catch (groupError) {
        console.error(`[getComplianceDashboard] Error processing group ${group.id}:`, groupError);
        return {
          id: group.id,
          name: group.name || 'Unknown',
          code: group.code || '',
          district: group.district || 'N/A',
          sector: group.sector || 'N/A',
          status: group.status || 'active',
          complianceScore: 0,
          riskLevel: 'high',
          totalMembers: 0,
          totalContributions: 0,
          totalLoans: 0,
          repaymentRate: 0,
          lastAudit: 'Never',
          violations: 0
        };
      }
    }));

    // Filter by risk level if specified
    let filteredGroups = groupsWithCompliance;
    if (riskLevel && riskLevel !== 'all') {
      filteredGroups = groupsWithCompliance.filter(g => g.riskLevel === riskLevel);
    }

    // Get violations with date range filter
    let violationsWhereClause = {};
    if (startDate && endDate) {
      violationsWhereClause.reportedDate = {
        [Op.between]: [new Date(startDate), new Date(endDate)]
      };
    } else if (startDate) {
      violationsWhereClause.reportedDate = {
        [Op.gte]: new Date(startDate)
      };
    } else if (endDate) {
      violationsWhereClause.reportedDate = {
        [Op.lte]: new Date(endDate)
      };
    }

    // Get all violations (for agents, show all groups)
    let violations = [];
    try {
      if (ComplianceViolation && typeof ComplianceViolation.findAll === 'function') {
        // Try with associations first
        try {
          const violationsData = await ComplianceViolation.findAll({
            where: violationsWhereClause,
            include: [
              { association: 'group', attributes: ['id', 'name', 'code'], required: false },
              { association: 'rule', attributes: ['id', 'title', 'category'], required: false },
              { association: 'member', attributes: ['id', 'name', 'phone'], required: false }
            ],
            order: [['reportedDate', 'DESC']],
            raw: false
          });

          violations = violationsData.map(v => {
            const vData = v.toJSON ? v.toJSON() : v;
            return {
              id: vData.id,
              groupId: vData.groupId,
              groupName: vData.group ? vData.group.name : 'Unknown Group',
              type: vData.rule ? vData.rule.title : 'Compliance Violation',
              description: vData.description || 'No description',
              severity: vData.severity || 'medium',
              date: vData.reportedDate ? new Date(vData.reportedDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              status: vData.status || 'pending',
              resolvedBy: vData.resolvedBy || null
            };
          });
        } catch (assocError) {
          // Fallback to simple query without associations
          console.warn('[getComplianceDashboard] Association query failed, using simple query:', assocError.message);
          const violationsData = await ComplianceViolation.findAll({
            where: violationsWhereClause,
            attributes: ['id', 'groupId', 'description', 'severity', 'reportedDate', 'status', 'resolvedBy'],
            order: [['reportedDate', 'DESC']],
            raw: true
          });

          // Get group names separately
          const groupIds = [...new Set(violationsData.map(v => v.groupId).filter(id => id))];
          const groupsMap = {};
          if (groupIds.length > 0) {
            try {
              const groups = await Group.findAll({
                where: { id: { [Op.in]: groupIds } },
                attributes: ['id', 'name', 'code'],
                raw: true
              });
              groups.forEach(g => {
                groupsMap[g.id] = g.name;
              });
            } catch (groupError) {
              console.error('[getComplianceDashboard] Error fetching group names:', groupError);
            }
          }

          violations = violationsData.map(v => ({
            id: v.id,
            groupId: v.groupId,
            groupName: groupsMap[v.groupId] || 'Unknown Group',
            type: 'Compliance Violation',
            description: v.description || 'No description',
            severity: v.severity || 'medium',
            date: v.reportedDate ? new Date(v.reportedDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            status: v.status || 'pending',
            resolvedBy: v.resolvedBy || null
          }));
        }
      } else {
        console.warn('[getComplianceDashboard] ComplianceViolation model not available');
      }
    } catch (err) {
      console.error('[getComplianceDashboard] Error fetching violations:', err);
      violations = [];
    }

    // Calculate summary statistics
    const totalGroups = filteredGroups.length;
    const highRiskGroups = filteredGroups.filter(g => g.riskLevel === 'high').length;
    const activeViolations = violations.filter(v => v.status === 'pending' || v.status === 'under-review').length;
    const avgCompliance = filteredGroups.length > 0
      ? Math.round(filteredGroups.reduce((sum, g) => sum + (g.complianceScore || 0), 0) / filteredGroups.length)
      : 0;

    console.log('[getComplianceDashboard] Returning data:', {
      totalGroups,
      highRiskGroups,
      activeViolations,
      avgCompliance,
      groupsCount: filteredGroups.length,
      violationsCount: violations.length
    });

    res.json({
      success: true,
      data: {
        summary: {
          totalGroups,
          highRiskGroups,
          activeViolations,
          avgCompliance
        },
        groups: filteredGroups,
        violations: violations.filter(v => v.status !== 'resolved')
      }
    });
  } catch (error) {
    console.error('[getComplianceDashboard] CRITICAL ERROR:', error);
    console.error('[getComplianceDashboard] Error stack:', error.stack);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalGroups: 0,
          highRiskGroups: 0,
          activeViolations: 0,
          avgCompliance: 0
        },
        groups: [],
        violations: []
      },
      warning: 'Compliance data may be unavailable due to an error'
    });
  }
};

/**
 * Get comprehensive reports data for agent
 * GET /api/agent/reports
 * Query params: reportType, dateRange, startDate, endDate, groupId
 */
const getReportsData = async (req, res) => {
  try {
    const user = req.user;
    const { reportType, dateRange, startDate, endDate, groupId } = req.query;

    console.log('[getReportsData] Request received:', { reportType, dateRange, startDate, endDate, groupId });

    // Calculate date range
    let dateFilter = {};
    let start, end;

    if (startDate && endDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateFilter = {
        [Op.between]: [start, end]
      };
    } else if (dateRange) {
      end = new Date();
      end.setHours(23, 59, 59, 999);

      switch (dateRange) {
        case 'daily':
          start = new Date();
          start.setHours(0, 0, 0, 0);
          break;
        case 'weekly':
          start = new Date();
          start.setDate(start.getDate() - 7);
          start.setHours(0, 0, 0, 0);
          break;
        case 'monthly':
          start = new Date();
          start.setMonth(start.getMonth() - 1);
          start.setHours(0, 0, 0, 0);
          break;
        case 'quarterly':
          start = new Date();
          start.setMonth(start.getMonth() - 3);
          start.setHours(0, 0, 0, 0);
          break;
        case 'yearly':
          start = new Date();
          start.setFullYear(start.getFullYear() - 1);
          start.setHours(0, 0, 0, 0);
          break;
        default:
          start = new Date();
          start.setMonth(start.getMonth() - 1);
          start.setHours(0, 0, 0, 0);
      }
      dateFilter = {
        [Op.between]: [start, end]
      };
    } else {
      // Default to last month
      end = new Date();
      end.setHours(23, 59, 59, 999);
      start = new Date();
      start.setMonth(start.getMonth() - 1);
      start.setHours(0, 0, 0, 0);
      dateFilter = {
        [Op.between]: [start, end]
      };
    }

    // Build group filter
    let groupWhereClause = {};
    if (groupId && groupId !== 'all') {
      groupWhereClause.id = parseInt(groupId);
    }

    // Get groups
    let groups = [];
    try {
      groups = await Group.findAll({
        where: groupWhereClause,
        attributes: ['id', 'name', 'code', 'district', 'sector', 'status', 'totalSavings', 'createdAt'],
        order: [['name', 'ASC']]
      });
    } catch (err) {
      console.error('[getReportsData] Error fetching groups:', err);
      groups = [];
    }

    // Get Transaction model
    const Transaction = models.Transaction;

    // Initialize response data
    const responseData = {
      summary: {
        totalContributions: 0,
        totalLoans: 0,
        totalMembers: 0,
        avgCompliance: 0
      },
      performance: null,
      memberAnalytics: null,
      financial: null,
      compliance: null,
      risk: null
    };

    // Get all loans with date filter
    let allLoans = [];
    try {
      const loanWhereClause = {};
      if (groupId && groupId !== 'all') {
        loanWhereClause.groupId = parseInt(groupId);
      }
      if (Object.keys(dateFilter).length > 0) {
        loanWhereClause.createdAt = dateFilter;
      }

      allLoans = await Loan.findAll({
        where: loanWhereClause,
        attributes: ['id', 'amount', 'status', 'groupId', 'memberId', 'createdAt', 'dueDate'],
        raw: true
      });
    } catch (err) {
      console.error('[getReportsData] Error fetching loans:', err);
    }

    // Get all contributions with date filter
    let allContributions = [];
    try {
      const contribWhereClause = {};
      if (groupId && groupId !== 'all') {
        contribWhereClause.groupId = parseInt(groupId);
      }
      if (Object.keys(dateFilter).length > 0) {
        contribWhereClause.createdAt = dateFilter;
      }

      allContributions = await Contribution.findAll({
        where: contribWhereClause,
        attributes: ['id', 'amount', 'status', 'groupId', 'memberId', 'createdAt'],
        raw: true
      });
    } catch (err) {
      console.error('[getReportsData] Error fetching contributions:', err);
    }

    // Get all transactions with date filter
    let allTransactions = [];
    try {
      if (Transaction) {
        const transWhereClause = {};
        if (groupId && groupId !== 'all') {
          transWhereClause.groupId = parseInt(groupId);
        }
        if (Object.keys(dateFilter).length > 0) {
          transWhereClause.transactionDate = dateFilter;
        }

        allTransactions = await Transaction.findAll({
          where: transWhereClause,
          attributes: ['id', 'amount', 'type', 'groupId', 'createdAt', 'transactionDate'],
          raw: true
        });
      }
    } catch (err) {
      console.error('[getReportsData] Error fetching transactions:', err);
    }

    // Get all users (members)
    let allUsers = [];
    try {
      const userWhereClause = {
        role: { [Op.in]: ['Member', 'Group Admin', 'Cashier', 'Secretary'] }
      };
      if (groupId && groupId !== 'all') {
        userWhereClause.groupId = parseInt(groupId);
      }

      allUsers = await User.findAll({
        where: userWhereClause,
        attributes: ['id', 'name', 'groupId', 'status', 'totalSavings', 'createdAt'],
        raw: true
      });
    } catch (err) {
      console.error('[getReportsData] Error fetching users:', err);
    }

    // Calculate summary
    const approvedContributions = allContributions.filter(c => c.status === 'approved' || c.status === 'completed');
    const totalContributions = approvedContributions.reduce((sum, c) => sum + Number(c.amount || 0), 0);
    const totalLoans = allLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const totalMembers = allUsers.filter(u => u.status === 'active').length;

    // Calculate average compliance
    let avgCompliance = 0;
    if (groups.length > 0) {
      const activeGroups = groups.filter(g => g.status === 'active').length;
      avgCompliance = Math.round((activeGroups / groups.length) * 100);
    }

    responseData.summary = {
      totalContributions,
      totalLoans,
      totalMembers,
      avgCompliance
    };

    // Generate report data based on reportType
    if (!reportType || reportType === 'performance' || reportType === 'all') {
      // Performance data
      const performanceGroups = await Promise.all(groups.map(async (group) => {
        const groupLoans = allLoans.filter(l => l.groupId === group.id);
        const groupContributions = approvedContributions.filter(c => c.groupId === group.id);
        const groupMembers = allUsers.filter(u => u.groupId === group.id && u.status === 'active');

        const totalGroupLoans = groupLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0);
        const totalGroupContributions = groupContributions.reduce((sum, c) => sum + Number(c.amount || 0), 0);

        // Calculate repayment rate
        const paidLoans = groupLoans.filter(l => l.status === 'completed' || l.status === 'paid').length;
        const repaymentRate = groupLoans.length > 0
          ? Math.round((paidLoans / groupLoans.length) * 100)
          : 100;

        // Calculate performance score
        const score = Math.round((repaymentRate * 0.6) + (totalGroupContributions > 0 ? Math.min(100, (totalGroupContributions / 100000) * 10) : 0) * 0.4);

        return {
          id: group.id,
          name: group.name,
          code: group.code || '',
          contributions: totalGroupContributions,
          loans: totalGroupLoans,
          members: groupMembers.length,
          score
        };
      }));

      responseData.performance = {
        groups: performanceGroups.sort((a, b) => b.score - a.score),
        trends: {
          contributions: { current: totalContributions, previous: 0, change: 0 },
          loans: { current: totalLoans, previous: 0, change: 0 },
          members: { current: totalMembers, previous: 0, change: 0 },
          compliance: { current: avgCompliance, previous: 0, change: 0 }
        }
      };
    }

    if (!reportType || reportType === 'members' || reportType === 'all') {
      // Member analytics
      const activeMembers = allUsers.filter(u => u.status === 'active');
      const newMembers = allUsers.filter(u => {
        const created = new Date(u.createdAt);
        return created >= start && created <= end;
      });
      const suspendedMembers = allUsers.filter(u => u.status === 'suspended');

      // Top performing members
      const topMembers = activeMembers
        .sort((a, b) => (Number(b.totalSavings || 0)) - (Number(a.totalSavings || 0)))
        .slice(0, 10)
        .map(m => {
          const memberGroup = groups.find(g => g.id === m.groupId);
          const memberLoans = allLoans.filter(l => l.memberId === m.id);
          return {
            name: m.name,
            group: memberGroup ? memberGroup.name : 'Unknown',
            contributions: Number(m.totalSavings || 0),
            loans: memberLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0)
          };
        });

      responseData.memberAnalytics = {
        totalMembers: allUsers.length,
        activeMembers: activeMembers.length,
        newMembers: newMembers.length,
        suspendedMembers: suspendedMembers.length,
        memberGrowth: [],
        topPerformingMembers: topMembers
      };
    }

    if (!reportType || reportType === 'financial' || reportType === 'all') {
      // Financial data
      const loanRepayments = allTransactions.filter(t => t.type === 'loan_repayment');
      const totalRepayments = loanRepayments.reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const activeLoans = allLoans.filter(l => ['approved', 'disbursed', 'active'].includes(l.status));
      const outstandingLoans = activeLoans.reduce((sum, l) => sum + Number(l.amount || 0), 0) - totalRepayments;

      responseData.financial = {
        totalContributions,
        totalLoans,
        totalRepayments,
        outstandingLoans: Math.max(0, outstandingLoans),
        monthlyContributions: [],
        loanPerformance: {
          current: activeLoans.length,
          overdue: allLoans.filter(l => l.status === 'overdue').length,
          defaulted: allLoans.filter(l => l.status === 'defaulted').length
        }
      };
    }

    if (!reportType || reportType === 'compliance' || reportType === 'all') {
      // Compliance data
      let violationsCount = 0;
      let resolvedViolations = 0;
      let pendingViolations = 0;

      try {
        if (ComplianceViolation) {
          const violationWhereClause = {};
          if (groupId && groupId !== 'all') {
            violationWhereClause.groupId = parseInt(groupId);
          }

          const allViolations = await ComplianceViolation.findAll({
            where: violationWhereClause,
            attributes: ['id', 'status', 'groupId'],
            raw: true
          });

          violationsCount = allViolations.length;
          resolvedViolations = allViolations.filter(v => v.status === 'resolved').length;
          pendingViolations = allViolations.filter(v => v.status === 'pending' || v.status === 'under-review').length;
        }
      } catch (err) {
        console.error('[getReportsData] Error fetching violations:', err);
      }

      const activeGroups = groups.filter(g => g.status === 'active').length;
      const groupsAtRisk = groups.filter(g => g.status !== 'active').length;

      responseData.compliance = {
        overallScore: avgCompliance,
        groupsCompliant: activeGroups,
        groupsAtRisk,
        violations: violationsCount,
        resolvedViolations,
        pendingViolations,
        complianceTrends: []
      };
    }

    if (!reportType || reportType === 'risk' || reportType === 'all') {
      // Risk analysis
      const riskGroups = await Promise.all(groups.map(async (group) => {
        const groupLoans = allLoans.filter(l => l.groupId === group.id);
        const overdueLoans = groupLoans.filter(l => l.status === 'overdue').length;
        const defaultedLoans = groupLoans.filter(l => l.status === 'defaulted').length;

        let riskLevel = 'low';
        if (group.status !== 'active' || defaultedLoans > 0) {
          riskLevel = 'high';
        } else if (overdueLoans > 0) {
          riskLevel = 'medium';
        }

        return {
          id: group.id,
          name: group.name,
          riskLevel
        };
      }));

      const highRiskGroups = riskGroups.filter(g => g.riskLevel === 'high').length;
      const mediumRiskGroups = riskGroups.filter(g => g.riskLevel === 'medium').length;
      const lowRiskGroups = riskGroups.filter(g => g.riskLevel === 'low').length;

      responseData.risk = {
        highRiskGroups,
        mediumRiskGroups,
        lowRiskGroups,
        riskFactors: [],
        recommendations: highRiskGroups > 0 ? [
          'Monitor high-risk groups closely',
          'Review group compliance regularly',
          'Provide additional support to struggling groups'
        ] : []
      };
    }

    console.log('[getReportsData] Returning data for reportType:', reportType);

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[getReportsData] CRITICAL ERROR:', error);
    console.error('[getReportsData] Error stack:', error.stack);

    res.status(200).json({
      success: true,
      data: {
        summary: { totalContributions: 0, totalLoans: 0, totalMembers: 0, avgCompliance: 0 },
        performance: null,
        memberAnalytics: null,
        financial: null,
        compliance: null,
        risk: null
      },
      warning: 'Report data may be unavailable due to an error'
    });
  }
};

const toggleMemberStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    // Toggle between active and burned
    const newStatus = user.status === 'burned' ? 'active' : 'burned';
    user.status = newStatus;
    await user.save();

    const { logAction } = require('../utils/auditLogger');
    logAction(req.user.id, 'TOGGLE_MEMBER_STATUS', 'User', user.id, { newStatus }, req);

    res.json({
      success: true,
      message: `Member account ${newStatus === 'burned' ? 'burned' : 'activated'} successfully`,
      data: { status: newStatus }
    });
  } catch (error) {
    console.error('[toggleMemberStatus] Error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle member status', error: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getRecentActivities,
  getUpcomingTasks,
  getTopPerformingGroups,
  getAllMembers,
  getComplianceDashboard,
  getReportsData,
  toggleMemberStatus
};

