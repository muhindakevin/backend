const { Group, User, Loan, Contribution, MemberApplication, Transaction, Fine, Meeting, Announcement, Notification, Vote, VoteResponse, sequelize } = require('../models');
const { createAutomaticVote } = require('./voting.controller');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

/**
 * Get all groups
 * GET /api/groups
 */
const getGroups = async (req, res) => {
  try {
    const { status, branchId, viewAll, search } = req.query;
    const user = req.user;

    console.log('[getGroups] Request received:', { status, branchId, viewAll, search, userRole: user.role, userId: user.id });

    // Build base where conditions
    const baseConditions = [];

    // For Agents: by default show only groups they registered, unless viewAll=true
    if (user.role === 'Agent') {
      if (viewAll !== 'true') {
        // Only show groups registered by this agent
        baseConditions.push({ agentId: user.id });
      }
      // When viewAll=true, show all groups (no agentId filter)
      if (branchId) baseConditions.push({ branchId: parseInt(branchId) });
    } else if (user.role === 'System Admin') {
      // System Admin can see all groups
      if (branchId) baseConditions.push({ branchId: parseInt(branchId) });
    } else if (user.role === 'Group Admin' || user.role === 'Member') {
      if (user.groupId) baseConditions.push({ id: user.groupId });
    }

    if (status && status !== 'all') {
      baseConditions.push({ status: status });
    }

    // Build search conditions
    let searchConditions = null;
    if (search && search.trim()) {
      const searchTerm = search.trim();
      console.log('[getGroups] Searching for:', searchTerm);
      
      // Use LIKE for flexible searching (supports both exact and partial matches)
      // MySQL LIKE is case-insensitive by default
      searchConditions = {
        [Op.or]: [
          { name: { [Op.like]: `%${searchTerm}%` } },
          { code: { [Op.like]: `%${searchTerm}%` } },
          { district: { [Op.like]: `%${searchTerm}%` } },
          { sector: { [Op.like]: `%${searchTerm}%` } }
        ]
      };
    }

    // Combine all conditions
    let whereClause = {};
    try {
      if (baseConditions.length > 0 && searchConditions) {
        // Both base conditions and search conditions
        whereClause = {
          [Op.and]: [
            ...baseConditions,
            searchConditions
          ]
        };
      } else if (baseConditions.length > 0) {
        // Only base conditions
        if (baseConditions.length === 1) {
          whereClause = baseConditions[0];
        } else {
          whereClause = { [Op.and]: baseConditions };
        }
      } else if (searchConditions) {
        // Only search conditions
        whereClause = searchConditions;
      }
      // If all are empty, whereClause remains {} which is valid (returns all)

      console.log('[getGroups] Where clause:', JSON.stringify(whereClause, null, 2));
    } catch (whereError) {
      console.error('[getGroups] Error building where clause:', whereError);
      // Use empty whereClause as fallback
      whereClause = {};
    }

    let groups = [];
    try {
      // Try with associations first
      groups = await Group.findAll({
        where: whereClause,
        include: [
          { association: 'branch', attributes: ['id', 'name', 'code'], required: false },
          { association: 'agent', attributes: ['id', 'name', 'phone'], required: false }
        ],
        order: [['createdAt', 'DESC']]
      });
    } catch (includeError) {
      console.warn('[getGroups] Error with associations, trying without:', includeError.message);
      console.warn('[getGroups] Error details:', {
        name: includeError.name,
        message: includeError.message
      });
      // If associations fail, try without them
      try {
        groups = await Group.findAll({
          where: whereClause,
          order: [['createdAt', 'DESC']]
        });
      } catch (basicError) {
        console.error('[getGroups] Error fetching groups:', basicError);
        throw basicError;
      }
    }

    console.log('[getGroups] Found groups:', groups.length);

    // Calculate total members for each group
    const groupsWithStats = await Promise.all(groups.map(async (group) => {
      try {
        const groupData = group.toJSON ? group.toJSON() : group;
        let memberCount = 0;
        try {
          memberCount = await User.count({
            where: {
              groupId: group.id,
              status: 'active'
            }
          });
        } catch (countError) {
          console.error(`[getGroups] Error counting members for group ${group.id}:`, countError.message);
          memberCount = 0;
        }
        return {
          ...groupData,
          totalMembers: memberCount
        };
      } catch (groupError) {
        console.error(`[getGroups] Error processing group ${group.id}:`, groupError.message);
        const groupData = group.toJSON ? group.toJSON() : group;
        return {
          ...groupData,
          totalMembers: 0
        };
      }
    }));

    console.log('[getGroups] Returning', groupsWithStats.length, 'groups');

    res.json({
      success: true,
      data: groupsWithStats,
      count: groupsWithStats.length
    });
  } catch (error) {
    console.error('[getGroups] CRITICAL ERROR:', error);
    console.error('[getGroups] Error stack:', error.stack);
    console.error('[getGroups] Error details:', {
      name: error.name,
      message: error.message,
      original: error.original?.message
    });
    
    // Return empty array instead of failing completely
    res.status(200).json({
      success: true,
      data: [],
      count: 0,
      warning: 'Groups may be unavailable due to an error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get group details
 * GET /api/groups/:id
 */
const getGroupById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[getGroupById] Request received for group ${id}`);

    // First, try to get the group without associations to avoid errors
    const group = await Group.findByPk(id);

    if (!group) {
      console.log(`[getGroupById] Group ${id} not found`);
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Try to include associations, but handle errors gracefully
    let groupWithAssociations = group;
    try {
      groupWithAssociations = await Group.findByPk(id, {
        include: [
          { 
            association: 'branch', 
            attributes: ['id', 'name', 'code'], 
            required: false 
          },
          { 
            association: 'members', 
            attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'totalSavings', 'creditScore', 'status', 'role'],
            required: false
          }
        ]
      });
      
      // If members association failed or doesn't exist, fetch them manually
      if (!groupWithAssociations.members || groupWithAssociations.members.length === 0) {
        const members = await User.findAll({
          where: {
            groupId: parseInt(id),
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'totalSavings', 'creditScore', 'status', 'role']
        });
        
        const groupData = groupWithAssociations.toJSON ? groupWithAssociations.toJSON() : groupWithAssociations;
        groupWithAssociations = {
          ...groupData,
          members: members
        };
      }
    } catch (includeError) {
      console.warn('[getGroupById] Error including associations, fetching manually:', includeError.message);
      // If associations fail, fetch members manually
      try {
        const members = await User.findAll({
          where: {
            groupId: parseInt(id),
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'totalSavings', 'creditScore', 'status', 'role']
        });
        
        const groupData = group.toJSON ? group.toJSON() : group;
        groupWithAssociations = {
          ...groupData,
          members: members
        };
      } catch (memberError) {
        console.error('[getGroupById] Error fetching members manually:', memberError.message);
        // If even manual fetch fails, return empty array
        const groupData = group.toJSON ? group.toJSON() : group;
        groupWithAssociations = {
          ...groupData,
          members: []
        };
      }
    }

    // Manually add agent if it exists (since agent association might not be set up)
    if (group.agentId) {
      try {
        const agent = await User.findByPk(group.agentId, {
          attributes: ['id', 'name', 'phone']
        });
        if (agent) {
          groupWithAssociations = {
            ...groupWithAssociations.toJSON(),
            agent: agent
          };
        }
      } catch (agentError) {
        console.warn('[getGroupById] Error fetching agent:', agentError.message);
      }
    }

    // Ensure members is always an array in the response
    const responseData = groupWithAssociations.toJSON ? groupWithAssociations.toJSON() : groupWithAssociations;
    if (!Array.isArray(responseData.members)) {
      responseData.members = [];
    }
    
    console.log(`[getGroupById] Successfully fetched group ${id} with ${responseData.members.length} members`);
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[getGroupById] Error:', error);
    console.error('[getGroupById] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group',
      error: error.message
    });
  }
};

/**
 * Create group (Agent/System Admin)
 * POST /api/groups
 */
const createGroup = async (req, res) => {
  try {
    const { name, code, description, branchId, district, sector, cell, contributionAmount, contributionFrequency } = req.body;

    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Name and code are required'
      });
    }

    // Check if code exists
    const existingGroup = await Group.findOne({ where: { code } });
    if (existingGroup) {
      return res.status(400).json({
        success: false,
        message: 'Group code already exists'
      });
    }

    const group = await Group.create({
      name,
      code,
      description,
      branchId: branchId || req.user.branchId,
      agentId: req.user.role === 'Agent' ? req.user.id : null,
      district,
      sector,
      cell,
      contributionAmount: contributionAmount ? parseFloat(contributionAmount) : null,
      contributionFrequency: contributionFrequency || 'monthly'
    });

    // Log action
    await logAction(req.user.id, 'CREATE_GROUP', 'Group', group.id, {
      groupName: name,
      groupCode: code,
      district,
      sector,
      agentName: req.user.name,
      agentId: req.user.id
    }, req);

    // Always notify system admins when agent creates a group
    if (req.user.role === 'Agent') {
      await notifySystemAdmins(
        'Agent Registered New Group',
        `Agent ${req.user.name} (ID: ${req.user.id}) registered a new group "${name}" (Code: ${code}, ID: ${group.id}) in ${district}, ${sector}.`,
        'agent_action'
      );
    }

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      data: group
    });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create group',
      error: error.message
    });
  }
};

/**
 * Update group (Agent/System Admin)
 * PUT /api/groups/:id
 */
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, district, sector, cell, status, contributionAmount, contributionFrequency, defaultFineAmount, baseInterestRate } = req.body;

    const group = await Group.findByPk(id);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Check if code is being changed and if it's already taken
    if (code && code !== group.code) {
      const existingGroup = await Group.findOne({ where: { code } });
      if (existingGroup) {
        return res.status(400).json({
          success: false,
          message: 'Group code already exists'
        });
      }
    }

    // Check if contributionAmount (saving amount) is being changed
    const oldContributionAmount = parseFloat(group.contributionAmount || 0);
    const newContributionAmount = contributionAmount !== undefined ? (contributionAmount ? parseFloat(contributionAmount) : 0) : oldContributionAmount;
    const isChangingSavingAmount = contributionAmount !== undefined && newContributionAmount !== oldContributionAmount;

    // Check if defaultFineAmount is being raised
    // Note: These fields may not exist in the Group model yet, so we use safe defaults
    const oldFineAmount = parseFloat(500); // Default fine amount
    const newFineAmount = defaultFineAmount !== undefined ? parseFloat(defaultFineAmount) : oldFineAmount;
    const isRaisingFineAmount = defaultFineAmount !== undefined && newFineAmount > oldFineAmount;

    // Check if baseInterestRate is being raised
    const oldInterestRate = parseFloat(5.0); // Default interest rate
    const newInterestRate = baseInterestRate !== undefined ? parseFloat(baseInterestRate) : oldInterestRate;
    const isRaisingInterestRate = baseInterestRate !== undefined && newInterestRate > oldInterestRate;

    // Update allowed fields
    if (name !== undefined) group.name = name;
    if (code !== undefined) group.code = code;
    if (description !== undefined) group.description = description;
    if (district !== undefined) group.district = district;
    if (sector !== undefined) group.sector = sector;
    if (cell !== undefined) group.cell = cell;
    if (status !== undefined) group.status = status;
    if (contributionAmount !== undefined) group.contributionAmount = contributionAmount ? parseFloat(contributionAmount) : null;
    if (contributionFrequency !== undefined) group.contributionFrequency = contributionFrequency;

    // If changing contribution settings, ALWAYS create a vote first (don't save yet)
    // Get additional settings from request body
    const { minimumAmount, maximumAmount, dueDate, lateFee, gracePeriod } = req.body;
    const hasContributionChanges = isChangingSavingAmount || 
      minimumAmount !== undefined || 
      maximumAmount !== undefined || 
      dueDate !== undefined || 
      lateFee !== undefined || 
      gracePeriod !== undefined;

    // ALWAYS create a vote for contribution changes (for Group Admin, Cashier, Secretary)
    if (hasContributionChanges && (req.user.role === 'Group Admin' || req.user.role === 'Cashier' || req.user.role === 'Secretary')) {
      try {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7); // 7 days voting period

        // Build vote title and description
        let changes = [];
        if (isChangingSavingAmount) {
          changes.push(`Minimum Amount: ${oldContributionAmount.toLocaleString()} RWF → ${newContributionAmount.toLocaleString()} RWF`);
        }
        if (minimumAmount !== undefined) {
          changes.push(`Minimum Amount: ${minimumAmount.toLocaleString()} RWF`);
        }
        if (maximumAmount !== undefined) {
          changes.push(`Maximum Amount: ${maximumAmount.toLocaleString()} RWF`);
        }
        if (dueDate !== undefined) {
          changes.push(`Due Date: Day ${dueDate}`);
        }
        if (lateFee !== undefined) {
          changes.push(`Late Fee: ${lateFee.toLocaleString()} RWF`);
        }
        if (gracePeriod !== undefined) {
          changes.push(`Grace Period: ${gracePeriod} days`);
        }

        const voteTitle = `Contribution Settings Change: ${changes.join(', ')}`;
        let voteDescription = `${req.user.role} has proposed to change the contribution settings:\n\n`;
        changes.forEach(change => {
          voteDescription += `• ${change}\n`;
        });
        voteDescription += `\nThis change will affect all members' future contributions. Please vote to approve or reject this proposal.`;

        // Store proposed changes in vote metadata (we'll use description field for now, or add metadata field later)
        const voteData = {
          groupId: group.id,
          title: voteTitle,
          description: voteDescription,
          type: 'contribution_change',
          endDate: endDate.toISOString(),
          options: ['Approve Changes', 'Reject Changes'],
          createdBy: req.user.id
        };

        const vote = await createAutomaticVote(voteData);

        // Store proposed changes in a separate table or in vote description
        // For now, we'll store it in the vote description as JSON at the end
        const proposedChanges = {
          contributionAmount: newContributionAmount,
          minimumAmount: minimumAmount !== undefined ? parseFloat(minimumAmount) : undefined,
          maximumAmount: maximumAmount !== undefined ? parseFloat(maximumAmount) : undefined,
          dueDate: dueDate !== undefined ? parseInt(dueDate) : undefined,
          lateFee: lateFee !== undefined ? parseFloat(lateFee) : undefined,
          gracePeriod: gracePeriod !== undefined ? parseInt(gracePeriod) : undefined
        };

        // Store proposed changes separately in vote description (clean format, no visible metadata)
        // We'll store metadata in a clean way that can be extracted but won't show in UI
        const Vote = require('../models').Vote;
        const cleanDescription = voteDescription; // Keep description clean for display
        await Vote.update(
          { 
            description: cleanDescription,
            // Store metadata in a separate field if available, or use a hidden comment format
            // For now, we'll extract from description pattern later
          },
          { where: { id: vote.id } }
        );
        
        // Store metadata in a way that can be retrieved but won't show in UI
        // We'll use a special format that can be parsed but is hidden
        const metadataString = JSON.stringify(proposedChanges);
        // Update with clean description and store metadata separately in a way that won't display
        await Vote.update(
          { 
            description: cleanDescription + '\n\n[VOTE_METADATA_START]' + metadataString + '[VOTE_METADATA_END]'
          },
          { where: { id: vote.id } }
        );

        console.log(`[updateGroup] Created automatic vote for contribution settings change`);
        
        // Don't save the change yet - wait for vote to complete
        return res.json({
          success: true,
          message: 'A voting proposal has been created for these contribution settings changes. The change will be applied after voting completes.',
          data: group,
          voteCreated: true,
          voteId: vote.id
        });
      } catch (voteError) {
        console.error('[updateGroup] Failed to create automatic vote for contribution settings:', voteError);
        console.error('[updateGroup] Vote error details:', {
          message: voteError.message,
          stack: voteError.stack,
          groupId: group.id
        });
        // Continue with normal update if vote creation fails
      }
    }

    // If raising fine amount, create a vote
    if (isRaisingFineAmount && (req.user.role === 'Group Admin' || req.user.role === 'Cashier' || req.user.role === 'Secretary')) {
      try {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7);

        const voteTitle = `Increase Fine Amount: ${oldFineAmount.toLocaleString()} RWF → ${newFineAmount.toLocaleString()} RWF`;
        let voteDescription = `${req.user.role} has proposed to increase the default fine amount from ${oldFineAmount.toLocaleString()} RWF to ${newFineAmount.toLocaleString()} RWF.\n\n`;
        voteDescription += `This change will affect future fine calculations. Please vote to approve or reject this proposal.`;

        await createAutomaticVote({
          groupId: group.id,
          title: voteTitle,
          description: voteDescription,
          type: 'fine_amount_change',
          endDate: endDate.toISOString(),
          options: ['Approve Increase', 'Reject Increase'],
          createdBy: req.user.id
        });

        console.log(`[updateGroup] Created automatic vote for fine amount increase from ${oldFineAmount} to ${newFineAmount}`);
        
        return res.json({
          success: true,
          message: 'A voting proposal has been created for this fine amount increase. The change will be applied after voting completes.',
          data: group,
          voteCreated: true
        });
      } catch (voteError) {
        console.error('[updateGroup] Failed to create automatic vote for fine amount:', voteError);
        console.error('[updateGroup] Vote error details:', {
          message: voteError.message,
          stack: voteError.stack,
          groupId: group.id
        });
        // Continue with normal update if vote creation fails
      }
    }

    // If raising interest rate, create a vote
    if (isRaisingInterestRate && (req.user.role === 'Group Admin' || req.user.role === 'Cashier' || req.user.role === 'Secretary')) {
      try {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7);

        const voteTitle = `Increase Loan Interest Rate: ${oldInterestRate}% → ${newInterestRate}%`;
        let voteDescription = `${req.user.role} has proposed to increase the base loan interest rate from ${oldInterestRate}% to ${newInterestRate}%.\n\n`;
        voteDescription += `This change will affect all future loan calculations. Please vote to approve or reject this proposal.`;

        await createAutomaticVote({
          groupId: group.id,
          title: voteTitle,
          description: voteDescription,
          type: 'interest_rate_change',
          endDate: endDate.toISOString(),
          options: ['Approve Increase', 'Reject Increase'],
          createdBy: req.user.id
        });

        console.log(`[updateGroup] Created automatic vote for interest rate increase from ${oldInterestRate}% to ${newInterestRate}%`);
        
        return res.json({
          success: true,
          message: 'A voting proposal has been created for this interest rate increase. The change will be applied after voting completes.',
          data: group,
          voteCreated: true
        });
      } catch (voteError) {
        console.error('[updateGroup] Failed to create automatic vote for interest rate:', voteError);
        console.error('[updateGroup] Vote error details:', {
          message: voteError.message,
          stack: voteError.stack,
          groupId: group.id
        });
        // Continue with normal update if vote creation fails
      }
    }

    // Track old status before saving (for status change notifications)
    const oldStatus = group.status;
    
    // Save changes to database
    await group.save();
    
    // Track changes for logging
    const changes = [];
    if (name !== undefined && name !== group.name) changes.push(`Name: ${group.name} → ${name}`);
    if (code !== undefined && code !== group.code) changes.push(`Code: ${group.code} → ${code}`);
    if (status !== undefined && status !== oldStatus) {
      changes.push(`Status: ${oldStatus} → ${status}`);
      // Status changes are important - log them separately
      await logAction(req.user.id, status === 'active' ? 'ACTIVATE_GROUP' : status === 'inactive' ? 'DEACTIVATE_GROUP' : 'UPDATE_GROUP_STATUS', 'Group', group.id, {
        groupName: group.name,
        groupId: group.id,
        oldStatus: oldStatus,
        newStatus: status,
        agentName: req.user.name,
        agentId: req.user.id,
        originalAgentId: group.agentId,
        isOwnGroup: group.agentId === req.user.id
      }, req);
      
      // Notify system admins about status changes
      if (req.user.role === 'Agent') {
        const groupOwnershipNote = group.agentId === req.user.id 
          ? ' (their own registered group)' 
          : ` (group originally registered by Agent ID: ${group.agentId})`;
        const statusAction = status === 'active' ? 'activated' : status === 'inactive' ? 'deactivated' : `changed status to ${status}`;
        
        await notifySystemAdmins(
          `Agent ${statusAction.charAt(0).toUpperCase() + statusAction.slice(1)} Group`,
          `Agent ${req.user.name} (ID: ${req.user.id}) ${statusAction} group "${group.name}" (ID: ${group.id})${groupOwnershipNote}. Previous status: ${oldStatus}.`,
          'agent_action'
        );
      }
    }
    if (district !== undefined && district !== group.district) changes.push(`District: ${group.district || 'N/A'} → ${district}`);
    if (sector !== undefined && sector !== group.sector) changes.push(`Sector: ${group.sector || 'N/A'} → ${sector}`);

    // Log action for other changes (non-status)
    if (changes.length > 0) {
      await logAction(req.user.id, 'UPDATE_GROUP', 'Group', group.id, {
        groupName: group.name,
        groupId: group.id,
        changes,
        agentName: req.user.name,
        agentId: req.user.id,
        originalAgentId: group.agentId,
        isOwnGroup: group.agentId === req.user.id
      }, req);

      // Always notify system admins when agent updates any group (for non-status changes)
      if (req.user.role === 'Agent' && (!status || status === oldStatus)) {
        const groupOwnershipNote = group.agentId === req.user.id 
          ? ' (their own registered group)' 
          : ` (group originally registered by Agent ID: ${group.agentId})`;
        
        await notifySystemAdmins(
          'Agent Updated Group',
          `Agent ${req.user.name} (ID: ${req.user.id}) updated group "${group.name}" (ID: ${group.id})${groupOwnershipNote}. Changes: ${changes.join(', ')}.`,
          'agent_action'
        );
      }
    }
    
    console.log(`[updateGroup] Group ${group.id} updated successfully. Changes saved to database.`);

    res.json({
      success: true,
      message: 'Group updated successfully',
      data: group
    });
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update group',
      error: error.message
    });
  }
};

/**
 * Get group statistics
 * GET /api/groups/:id/stats
 */
const getGroupStats = async (req, res) => {
  try {
    const { id } = req.params;

    const group = await Group.findByPk(id);

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Count ALL active users in the group (including members and leaders)
    // Use try-catch to handle potential database errors
    let totalMembers = 0;
    try {
      totalMembers = await User.count({ 
        where: { 
          groupId: parseInt(id), 
          status: 'active'
        } 
      });
    } catch (userCountError) {
      console.error('[getGroupStats] Error counting users:', userCountError);
      // Continue with 0 if count fails
    }
    
    // Count active loans for this group
    let activeLoans = 0;
    try {
      activeLoans = await Loan.count({
        where: {
          groupId: parseInt(id),
          status: { [Op.in]: ['approved', 'disbursed', 'active'] }
        }
      });
    } catch (loanCountError) {
      console.error('[getGroupStats] Error counting loans:', loanCountError);
      // Continue with 0 if count fails
    }
    
    // Count pending member applications for this group
    let pendingApprovals = 0;
    try {
      pendingApprovals = await MemberApplication.count({
        where: { 
          groupId: parseInt(id), 
          status: 'pending' 
        }
      });
    } catch (appCountError) {
      console.error('[getGroupStats] Error counting applications:', appCountError);
      // Continue with 0 if count fails
    }
    
    // Calculate total savings from Users table (sum all members' totalSavings) AND contributions
    // This gives the REAL total amount from the database
    let totalSavings = 0;
    try {
      // Method 1: Sum totalSavings from Users table for all active members in the group
      const usersTotalSavings = await User.sum('totalSavings', {
        where: {
          groupId: parseInt(id),
          status: 'active',
          role: { [Op.in]: ['Member', 'Secretary', 'Cashier'] } // Only count actual members, not Group Admin
        }
      });
      const usersSavings = parseFloat(usersTotalSavings || 0);
      
      // Method 2: Sum approved contributions from Contributions table
      const contributionsSum = await Contribution.sum('amount', {
        where: {
          groupId: parseInt(id),
          status: 'approved'
        }
      });
      const contributionsSavings = parseFloat(contributionsSum || 0);
      
      // Use the higher value or sum both (depending on what's more accurate)
      // For now, use Users table totalSavings as primary source (it's updated when contributions are made)
      // If Users table is 0 but contributions exist, use contributions
      if (usersSavings > 0) {
        totalSavings = usersSavings;
        console.log(`[getGroupStats] Using totalSavings from Users table: ${totalSavings} RWF for groupId: ${id}`);
      } else if (contributionsSavings > 0) {
        totalSavings = contributionsSavings;
        console.log(`[getGroupStats] Using totalSavings from Contributions table: ${totalSavings} RWF for groupId: ${id}`);
      } else {
        totalSavings = 0;
      }
      
      // Log both values for verification
      console.log(`[getGroupStats] Total savings calculation for groupId ${id}:`, {
        fromUsersTable: usersSavings,
        fromContributions: contributionsSavings,
        finalTotalSavings: totalSavings
      });
      
    } catch (savingsError) {
      console.error('[getGroupStats] Error calculating savings:', savingsError);
      totalSavings = 0;
    }
    
    // Ensure totalSavings is a valid number
    if (isNaN(totalSavings)) {
      totalSavings = 0;
    }

    // Log the stats for debugging
    console.log(`[getGroupStats] Group ${id} stats:`, {
      totalMembers,
      activeLoans,
      pendingApprovals,
      totalSavings
    });

    res.json({
      success: true,
      data: {
        totalMembers: Number(totalMembers) || 0,
        activeLoans: Number(activeLoans) || 0,
        pendingApprovals: Number(pendingApprovals) || 0,
        totalSavings: Number(totalSavings) || 0
      }
    });
  } catch (error) {
    console.error('Get group stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group statistics',
      error: error.message
    });
  }
};

/**
 * Get comprehensive group data for member view
 * GET /api/groups/my-group/data
 * Returns: group info, leaders, members, financials
 */
const getMyGroupData = async (req, res) => {
  try {
    console.log('[getMyGroupData] Request received');
    const userId = req.user.id;
    console.log('[getMyGroupData] User ID:', userId);
    const user = await User.findByPk(userId);

    if (!user || !user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }

    const groupId = user.groupId;

    // Fetch group information
    const group = await Group.findByPk(groupId, {
      include: [
        { 
          association: 'branch', 
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ]
    });

    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Fetch all users in the group
    const allGroupUsers = await User.findAll({
      where: { groupId, status: 'active' },
      attributes: ['id', 'name', 'email', 'phone', 'role', 'status', 'totalSavings', 'creditScore', 'createdAt']
    });

    // Separate leaders (must be active)
    const leaders = {
      admin: null,
      cashier: null,
      secretary: null
    };

    const members = [];

    allGroupUsers.forEach(user => {
      const role = user.role;
      if (role === 'Group Admin' && user.status === 'active') {
        leaders.admin = {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone
        };
      } else if (role === 'Cashier' && user.status === 'active') {
        leaders.cashier = {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone
        };
      } else if (role === 'Secretary' && user.status === 'active') {
        leaders.secretary = {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone
        };
      } else if (role === 'Member') {
        members.push({
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          status: user.status,
          totalSavings: parseFloat(user.totalSavings || 0),
          creditScore: user.creditScore || 0,
          joinedDate: user.createdAt
        });
      }
    });

    // Calculate financial overview
    // Total Savings (from group.totalSavings or sum of approved contributions)
    let totalSavings = 0;
    try {
      totalSavings = parseFloat(group.totalSavings || 0);
      if (isNaN(totalSavings)) totalSavings = 0;
    } catch (e) {
      console.warn('[getMyGroupData] Error parsing totalSavings:', e);
      totalSavings = 0;
    }

    // Active Loans (sum of active loan amounts)
    let activeLoans = 0;
    try {
      const activeLoansData = await Loan.findAll({
        where: {
          groupId,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] }
        },
        attributes: ['amount']
      });
      activeLoans = activeLoansData.reduce((sum, loan) => {
        const amount = parseFloat(loan.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
    } catch (e) {
      console.warn('[getMyGroupData] Error calculating active loans:', e);
      activeLoans = 0;
    }

    // Monthly Contributions (current month)
    let monthlyContributions = 0;
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthlyContributionsData = await Contribution.findAll({
        where: {
          groupId,
          status: 'approved',
          createdAt: { [Op.gte]: startOfMonth }
        },
        attributes: ['amount']
      });
      monthlyContributions = monthlyContributionsData.reduce((sum, contrib) => {
        const amount = parseFloat(contrib.amount || 0);
        return sum + (isNaN(amount) ? 0 : amount);
      }, 0);
    } catch (e) {
      console.warn('[getMyGroupData] Error calculating monthly contributions:', e);
      monthlyContributions = 0;
    }

    // Format location
    const locationParts = [group.district, group.sector, group.cell].filter(Boolean);
    const location = locationParts.length > 0 ? locationParts.join(', ') : 'Not specified';

    // Format contribution day
    let contributionDay = 'Not specified';
    if (group.contributionFrequency) {
      if (group.contributionFrequency === 'monthly') {
        contributionDay = '1st of every month';
      } else if (group.contributionFrequency === 'weekly') {
        contributionDay = 'Every week';
      } else {
        contributionDay = group.contributionFrequency;
      }
    }

    // Ensure all values are safe for JSON
    const response = {
      success: true,
      data: {
        groupInfo: {
          id: Number(group.id) || 0,
          name: String(group.name || ''),
          code: String(group.code || ''),
          establishedDate: group.createdAt ? new Date(group.createdAt).toISOString().split('T')[0] : null,
          location: String(location || 'Not specified'),
          contributionDay: String(contributionDay || 'Not specified'),
          contributionAmount: group.contributionAmount ? `${Number(group.contributionAmount).toLocaleString()} RWF` : 'Not specified',
          description: group.description ? String(group.description) : null
        },
        leaders: {
          admin: leaders.admin ? {
            id: Number(leaders.admin.id),
            name: String(leaders.admin.name || ''),
            email: String(leaders.admin.email || ''),
            phone: String(leaders.admin.phone || '')
          } : null,
          cashier: leaders.cashier ? {
            id: Number(leaders.cashier.id),
            name: String(leaders.cashier.name || ''),
            email: String(leaders.cashier.email || ''),
            phone: String(leaders.cashier.phone || '')
          } : null,
          secretary: leaders.secretary ? {
            id: Number(leaders.secretary.id),
            name: String(leaders.secretary.name || ''),
            email: String(leaders.secretary.email || ''),
            phone: String(leaders.secretary.phone || '')
          } : null
        },
        members: members.map(m => ({
          id: Number(m.id),
          name: String(m.name || ''),
          email: String(m.email || ''),
          phone: String(m.phone || ''),
          role: String(m.role || 'Member'),
          status: String(m.status || 'active'),
          totalSavings: Number(m.totalSavings) || 0,
          creditScore: Number(m.creditScore) || 0,
          joinedDate: m.joinedDate ? new Date(m.joinedDate).toISOString() : null
        })),
        totalMembers: Number(allGroupUsers.length) || 0,
        financials: {
          totalSavings: Number(totalSavings) || 0,
          activeLoans: Number(activeLoans) || 0,
          monthlyContributions: Number(monthlyContributions) || 0
        }
      }
    };

    console.log('[getMyGroupData] Response prepared successfully');
    res.json(response);
  } catch (error) {
    console.error('[getMyGroupData] Error:', error);
    console.error('[getMyGroupData] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group data',
      error: error.message,
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
};

/**
 * Get recent activities for a group
 * GET /api/groups/:id/activities
 * Returns comprehensive activity feed including contributions, loans, announcements, etc.
 */
const getGroupActivities = async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 50 } = req.query;
    const groupId = parseInt(id);

    if (isNaN(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid group ID'
      });
    }

    // Verify user has access to this group
    const user = req.user;
    if (user.role === 'Group Admin' && user.groupId !== groupId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this group'
      });
    }

    const activities = [];

    // 1. Get recent contributions with member info (ALL contributions, not just approved)
    const contributions = await Contribution.findAll({
      where: {
        groupId: groupId
      },
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    console.log(`[getGroupActivities] Found ${contributions.length} contributions for group ${groupId}`);
    if (contributions.length > 0) {
      console.log(`[getGroupActivities] Sample contribution:`, {
        id: contributions[0].id,
        memberId: contributions[0].memberId,
        memberName: contributions[0].member?.name,
        amount: contributions[0].amount,
        status: contributions[0].status,
        createdAt: contributions[0].createdAt
      });
    }

    contributions.forEach(contrib => {
      const status = contrib.status === 'approved' ? 'completed' : contrib.status || 'pending';
      activities.push({
        id: `contrib-${contrib.id}`,
        type: 'contribution',
        title: `${contrib.member?.name || 'Member'} made a contribution`,
        description: `Amount: RWF ${Number(contrib.amount || 0).toLocaleString()}${contrib.status ? ` | Status: ${contrib.status}` : ''}`,
        paymentMethod: contrib.paymentMethod || 'cash',
        amount: contrib.amount,
        memberName: contrib.member?.name || 'Unknown',
        memberId: contrib.memberId,
        receiptNumber: contrib.receiptNumber,
        time: contrib.createdAt,
        status: status,
        icon: 'contribution'
      });
    });

    // 2. Get loan approvals/rejections
    const loans = await Loan.findAll({
      where: {
        groupId: groupId
      },
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['updatedAt', 'DESC']],
      limit: parseInt(limit)
    });

    loans.forEach(loan => {
      if (loan.status === 'approved') {
        activities.push({
          id: `loan-approved-${loan.id}`,
          type: 'loan',
          title: `Loan approved for ${loan.member?.name || 'Member'}`,
          description: `Amount: RWF ${Number(loan.amount || 0).toLocaleString()} | Purpose: ${loan.purpose || 'N/A'}`,
          amount: loan.amount,
          memberName: loan.member?.name || 'Unknown',
          memberId: loan.memberId,
          loanId: loan.id,
          time: loan.updatedAt || loan.createdAt,
          status: 'completed',
          icon: 'loan'
        });
      } else if (loan.status === 'rejected') {
        activities.push({
          id: `loan-rejected-${loan.id}`,
          type: 'loan',
          title: `Loan rejected for ${loan.member?.name || 'Member'}`,
          description: `Amount: RWF ${Number(loan.amount || 0).toLocaleString()} | Reason: ${loan.rejectionReason || 'Not specified'}`,
          amount: loan.amount,
          memberName: loan.member?.name || 'Unknown',
          memberId: loan.memberId,
          loanId: loan.id,
          time: loan.updatedAt || loan.createdAt,
          status: 'rejected',
          icon: 'loan'
        });
      }
    });

    // 3. Get announcements
    const { Announcement } = require('../models');
    const announcements = await Announcement.findAll({
      where: {
        groupId: groupId
      },
      include: [
        { 
          model: User, 
          as: 'creator', 
          foreignKey: 'createdBy',
          attributes: ['id', 'name'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    announcements.forEach(announcement => {
      activities.push({
        id: `announcement-${announcement.id}`,
        type: 'announcement',
        title: `Announcement: ${announcement.title}`,
        description: announcement.content || announcement.title,
        createdBy: announcement.creator?.name || 'Group Admin',
        priority: announcement.priority,
        status: announcement.status,
        time: announcement.createdAt,
        icon: 'announcement'
      });
    });

    // 4. Get member application approvals/rejections
    const memberApplications = await MemberApplication.findAll({
      where: {
        groupId: groupId,
        status: { [Op.in]: ['approved', 'rejected'] }
      },
      include: [
        { 
          model: User, 
          as: 'user', 
          foreignKey: 'userId',
          attributes: ['id', 'name', 'phone'],
          required: false
        }
      ],
      order: [['reviewDate', 'DESC']],
      limit: parseInt(limit)
    });

    // Get reviewedBy user names separately if needed
    const reviewedByUserIds = memberApplications
      .filter(app => app.reviewedBy)
      .map(app => app.reviewedBy)
      .filter((id, index, self) => self.indexOf(id) === index)
    
    const reviewedByUsers = reviewedByUserIds.length > 0 
      ? await User.findAll({
          where: { id: { [Op.in]: reviewedByUserIds } },
          attributes: ['id', 'name']
        })
      : []

    memberApplications.forEach(app => {
      const reviewedByUser = reviewedByUsers.find(u => u.id === app.reviewedBy)
      activities.push({
        id: `application-${app.status}-${app.id}`,
        type: 'application',
        title: `Member application ${app.status}: ${app.user?.name || 'Applicant'}`,
        description: app.status === 'approved' 
          ? `${app.user?.name || 'Applicant'} was approved to join the group`
          : `${app.user?.name || 'Applicant'} application was rejected${app.rejectionReason ? ` - ${app.rejectionReason}` : ''}`,
        memberName: app.user?.name || 'Unknown',
        reviewedBy: reviewedByUser?.name || 'Group Admin',
        status: app.status,
        time: app.reviewDate || app.updatedAt,
        icon: 'application'
      });
    });

    // 5. Get audit logs for other admin actions
    const { AuditLog } = require('../models');
    const loanIds = loans.map(l => l.id)
    const contribIds = contributions.map(c => c.id)
    const appIds = memberApplications.map(a => a.id)
    
    // Build OR conditions for audit logs
    const auditConditions = [
      { entityType: 'Group', entityId: groupId }
    ]
    
    if (loanIds.length > 0) {
      auditConditions.push({ entityType: 'Loan', entityId: { [Op.in]: loanIds } })
    }
    if (contribIds.length > 0) {
      auditConditions.push({ entityType: 'Contribution', entityId: { [Op.in]: contribIds } })
    }
    if (appIds.length > 0) {
      auditConditions.push({ entityType: 'MemberApplication', entityId: { [Op.in]: appIds } })
    }
    
    const auditLogs = auditConditions.length > 0 ? await AuditLog.findAll({
      where: {
        [Op.or]: auditConditions,
        action: { 
          [Op.notLike]: '%CONTRIBUTION_SUBMITTED%' // Exclude contribution submissions as we handle them above
        }
      },
      include: [
        { 
          model: User, 
          as: 'user', 
          foreignKey: 'userId',
          attributes: ['id', 'name', 'role'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    }) : []

    auditLogs.forEach(log => {
      // Only add if not already covered by other activities
      const action = log.action || '';
      if (!action.includes('CONTRIBUTION_SUBMITTED')) {
        activities.push({
          id: `audit-${log.id}`,
          type: 'admin_action',
          title: `${log.user?.name || 'System'} - ${action.replace(/_/g, ' ')}`,
          description: log.details ? JSON.stringify(log.details) : action,
          actionBy: log.user?.name || 'System',
          action: action,
          time: log.createdAt,
          status: action.includes('APPROVE') ? 'completed' : action.includes('REJECT') ? 'rejected' : 'pending',
          icon: 'admin'
        });
      }
    });

    // Sort all activities by time (most recent first)
    activities.sort((a, b) => {
      const timeA = new Date(a.time || 0).getTime();
      const timeB = new Date(b.time || 0).getTime();
      return timeB - timeA;
    });

    // Limit to requested number
    const limitedActivities = activities.slice(0, parseInt(limit));

    console.log(`[getGroupActivities] Returning ${limitedActivities.length} activities for group ${groupId}`);

    res.json({
      success: true,
      data: limitedActivities
    });
  } catch (error) {
    console.error('Get group activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group activities',
      error: error.message
    });
  }
};

/**
 * Get all members for guarantor selection
 * GET /api/groups/:id/members
 * Returns all active members in the group (for guarantor selection)
 */
const getGroupMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { search } = req.query;
    const currentUserId = req.user.id;
    const currentUser = req.user;

    console.log(`[getGroupMembers] Request received for group ${id} by user ${currentUserId}`);

    // Verify the user exists
    if (!currentUser) {
      console.error(`[getGroupMembers] Current user ${currentUserId} not found`);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const groupIdInt = parseInt(id);
    
    // Allow Agents and System Admins to view members from any group
    // Regular users can only view members from their own group
    if (currentUser.role !== 'Agent' && currentUser.role !== 'System Admin') {
      if (currentUser.groupId !== groupIdInt) {
        console.warn(`[getGroupMembers] User ${currentUserId} (groupId: ${currentUser.groupId}) tried to access group ${groupIdInt}`);
        return res.status(403).json({
          success: false,
          message: 'You can only view members from your own group'
        });
      }
    }

    // Build where clause
    let whereClause = {
      groupId: groupIdInt
    };

    // For guarantor selection, only show active Members (original behavior)
    // For agent transfer, show all roles and statuses
    if (req.query.allMembers === 'true') {
      // Show all members (all roles and statuses) for transfer functionality
      // No role/status filter
    } else {
      // Original behavior: only active Members (for guarantor selection)
      whereClause.role = 'Member';
      whereClause.status = 'active';
    }

    // Add search functionality
    if (search && search.trim()) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search.trim()}%` } },
        { phone: { [Op.like]: `%${search.trim()}%` } },
        { email: { [Op.like]: `%${search.trim()}%` } },
        { nationalId: { [Op.like]: `%${search.trim()}%` } }
      ];
    }

    // Fetch members from the group
    const allMembers = await User.findAll({
      where: whereClause,
      attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'status', 'role'],
      order: [['name', 'ASC']]
    });

    console.log(`[getGroupMembers] Found ${allMembers.length} members in group ${groupIdInt}`);

    // For guarantor selection, filter out the current user
    // For transfer, include all members
    const eligibleMembers = req.query.allMembers === 'true'
      ? allMembers.map(m => ({
          id: m.id,
          name: m.name || '',
          phone: m.phone || '',
          nationalId: m.nationalId || '',
          email: m.email || '',
          role: m.role || 'Member',
          status: m.status || 'active'
        }))
      : allMembers
          .filter(m => m.id !== currentUserId)
          .map(m => ({
            id: m.id,
            name: m.name || '',
            phone: m.phone || '',
            nationalId: m.nationalId || '',
            email: m.email || ''
          }));

    console.log(`[getGroupMembers] Returning ${eligibleMembers.length} eligible members for group ${id}`);

    res.json({
      success: true,
      data: eligibleMembers,
      count: eligibleMembers.length
    });
  } catch (error) {
    console.error('[getGroupMembers] Error:', error);
    console.error('[getGroupMembers] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group members',
      error: error.message
    });
  }
};

/**
 * Merge two groups
 * POST /api/groups/:id/merge
 * Body: { targetGroupId: number }
 */
const mergeGroups = async (req, res) => {
  try {
    const { id } = req.params; // Source group ID
    const { targetGroupId } = req.body;

    if (!targetGroupId) {
      return res.status(400).json({
        success: false,
        message: 'Target group ID is required'
      });
    }

    const sourceGroupId = parseInt(id);
    const targetGroupIdInt = parseInt(targetGroupId);

    if (sourceGroupId === targetGroupIdInt) {
      return res.status(400).json({
        success: false,
        message: 'Cannot merge a group with itself'
      });
    }

    // Verify both groups exist
    const sourceGroup = await Group.findByPk(sourceGroupId);
    const targetGroup = await Group.findByPk(targetGroupIdInt);

    if (!sourceGroup) {
      return res.status(404).json({
        success: false,
        message: 'Source group not found'
      });
    }

    if (!targetGroup) {
      return res.status(404).json({
        success: false,
        message: 'Target group not found'
      });
    }

    // Check permissions - only Agent or System Admin can merge groups
    const user = req.user;
    if (user.role !== 'Agent' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Agents and System Admins can merge groups'
      });
    }

    // Start transaction to merge groups
    const transaction = await Group.sequelize.transaction();

    try {
      // Move all members from source group to target group
      const membersMoved = await User.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all contributions from source group to target group
      await Contribution.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all loans from source group to target group
      await Loan.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all announcements from source group to target group
      const { Announcement } = require('../models');
      await Announcement.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all meetings from source group to target group
      const { Meeting } = require('../models');
      await Meeting.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all votes from source group to target group
      const { Vote } = require('../models');
      await Vote.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all chat messages from source group to target group
      const { ChatMessage } = require('../models');
      await ChatMessage.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Move all member applications from source group to target group
      await MemberApplication.update(
        { groupId: targetGroupIdInt },
        {
          where: { groupId: sourceGroupId },
          transaction
        }
      );

      // Update target group's total savings (add source group's savings)
      const sourceSavings = parseFloat(sourceGroup.totalSavings || 0);
      const targetSavings = parseFloat(targetGroup.totalSavings || 0);
      targetGroup.totalSavings = sourceSavings + targetSavings;
      await targetGroup.save({ transaction });

      // Deactivate source group (don't delete to maintain audit trail)
      sourceGroup.status = 'inactive';
      sourceGroup.description = (sourceGroup.description || '') + `\n\n[MERGED] This group was merged into group ${targetGroup.name} (ID: ${targetGroupIdInt}) on ${new Date().toISOString()}`;
      await sourceGroup.save({ transaction });

      // Commit transaction
      await transaction.commit();

      console.log(`[mergeGroups] Successfully merged group ${sourceGroupId} into ${targetGroupIdInt}`);

      res.json({
        success: true,
        message: `Group "${sourceGroup.name}" has been successfully merged into "${targetGroup.name}"`,
        data: {
          sourceGroup: {
            id: sourceGroup.id,
            name: sourceGroup.name,
            status: sourceGroup.status
          },
          targetGroup: {
            id: targetGroup.id,
            name: targetGroup.name,
            totalSavings: targetGroup.totalSavings
          },
          membersMoved: membersMoved[0] || 0
        }
      });
    } catch (mergeError) {
      // Rollback transaction on error
      await transaction.rollback();
      throw mergeError;
    }
  } catch (error) {
    console.error('Merge groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to merge groups',
      error: error.message
    });
  }
};

/**
 * Get comprehensive group overview and performance data
 * GET /api/groups/:id/overview
 * Query params: timeRange (daily, weekly, monthly, quarterly)
 */
const getGroupOverview = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeRange = 'monthly' } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log('[getGroupOverview] Request received:', { id, timeRange, userId, userRole });

    // Get fresh user data from database to ensure we have groupId
    const user = await User.findByPk(userId, {
      attributes: ['id', 'role', 'groupId']
    });

    if (!user) {
      console.error('[getGroupOverview] User not found:', userId);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Always use user's groupId (ignore id parameter for Cashier/Group Admin/Secretary)
    const groupId = (id && (userRole === 'System Admin' || userRole === 'Agent')) ? parseInt(id) : user.groupId;

    if (!groupId) {
      console.error('[getGroupOverview] User does not belong to a group:', userId);
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }

    console.log('[getGroupOverview] Using groupId:', groupId);

    // Verify user has access to this group
    if (['Cashier', 'Group Admin', 'Secretary'].includes(userRole) && user.groupId !== groupId) {
      console.error('[getGroupOverview] Access denied - groupId mismatch:', { userGroupId: user.groupId, requestedGroupId: groupId });
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own group.'
      });
    }

    const group = await Group.findByPk(groupId);
    if (!group) {
      console.error('[getGroupOverview] Group not found:', groupId);
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    console.log('[getGroupOverview] Group found:', group.name, 'groupId:', groupId, 'group.totalSavings:', group.totalSavings);
    
    // DEBUG: Test queries to verify data exists
    try {
      const testMembers = await User.count({ where: { groupId: groupId } });
      const testContributions = await Contribution.count({ where: { groupId: groupId, status: 'approved' } });
      const testFines = await Fine.count({ where: { groupId: groupId } });
      console.log('[getGroupOverview] DEBUG - Data exists check:', {
        groupId: groupId,
        membersCount: testMembers,
        contributionsCount: testContributions,
        finesCount: testFines,
        groupTotalSavings: group.totalSavings
      });
    } catch (debugError) {
      console.error('[getGroupOverview] DEBUG query error:', debugError);
    }

    // Calculate date range based on timeRange
    const now = new Date();
    let startDate, endDate;
    
    switch (timeRange) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 7);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'quarterly':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    // Get all group members - THIS IS CRITICAL - always fetch members
    let allMembers = [];
    try {
      // First, try a count query to verify groupId works
      const memberCount = await User.count({ where: { groupId: groupId } });
      console.log('[getGroupOverview] Member count query result:', memberCount, 'for groupId:', groupId, 'type:', typeof groupId);
      
      allMembers = await User.findAll({
        where: { groupId: groupId },
        attributes: ['id', 'name', 'phone', 'email', 'status', 'totalSavings', 'role']
      });
      console.log('[getGroupOverview] Found members:', allMembers.length, 'for groupId:', groupId);
      
      // Log member details for debugging
      if (allMembers.length > 0) {
        console.log('[getGroupOverview] Sample members:', allMembers.slice(0, 3).map(m => ({
          id: m.id,
          name: m.name,
          status: m.status,
          role: m.role,
          groupId: m.groupId
        })));
      } else {
        console.warn('[getGroupOverview] WARNING: No members found for groupId:', groupId, 'but count query returned:', memberCount);
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching members:', error);
      console.error('[getGroupOverview] Error stack:', error.stack);
      // Return error but still try to continue with empty members array
    }

    const totalMembers = allMembers.length || 0;
    const activeMembers = allMembers.filter(m => m.status === 'active').length || 0;
    const suspendedMembers = allMembers.filter(m => m.status === 'suspended').length || 0;
    
    console.log('[getGroupOverview] Member counts for groupId', groupId, ':', {
      totalMembers,
      activeMembers,
      suspendedMembers,
      allStatuses: allMembers.map(m => m.status)
    });

    // Get defaulters (members with overdue loans)
    let overdueLoans = [];
    try {
      overdueLoans = await Loan.findAll({
        where: {
          groupId: groupId,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] },
          nextPaymentDate: { [Op.lt]: now }
        },
        attributes: ['memberId'],
        group: ['memberId']
      });
    } catch (error) {
      console.error('Error fetching overdue loans:', error);
    }
    const defaulterIds = [...new Set(overdueLoans.map(l => l.memberId))];
    const defaulters = defaulterIds.length;

    // Calculate total savings from Users table (sum all members' totalSavings) AND contributions
    // This gives the REAL total amount from the database
    let totalSavings = 0;
    try {
      // Method 1: Sum totalSavings from Users table for all active members in the group
      const usersTotalSavings = await User.sum('totalSavings', {
        where: {
          groupId: groupId,
          status: 'active',
          role: { [Op.in]: ['Member', 'Secretary', 'Cashier'] } // Only count actual members, not Group Admin
        }
      });
      const usersSavings = parseFloat(usersTotalSavings || 0);
      
      // Method 2: Sum approved contributions from Contributions table
      const contribSumResult = await Contribution.sum('amount', {
        where: {
          groupId: groupId,
          status: 'approved'
        }
      });
      const contributionsSavings = parseFloat(contribSumResult || 0);
      
      // Use the higher value or sum both (depending on what's more accurate)
      // For now, use Users table totalSavings as primary source (it's updated when contributions are made)
      // If Users table is 0 but contributions exist, use contributions
      if (usersSavings > 0) {
        totalSavings = usersSavings;
        console.log('[getGroupOverview] Using totalSavings from Users table:', totalSavings, 'RWF');
      } else if (contributionsSavings > 0) {
        totalSavings = contributionsSavings;
        console.log('[getGroupOverview] Using totalSavings from Contributions table:', totalSavings, 'RWF');
      } else {
        totalSavings = 0;
      }
      
      // Log both values for verification
      console.log('[getGroupOverview] Total savings calculation:', {
        fromUsersTable: usersSavings,
        fromContributions: contributionsSavings,
        finalTotalSavings: totalSavings,
        groupId: groupId
      });
      
      // If calculation returns NaN or null, set to 0
      if (isNaN(totalSavings)) {
        totalSavings = 0;
      }
    } catch (error) {
      console.error('[getGroupOverview] Error calculating savings:', error);
      console.error('[getGroupOverview] Error stack:', error.stack);
      totalSavings = 0;
    }
    
    // Ensure totalSavings is a valid number
    if (isNaN(totalSavings)) {
      totalSavings = 0;
    }
    
    console.log('[getGroupOverview] Final total savings (from contributions):', totalSavings, 'RWF for groupId:', groupId);

    // Get outstanding loans (sum of remaining balance for active loans)
    let outstandingLoans = 0;
    try {
      const outstandingLoansSum = await Loan.sum('remainingBalance', {
        where: {
          groupId: groupId,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] }
        }
      });
      outstandingLoans = parseFloat(outstandingLoansSum || 0);
      console.log('[getGroupOverview] Outstanding loans:', outstandingLoans);
    } catch (error) {
      console.error('[getGroupOverview] Error fetching outstanding loans:', error);
    }

    // Get total loans amount
    let totalLoans = 0;
    try {
      const totalLoansSum = await Loan.sum('amount', {
        where: {
          groupId: groupId,
          status: { [Op.in]: ['approved', 'disbursed', 'active', 'completed'] }
        }
      });
      totalLoans = parseFloat(totalLoansSum || 0);
      console.log('[getGroupOverview] Total loans:', totalLoans);
    } catch (error) {
      console.error('[getGroupOverview] Error fetching total loans:', error);
    }

    // Get contributions within time range
    let contributions = 0;
    try {
      // First check if there are any approved contributions for this group
      const contribCheck = await Contribution.count({
        where: {
          groupId: groupId,
          status: 'approved'
        }
      });
      console.log('[getGroupOverview] Total approved contributions for group:', contribCheck);
      
      if (contribCheck > 0) {
        // Try date-filtered first
        const contributionsSum = await Contribution.sum('amount', {
          where: {
            groupId: groupId,
            status: 'approved',
            createdAt: { [Op.between]: [startDate, endDate] }
          }
        });
        contributions = parseFloat(contributionsSum || 0);
        console.log('[getGroupOverview] Contributions (date-filtered):', contributions, 'groupId:', groupId, 'dateRange:', startDate.toISOString(), 'to', endDate.toISOString());
        
        // If no contributions in date range, try all-time as fallback
        if (contributions === 0 || isNaN(contributions)) {
          console.log('[getGroupOverview] No contributions in date range, trying all-time...');
          try {
            const allContributionsSum = await Contribution.sum('amount', {
              where: {
                groupId: groupId,
                status: 'approved'
              }
            });
            const allTimeContributions = parseFloat(allContributionsSum || 0);
            if (!isNaN(allTimeContributions) && allTimeContributions > 0) {
              contributions = allTimeContributions;
              console.log('[getGroupOverview] Fallback: Using all-time contributions:', contributions);
            }
          } catch (fallbackError) {
            console.error('[getGroupOverview] Fallback contributions query also failed:', fallbackError);
          }
        }
      } else {
        console.log('[getGroupOverview] No approved contributions found for group:', groupId);
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching contributions:', error);
      console.error('[getGroupOverview] Error stack:', error.stack);
      // Try without date filter as fallback
      try {
        const allContributionsSum = await Contribution.sum('amount', {
          where: {
            groupId: groupId,
            status: 'approved'
          }
        });
        contributions = parseFloat(allContributionsSum || 0);
        console.log('[getGroupOverview] Fallback: All-time contributions:', contributions);
      } catch (fallbackError) {
        console.error('[getGroupOverview] Fallback contributions query also failed:', fallbackError);
      }
    }
    
    // Ensure contributions is a valid number
    if (isNaN(contributions)) {
      contributions = 0;
    }

    // Get loan payments within time range
    let loanPayments = 0;
    try {
      // Get all group member IDs first
      const groupMemberIds = allMembers.map(m => m.id);
      
      if (groupMemberIds.length > 0) {
        try {
          const loanPaymentsSum = await Transaction.sum('amount', {
            where: {
              userId: { [Op.in]: groupMemberIds },
              type: 'loan_payment',
              status: 'completed',
              transactionDate: { [Op.between]: [startDate, endDate] }
            }
          });
          loanPayments = parseFloat(loanPaymentsSum || 0);
          console.log('[getGroupOverview] Loan payments (date-filtered):', loanPayments);
          
          // If no payments in date range, try all-time as fallback
          if (loanPayments === 0) {
            try {
              const allTimeLoanPaymentsSum = await Transaction.sum('amount', {
                where: {
                  userId: { [Op.in]: groupMemberIds },
                  type: 'loan_payment',
                  status: 'completed'
                }
              });
              const allTimePayments = parseFloat(allTimeLoanPaymentsSum || 0);
              if (allTimePayments > 0) {
                loanPayments = allTimePayments;
                console.log('[getGroupOverview] Fallback: Using all-time loan payments:', loanPayments);
              }
            } catch (fallbackError) {
              console.error('[getGroupOverview] Fallback loan payments query failed:', fallbackError);
            }
          }
        } catch (dateError) {
          console.error('[getGroupOverview] Error with date-filtered loan payments, trying all-time:', dateError);
          // Fallback: get all-time loan payments
          try {
            const allTimeLoanPaymentsSum = await Transaction.sum('amount', {
              where: {
                userId: { [Op.in]: groupMemberIds },
                type: 'loan_payment',
                status: 'completed'
              }
            });
            loanPayments = parseFloat(allTimeLoanPaymentsSum || 0);
            console.log('[getGroupOverview] Fallback: All-time loan payments:', loanPayments);
          } catch (fallbackError) {
            console.error('[getGroupOverview] Fallback loan payments query also failed:', fallbackError);
          }
        }
      } else {
        console.warn('[getGroupOverview] No group member IDs found for loan payments calculation');
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching loan payments:', error);
    }

    // Get fines within time range
    let fines = 0;
    try {
      // First check if there are any fines for this group
      const finesCheck = await Fine.count({
        where: {
          groupId: groupId
        }
      });
      console.log('[getGroupOverview] Total fines count for group:', finesCheck);
      
      if (finesCheck > 0) {
        // Try date-filtered first
        const finesSum = await Fine.sum('amount', {
          where: {
            groupId: groupId,
            status: { [Op.in]: ['approved', 'paid'] },
            createdAt: { [Op.between]: [startDate, endDate] }
          }
        });
        fines = parseFloat(finesSum || 0);
        console.log('[getGroupOverview] Fines (date-filtered):', fines);
        
        // If no fines in date range, try all-time as fallback
        if (fines === 0 || isNaN(fines)) {
          try {
            const allFinesSum = await Fine.sum('amount', {
              where: {
                groupId: groupId,
                status: { [Op.in]: ['approved', 'paid'] }
              }
            });
            const allTimeFines = parseFloat(allFinesSum || 0);
            if (!isNaN(allTimeFines) && allTimeFines > 0) {
              fines = allTimeFines;
              console.log('[getGroupOverview] Fallback: Using all-time fines:', fines);
            }
          } catch (fallbackError) {
            console.error('[getGroupOverview] Fallback fines query failed:', fallbackError);
          }
        }
      } else {
        console.log('[getGroupOverview] No fines found for group:', groupId);
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching fines:', error);
      console.error('[getGroupOverview] Error stack:', error.stack);
    }
    
    // Ensure fines is a valid number
    if (isNaN(fines)) {
      fines = 0;
    }

    // Calculate monthly target (use group contribution amount * active members * 4 weeks as default)
    const monthlyTarget = parseFloat(group.contributionAmount || 0) * activeMembers * 4;
    const monthlyAchieved = contributions;

    // Calculate achievement percentages
    const contributionPercentage = monthlyTarget > 0 ? Math.round((contributions / monthlyTarget) * 100) : 0;
    const loanPaymentPercentage = totalLoans > 0 ? Math.round((loanPayments / totalLoans) * 100) : 0;
    const finePercentage = fines > 0 ? Math.round((fines / (fines * 1.28)) * 100) : 0; // Approximate calculation

    // Get top performing members (based on contributions + loan payments in time range)
    let memberPerformance = [];
    try {
      const groupMemberIds = allMembers.filter(m => m.status === 'active' && m.role === 'Member').map(m => m.id);
      
      if (groupMemberIds.length > 0) {
        // Try with date range first
        try {
          memberPerformance = await sequelize.query(`
            SELECT 
              u.id,
              u.name,
              u.phone,
              COALESCE(SUM(CASE WHEN t.type = 'contribution' THEN t.amount ELSE 0 END), 0) as contributions,
              COALESCE(SUM(CASE WHEN t.type = 'loan_payment' THEN t.amount ELSE 0 END), 0) as loanPayments,
              COALESCE(SUM(CASE WHEN t.type = 'contribution' OR t.type = 'loan_payment' THEN t.amount ELSE 0 END), 0) as totalPerformance
            FROM Users u
            LEFT JOIN Transactions t ON u.id = t.userId 
              AND t.status = 'completed'
              AND t.transactionDate BETWEEN :startDate AND :endDate
              AND (t.type = 'contribution' OR t.type = 'loan_payment')
            WHERE u.groupId = :groupId
              AND u.status = 'active'
              AND u.role = 'Member'
            GROUP BY u.id, u.name, u.phone
            ORDER BY totalPerformance DESC
            LIMIT 10
          `, {
            replacements: { groupId: groupId, startDate, endDate },
            type: sequelize.QueryTypes.SELECT
          });
        } catch (dateRangeError) {
          console.error('[getGroupOverview] Error with date range query, trying all-time:', dateRangeError);
          // Fallback: get all-time performance
          memberPerformance = await sequelize.query(`
            SELECT 
              u.id,
              u.name,
              u.phone,
              COALESCE(SUM(CASE WHEN t.type = 'contribution' THEN t.amount ELSE 0 END), 0) as contributions,
              COALESCE(SUM(CASE WHEN t.type = 'loan_payment' THEN t.amount ELSE 0 END), 0) as loanPayments,
              COALESCE(SUM(CASE WHEN t.type = 'contribution' OR t.type = 'loan_payment' THEN t.amount ELSE 0 END), 0) as totalPerformance
            FROM Users u
            LEFT JOIN Transactions t ON u.id = t.userId 
              AND t.status = 'completed'
              AND (t.type = 'contribution' OR t.type = 'loan_payment')
            WHERE u.groupId = :groupId
              AND u.status = 'active'
              AND u.role = 'Member'
            GROUP BY u.id, u.name, u.phone
            ORDER BY totalPerformance DESC
            LIMIT 10
          `, {
            replacements: { groupId: groupId },
            type: sequelize.QueryTypes.SELECT
          });
        }
        
        // If still no results, at least return member names
        if (memberPerformance.length === 0) {
          console.log('[getGroupOverview] No performance data, returning basic member list');
          memberPerformance = allMembers
            .filter(m => m.status === 'active' && m.role === 'Member')
            .slice(0, 10)
            .map(m => ({
              id: m.id,
              name: m.name,
              phone: m.phone,
              contributions: 0,
              loanPayments: 0,
              totalPerformance: 0
            }));
        }
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching member performance:', error);
      // Return basic member list as fallback
      memberPerformance = allMembers
        .filter(m => m.status === 'active' && m.role === 'Member')
        .slice(0, 10)
        .map(m => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          contributions: 0,
          loanPayments: 0,
          totalPerformance: 0
        }));
    }

    // Calculate consistency for each member (percentage of on-time payments)
    let topPerformers = [];
    try {
      topPerformers = await Promise.all(memberPerformance.map(async (member, index) => {
        try {
          const memberContributions = await Contribution.count({
            where: {
              memberId: member.id,
              status: 'approved',
              createdAt: { [Op.between]: [startDate, endDate] }
            }
          });
          
          const memberLoanPayments = await Transaction.count({
            where: {
              userId: member.id,
              type: 'loan_payment',
              status: 'completed',
              transactionDate: { [Op.between]: [startDate, endDate] }
            }
          });

          const totalTransactions = memberContributions + memberLoanPayments;
          // Calculate consistency based on expected transactions (4 per month for monthly, adjust for other ranges)
          const expectedTransactions = timeRange === 'monthly' ? 4 : timeRange === 'weekly' ? 1 : timeRange === 'daily' ? 0.14 : 12;
          const consistency = expectedTransactions > 0 ? Math.min(100, Math.round((totalTransactions / expectedTransactions) * 100)) : 0;
          
          let status = 'fair';
          if (consistency >= 90) status = 'excellent';
          else if (consistency >= 75) status = 'good';
          else if (consistency >= 50) status = 'fair';
          else status = 'poor';

          return {
            rank: index + 1,
            id: member.id,
            name: member.name || 'Unknown',
            contributions: parseFloat(member.contributions || 0),
            loanPayments: parseFloat(member.loanPayments || 0),
            consistency: Math.max(0, consistency),
            status
          };
        } catch (memberError) {
          console.error(`Error processing member ${member.id}:`, memberError);
          // Return basic member data even if consistency calculation fails
          return {
            rank: index + 1,
            id: member.id,
            name: member.name || 'Unknown',
            contributions: parseFloat(member.contributions || 0),
            loanPayments: parseFloat(member.loanPayments || 0),
            consistency: 0,
            status: 'fair'
          };
        }
      }));
    } catch (error) {
      console.error('Error calculating top performers:', error);
      // Return basic member performance data even if consistency calculation fails
      topPerformers = memberPerformance.map((member, index) => ({
        rank: index + 1,
        id: member.id,
        name: member.name || 'Unknown',
        contributions: parseFloat(member.contributions || 0),
        loanPayments: parseFloat(member.loanPayments || 0),
        consistency: 0,
        status: 'fair'
      }));
    }

    // Get recent activities (last 10 transactions)
    let recentActivities = [];
    try {
      const groupMemberIds = allMembers.map(m => m.id);
      
      if (groupMemberIds.length > 0) {
        try {
          recentActivities = await Transaction.findAll({
            where: {
              userId: { [Op.in]: groupMemberIds },
              transactionDate: { [Op.between]: [startDate, endDate] }
            },
            include: [{
              model: User,
              as: 'user',
              attributes: ['id', 'name']
            }],
            order: [['transactionDate', 'DESC']],
            limit: 10,
            attributes: ['id', 'type', 'amount', 'status', 'transactionDate', 'description']
          });
          console.log('[getGroupOverview] Recent activities found:', recentActivities.length);
        } catch (dateError) {
          console.error('[getGroupOverview] Error with date-filtered activities, trying all-time:', dateError);
          // Fallback: get all-time recent activities
          recentActivities = await Transaction.findAll({
            where: {
              userId: { [Op.in]: groupMemberIds }
            },
            include: [{
              model: User,
              as: 'user',
              attributes: ['id', 'name']
            }],
            order: [['transactionDate', 'DESC']],
            limit: 10,
            attributes: ['id', 'type', 'amount', 'status', 'transactionDate', 'description']
          });
          console.log('[getGroupOverview] Fallback: All-time recent activities:', recentActivities.length);
        }
      }
    } catch (error) {
      console.error('[getGroupOverview] Error fetching recent activities:', error);
    }

    // Calculate growth percentage (compare with previous period)
    let previousStartDate, previousEndDate;
    switch (timeRange) {
      case 'daily':
        previousStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        previousEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'weekly':
        previousStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
        previousEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        break;
      case 'monthly':
        previousStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        previousEndDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'quarterly':
        const prevQuarter = Math.floor(now.getMonth() / 3) - 1;
        previousStartDate = new Date(now.getFullYear(), prevQuarter * 3, 1);
        previousEndDate = new Date(now.getFullYear(), (prevQuarter + 1) * 3, 1);
        break;
    }

    let previousContributions = 0;
    try {
      const previousContributionsResult = await Contribution.findAll({
        where: {
          groupId: groupId,
          status: 'approved',
          createdAt: { [Op.between]: [previousStartDate, previousEndDate] }
        },
        attributes: [
          [sequelize.fn('SUM', sequelize.col('amount')), 'totalAmount']
        ],
        raw: true
      });
      previousContributions = parseFloat(previousContributionsResult[0]?.totalAmount || 0);
    } catch (error) {
      console.error('Error fetching previous contributions:', error);
    }
    const growthPercentage = previousContributions > 0 
      ? Math.round(((contributions - previousContributions) / previousContributions) * 100)
      : 0;

    // Build response data - ensure all fields are always present
    const responseData = {
      timeRange: timeRange || 'monthly',
      dateRange: {
        startDate: startDate ? startDate.toISOString() : new Date().toISOString(),
        endDate: endDate ? endDate.toISOString() : new Date().toISOString()
      },
      members: {
        total: totalMembers || 0,
        active: activeMembers || 0,
        suspended: suspendedMembers || 0,
        defaulters: defaulters || 0
      },
      savings: {
        total: totalSavings || 0,
        growthPercentage: growthPercentage || 0
      },
      loans: {
        total: totalLoans || 0,
        outstanding: outstandingLoans || 0,
        percentage: totalLoans > 0 ? Math.round((outstandingLoans / totalLoans) * 100) : 0
      },
      targets: {
        monthly: monthlyTarget || 0,
        achieved: monthlyAchieved || 0,
        percentage: contributionPercentage || 0
      },
      performance: {
        contributions: {
          amount: contributions || 0,
          percentage: contributionPercentage || 0
        },
        loanPayments: {
          amount: loanPayments || 0,
          percentage: loanPaymentPercentage || 0
        },
        fines: {
          amount: fines || 0,
          percentage: finePercentage || 0
        }
      },
      topPerformers: Array.isArray(topPerformers) ? topPerformers : [],
      recentActivities: Array.isArray(recentActivities) ? recentActivities.map(activity => ({
        id: activity.id,
        member: activity.user?.name || 'Unknown',
        action: activity.type === 'contribution' ? 'Made contribution' 
          : activity.type === 'loan_payment' ? 'Paid loan installment'
          : activity.type === 'fine_payment' ? 'Paid fine'
          : 'Transaction',
        amount: parseFloat(activity.amount || 0),
        status: activity.status || 'completed',
        time: activity.transactionDate || activity.createdAt || new Date()
      })) : []
    };
    
    // Ensure we have at least member data - this is critical
    if (responseData.members.total === 0 && allMembers.length > 0) {
      responseData.members.total = allMembers.length;
      responseData.members.active = allMembers.filter(m => m.status === 'active').length;
      responseData.members.suspended = allMembers.filter(m => m.status === 'suspended').length;
    }

    console.log('[getGroupOverview] Returning data for group:', groupId, 'timeRange:', timeRange);
    console.log('[getGroupOverview] Final Summary:', {
      groupId: groupId,
      groupName: group.name,
      totalMembers,
      activeMembers,
      suspendedMembers,
      defaulters,
      totalSavings,
      outstandingLoans,
      totalLoans,
      contributions,
      loanPayments,
      fines,
      monthlyTarget,
      monthlyAchieved,
      contributionPercentage,
      topPerformersCount: topPerformers.length,
      recentActivitiesCount: recentActivities.length
    });

    // responseData is already complete - return it directly
    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('[getGroupOverview] Error:', error);
    console.error('[getGroupOverview] Error stack:', error.stack);
    
    // Even on error, try to return basic data structure if we have groupId
    try {
      const group = await Group.findByPk(groupId || id);
      if (group) {
        const basicMembers = await User.findAll({
          where: { groupId: groupId || parseInt(id) },
          attributes: ['id', 'name', 'status']
        });
        
        return res.json({
          success: true,
          data: {
            timeRange: timeRange || 'monthly',
            dateRange: {
              startDate: new Date().toISOString(),
              endDate: new Date().toISOString()
            },
            members: {
              total: basicMembers.length,
              active: basicMembers.filter(m => m.status === 'active').length,
              suspended: basicMembers.filter(m => m.status === 'suspended').length,
              defaulters: 0
            },
            savings: {
              total: parseFloat(group.totalSavings || 0),
              growthPercentage: 0
            },
            loans: {
              total: 0,
              outstanding: 0,
              percentage: 0
            },
            targets: {
              monthly: 0,
              achieved: 0,
              percentage: 0
            },
            performance: {
              contributions: { amount: 0, percentage: 0 },
              loanPayments: { amount: 0, percentage: 0 },
              fines: { amount: 0, percentage: 0 }
            },
            topPerformers: [],
            recentActivities: []
          }
        });
      }
    } catch (fallbackError) {
      console.error('[getGroupOverview] Fallback also failed:', fallbackError);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch group overview',
      error: error.message
    });
  }
};

/**
 * Export group overview to Excel
 * GET /api/groups/:id/overview/export
 * Query params: timeRange (daily, weekly, monthly, quarterly)
 */
const exportGroupOverview = async (req, res) => {
  try {
    const { id } = req.params;
    const { timeRange = 'monthly' } = req.query;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Get fresh user data from database
    const user = await User.findByPk(userId, {
      attributes: ['id', 'role', 'groupId']
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Use user's groupId if id is null or 0 (from my-group route)
    const groupId = (id && parseInt(id) !== 0) ? parseInt(id) : user.groupId;

    if (!groupId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }

    // Verify user has access to this group
    if (['Cashier', 'Group Admin', 'Secretary'].includes(userRole) && user.groupId !== groupId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only export your own group.'
      });
    }

    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Calculate date range
    const now = new Date();
    let startDate, endDate;
    switch (timeRange) {
      case 'daily':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 7);
        break;
      case 'monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case 'quarterly':
        const quarter = Math.floor(now.getMonth() / 3);
        startDate = new Date(now.getFullYear(), quarter * 3, 1);
        endDate = new Date(now.getFullYear(), (quarter + 1) * 3, 1);
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    // Fetch all data needed for export
    const allMembers = await User.findAll({
      where: { groupId: groupId },
      attributes: ['id', 'name', 'phone', 'email', 'status', 'totalSavings']
    });

    const groupMemberIds = allMembers.map(m => m.id);

    const contributions = await Contribution.findAll({
      where: {
        groupId: groupId,
        status: 'approved',
        createdAt: { [Op.between]: [startDate, endDate] }
      },
      include: [{ model: User, as: 'member', attributes: ['name', 'phone'] }],
      order: [['createdAt', 'DESC']]
    });

    const transactions = groupMemberIds.length > 0 ? await Transaction.findAll({
      where: {
        userId: { [Op.in]: groupMemberIds },
        transactionDate: { [Op.between]: [startDate, endDate] }
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['name', 'phone']
      }],
      order: [['transactionDate', 'DESC']]
    }) : [];

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 }
    ];
    
    // Calculate real total savings from Users table (same as getGroupOverview)
    let realTotalSavings = 0;
    try {
      // Sum totalSavings from Users table for all active members in the group
      const usersTotalSavings = await User.sum('totalSavings', {
        where: {
          groupId: groupId,
          status: 'active',
          role: { [Op.in]: ['Member', 'Secretary', 'Cashier'] }
        }
      });
      const usersSavings = parseFloat(usersTotalSavings || 0);
      
      if (usersSavings > 0) {
        realTotalSavings = usersSavings;
      } else {
        // Fallback: Sum from Contributions table if Users table is zero
        const contributionsSum = await Contribution.sum('amount', {
          where: {
            groupId: groupId,
            status: 'approved'
          }
        });
        realTotalSavings = parseFloat(contributionsSum || 0);
      }
    } catch (error) {
      console.error('[exportGroupOverview] Error calculating total savings:', error);
      // Fallback to group.totalSavings if calculation fails
      realTotalSavings = parseFloat(group.totalSavings || 0);
    }

    // Calculate totals from contributions and transactions in the date range
    const totalContributions = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
    const totalTransactions = transactions.reduce((sum, t) => sum + Math.abs(parseFloat(t.amount || 0)), 0);
    const totalLoanPayments = transactions
      .filter(t => t.type === 'loan_payment')
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount || 0)), 0);
    const totalFines = transactions
      .filter(t => t.type === 'fine_payment')
      .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount || 0)), 0);

    summarySheet.addRow({ metric: 'Group Name', value: group.name });
    summarySheet.addRow({ metric: 'Time Range', value: timeRange.charAt(0).toUpperCase() + timeRange.slice(1) });
    summarySheet.addRow({ metric: 'Date Range', value: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}` });
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'Total Members', value: allMembers.length });
    summarySheet.addRow({ metric: 'Active Members', value: allMembers.filter(m => m.status === 'active').length });
    summarySheet.addRow({ metric: 'Suspended Members', value: allMembers.filter(m => m.status === 'suspended').length });
    summarySheet.addRow({ metric: 'Total Savings (Real Amount)', value: `RWF ${realTotalSavings.toLocaleString()}` });
    summarySheet.addRow({ metric: '', value: '' });
    summarySheet.addRow({ metric: 'Period Summary', value: '' });
    summarySheet.addRow({ metric: 'Total Contributions (Period)', value: `RWF ${totalContributions.toLocaleString()}` });
    summarySheet.addRow({ metric: 'Total Loan Payments (Period)', value: `RWF ${totalLoanPayments.toLocaleString()}` });
    summarySheet.addRow({ metric: 'Total Fines (Period)', value: `RWF ${totalFines.toLocaleString()}` });
    summarySheet.addRow({ metric: 'Total Transactions (Period)', value: `RWF ${totalTransactions.toLocaleString()}` });
    
    // Contributions Sheet
    const contributionsSheet = workbook.addWorksheet('Contributions');
    contributionsSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member', key: 'member', width: 25 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    contributions.forEach(contrib => {
      contributionsSheet.addRow({
        date: contrib.createdAt.toLocaleDateString(),
        member: contrib.member?.name || 'Unknown',
        amount: parseFloat(contrib.amount || 0).toLocaleString(),
        status: contrib.status
      });
    });

    // Transactions Sheet
    const transactionsSheet = workbook.addWorksheet('Transactions');
    transactionsSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member', key: 'member', width: 25 },
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Status', key: 'status', width: 12 }
    ];
    transactions.forEach(trans => {
      transactionsSheet.addRow({
        date: trans.transactionDate.toLocaleDateString(),
        member: trans.user?.name || 'Unknown',
        type: trans.type.replace('_', ' ').toUpperCase(),
        amount: parseFloat(trans.amount || 0).toLocaleString(),
        status: trans.status
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="group_overview_${group.name}_${timeRange}_${new Date().toISOString().split('T')[0]}.xlsx"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export group overview error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export group overview',
        error: error.message
      });
    }
  }
};

/**
 * Schedule overview report
 * POST /api/groups/my-group/overview/schedule
 * Body: { timeRange, frequency, scheduledDate, email }
 */
const scheduleOverviewReport = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId, {
      attributes: ['id', 'role', 'groupId', 'email']
    });

    if (!user || !user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }

    const { timeRange, frequency, scheduledDate, email } = req.body;

    if (!timeRange || !frequency || !scheduledDate) {
      return res.status(400).json({
        success: false,
        message: 'Time range, frequency, and scheduled date are required'
      });
    }

    // Validate scheduled date is in the future
    const scheduledDateTime = new Date(scheduledDate);
    if (scheduledDateTime <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled date must be in the future'
      });
    }

    const group = await Group.findByPk(user.groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Create notification to store scheduled report info
    // Note: Using 'general' type since 'scheduled_report' is not in ENUM
    // Store schedule data in content field as JSON
    const scheduleData = {
      timeRange,
      frequency,
      scheduledDate,
      email: email || user.email || '',
      groupId: user.groupId,
      groupName: group.name
    };
    
    const notification = await Notification.create({
      userId: userId,
      type: 'general',
      title: `Scheduled ${timeRange.charAt(0).toUpperCase() + timeRange.slice(1)} Overview Report`,
      content: JSON.stringify(scheduleData),
      channel: 'in_app',
      status: 'sent',
      read: false
    });

    // Log the action
    await logAction(userId, 'SCHEDULE_OVERVIEW_REPORT', 'Notification', notification.id, {
      timeRange,
      frequency,
      scheduledDate,
      groupId: user.groupId
    }, req);

    res.status(201).json({
      success: true,
      message: 'Overview report scheduled successfully',
      data: {
        id: notification.id,
        timeRange,
        frequency,
        scheduledDate,
        email: email || user.email
      }
    });
  } catch (error) {
    console.error('Schedule overview report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to schedule overview report',
      error: error.message
    });
  }
};

/**
 * Get Secretary Dashboard data
 * GET /api/groups/my-group/secretary-dashboard
 * Returns: stats (members, meetings, announcements, documents), recent activities, upcoming tasks
 */
const getSecretaryDashboard = async (req, res) => {
  try {
    console.log('[getSecretaryDashboard] Route hit!');
    const userId = req.user.id;
    console.log('[getSecretaryDashboard] User ID:', userId);
    
    const user = await User.findByPk(userId, {
      attributes: ['id', 'role', 'groupId']
    });

    console.log('[getSecretaryDashboard] User found:', { id: user?.id, role: user?.role, groupId: user?.groupId });

    if (!user || !user.groupId) {
      console.log('[getSecretaryDashboard] User does not belong to a group');
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }

    const groupId = user.groupId;

    // Calculate date ranges for growth comparison (last 30 days vs previous 30 days)
    const now = new Date();
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const previous30Days = new Date(last30Days.getTime() - 30 * 24 * 60 * 60 * 1000);

    // 1. MEMBERS STATS
    let totalMembers = 0;
    let newMembers = 0;
    let previousMembers = 0;
    try {
      totalMembers = await User.count({
        where: { groupId, status: { [Op.in]: ['active', 'suspended', 'pending'] } }
      });
      newMembers = await User.count({
        where: {
          groupId,
          status: { [Op.in]: ['active', 'suspended', 'pending'] },
          createdAt: { [Op.gte]: last30Days }
        }
      });
      previousMembers = await User.count({
        where: {
          groupId,
          status: { [Op.in]: ['active', 'suspended', 'pending'] },
          createdAt: { [Op.gte]: previous30Days, [Op.lt]: last30Days }
        }
      });
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching members:', err);
    }

    // 2. MEETINGS STATS
    let totalMeetings = 0;
    let newMeetings = 0;
    let previousMeetings = 0;
    try {
      totalMeetings = await Meeting.count({ where: { groupId } });
      newMeetings = await Meeting.count({
        where: {
          groupId,
          createdAt: { [Op.gte]: last30Days }
        }
      });
      previousMeetings = await Meeting.count({
        where: {
          groupId,
          createdAt: { [Op.gte]: previous30Days, [Op.lt]: last30Days }
        }
      });
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching meetings:', err);
    }

    // 3. ANNOUNCEMENTS STATS
    let totalAnnouncements = 0;
    let newAnnouncements = 0;
    let previousAnnouncements = 0;
    try {
      totalAnnouncements = await Announcement.count({ where: { groupId } });
      newAnnouncements = await Announcement.count({
        where: {
          groupId,
          createdAt: { [Op.gte]: last30Days }
        }
      });
      previousAnnouncements = await Announcement.count({
        where: {
          groupId,
          createdAt: { [Op.gte]: previous30Days, [Op.lt]: last30Days }
        }
      });
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching announcements:', err);
    }

    // 4. DOCUMENTS ARCHIVED (meetings with minutes)
    let totalDocuments = 0;
    let newDocuments = 0;
    let previousDocuments = 0;
    try {
      totalDocuments = await Meeting.count({
        where: {
          groupId,
          minutes: { [Op.ne]: null },
          status: 'completed'
        }
      });
      newDocuments = await Meeting.count({
        where: {
          groupId,
          minutes: { [Op.ne]: null },
          status: 'completed',
          updatedAt: { [Op.gte]: last30Days }
        }
      });
      previousDocuments = await Meeting.count({
        where: {
          groupId,
          minutes: { [Op.ne]: null },
          status: 'completed',
          updatedAt: { [Op.gte]: previous30Days, [Op.lt]: last30Days }
        }
      });
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching documents:', err);
    }

    // Calculate growth indicators
    const membersGrowth = newMembers - previousMembers;
    const meetingsGrowth = newMeetings - previousMeetings;
    const announcementsGrowth = newAnnouncements - previousAnnouncements;
    const documentsGrowth = newDocuments - previousDocuments;

    // 5. RECENT ACTIVITIES (last 20 activities)
    const recentActivities = [];
    
    try {
      // Get recent meetings (explicitly specify attributes to avoid non-existent columns)
      const recentMeetings = await Meeting.findAll({
        where: { groupId },
        attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'createdBy', 'createdAt', 'updatedAt'],
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 10
      });

      recentMeetings.forEach(meeting => {
        const meetingData = meeting.toJSON();
        const timeAgo = formatTimeAgo(meetingData.createdAt);
        recentActivities.push({
          id: `meeting-${meetingData.id}`,
          type: 'meeting',
          title: meetingData.title,
          member: meetingData.creator?.name || 'Unknown',
          role: meetingData.creator?.role || 'Unknown',
          time: timeAgo,
          timeRaw: meetingData.createdAt,
          status: meetingData.status === 'completed' ? 'completed' : 
                  meetingData.status === 'scheduled' ? 'pending' : 
                  meetingData.status === 'ongoing' ? 'in_progress' : 'pending'
        });
      });

      // Get recent announcements
      const recentAnnouncements = await Announcement.findAll({
        where: { groupId },
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 10
      });

      recentAnnouncements.forEach(announcement => {
        const annData = announcement.toJSON();
        const timeAgo = formatTimeAgo(annData.createdAt);
        recentActivities.push({
          id: `announcement-${annData.id}`,
          type: 'announcement',
          title: annData.title,
          member: annData.creator?.name || 'Secretary',
          role: annData.creator?.role || 'Secretary',
          time: timeAgo,
          timeRaw: annData.createdAt,
          status: annData.status === 'sent' ? 'sent' : 'pending'
        });
      });

      // Get recent member registrations
      const recentApplications = await MemberApplication.findAll({
        where: { groupId },
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 10
      });

      recentApplications.forEach(app => {
        const appData = app.toJSON();
        const timeAgo = formatTimeAgo(appData.createdAt);
        recentActivities.push({
          id: `member-${appData.id}`,
          type: 'member',
          title: `New Member Registration: ${appData.user?.name || 'Unknown'}`,
          member: appData.user?.name || 'Unknown',
          role: appData.user?.role || 'Member',
          time: timeAgo,
          timeRaw: appData.createdAt,
          status: appData.status === 'approved' ? 'completed' : 
                  appData.status === 'rejected' ? 'rejected' : 'pending'
        });
      });

      // Get recent meeting minutes uploads (meetings with minutes)
      const recentMinutes = await Meeting.findAll({
        where: {
          groupId,
          minutes: { [Op.ne]: null },
          status: 'completed'
        },
        attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'createdBy', 'createdAt', 'updatedAt'],
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['updatedAt', 'DESC']],
        limit: 10
      });

      recentMinutes.forEach(meeting => {
        const meetingData = meeting.toJSON();
        const timeAgo = formatTimeAgo(meetingData.updatedAt);
        recentActivities.push({
          id: `document-${meetingData.id}`,
          type: 'document',
          title: `Meeting Minutes Uploaded: ${meetingData.title}`,
          member: meetingData.creator?.name || 'Secretary',
          role: meetingData.creator?.role || 'Secretary',
          time: timeAgo,
          timeRaw: meetingData.updatedAt,
          status: 'archived'
        });
      });

      // Get attendance taken activities (check if attendance array exists, not null)
      // This works even if attendanceTakenBy/attendanceTakenAt columns don't exist
      const attendanceMeetings = await Meeting.findAll({
        where: {
          groupId,
          attendance: { [Op.ne]: null }
        },
        attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'createdBy', 'createdAt', 'updatedAt'],
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['updatedAt', 'DESC']], // Use updatedAt instead of attendanceTakenAt
        limit: 10
      });

      // Get attendance takers separately
      for (const meeting of attendanceMeetings) {
        const meetingData = meeting.toJSON();
        let attendanceTaker = null;
        // Check if attendanceTakenBy exists (column might not exist in DB)
        if (meetingData.attendanceTakenBy) {
          try {
            attendanceTaker = await User.findByPk(meetingData.attendanceTakenBy, {
              attributes: ['id', 'name', 'role']
            });
          } catch (err) {
            console.log('[getSecretaryDashboard] Could not fetch attendance taker:', err.message);
          }
        }
        const attendanceCount = Array.isArray(meetingData.attendance) ? meetingData.attendance.length : 0;
        // Use attendanceTakenAt if exists, otherwise use updatedAt
        const attendanceDate = meetingData.attendanceTakenAt || meetingData.updatedAt;
        const timeAgo = formatTimeAgo(attendanceDate);
        recentActivities.push({
          id: `attendance-${meetingData.id}`,
          type: 'attendance',
          title: `Attendance Taken: ${meetingData.title} (${attendanceCount} members)`,
          member: attendanceTaker?.name || meetingData.creator?.name || 'Secretary',
          role: attendanceTaker?.role || meetingData.creator?.role || 'Secretary',
          time: timeAgo,
          timeRaw: attendanceDate,
          status: 'completed'
        });
      }

      // Get recent contributions
      const recentContributions = await Contribution.findAll({
        where: { groupId },
        include: [
          {
            association: 'member',
            attributes: ['id', 'name', 'phone']
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 15
      });

      recentContributions.forEach(contrib => {
        const contribData = contrib.toJSON();
        const timeAgo = formatTimeAgo(contribData.createdAt);
        recentActivities.push({
          id: `contribution-${contribData.id}`,
          type: 'contribution',
          title: `Contribution: ${parseFloat(contribData.amount || 0).toLocaleString()} RWF`,
          member: contribData.member?.name || 'Unknown',
          role: 'Member',
          time: timeAgo,
          timeRaw: contribData.createdAt,
          status: contribData.status === 'approved' ? 'completed' : 
                  contribData.status === 'rejected' ? 'rejected' : 'pending'
        });
      });

      // Get new votes created
      const recentVotes = await Vote.findAll({
        where: { groupId },
        include: [
          {
            model: User,
            as: 'creator',
            attributes: ['id', 'name', 'role'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 10
      });

      recentVotes.forEach(vote => {
        const voteData = vote.toJSON();
        const timeAgo = formatTimeAgo(voteData.createdAt);
        recentActivities.push({
          id: `vote-${voteData.id}`,
          type: 'vote',
          title: `New Vote Created: ${voteData.title}`,
          member: voteData.creator?.name || 'Unknown',
          role: voteData.creator?.role || 'Secretary',
          time: timeAgo,
          timeRaw: voteData.createdAt,
          status: voteData.status === 'active' ? 'pending' : 
                  voteData.status === 'completed' ? 'completed' : 'pending'
        });
      });

      // Get recent vote responses (people voting) - get through votes
      const groupVotes = await Vote.findAll({
        where: { groupId },
        attributes: ['id']
      });
      const voteIds = groupVotes.map(v => v.id);
      
      const recentVoteResponses = voteIds.length > 0 ? await VoteResponse.findAll({
        where: { voteId: { [Op.in]: voteIds } },
        include: [
          {
            model: User,
            as: 'member',
            attributes: ['id', 'name', 'role'],
            required: false
          },
          {
            model: Vote,
            as: 'vote',
            attributes: ['id', 'title'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: 15
      }) : [];

      recentVoteResponses.forEach(response => {
        const responseData = response.toJSON();
        const timeAgo = formatTimeAgo(responseData.createdAt);
        recentActivities.push({
          id: `vote-response-${responseData.id}`,
          type: 'vote_response',
          title: `Voted on: ${responseData.vote?.title || 'Vote'}`,
          member: responseData.member?.name || 'Unknown',
          role: responseData.member?.role || 'Member',
          time: timeAgo,
          timeRaw: responseData.createdAt,
          status: 'completed'
        });
      });

      // Sort all activities by time (most recent first) and take top 30
      recentActivities.sort((a, b) => new Date(b.timeRaw) - new Date(a.timeRaw));
      recentActivities.splice(30);
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching recent activities:', err);
    }

    // 6. UPCOMING TASKS (future meetings)
    const upcomingTasks = [];
    try {
      const futureMeetings = await Meeting.findAll({
        where: {
          groupId,
          scheduledDate: { [Op.gte]: now },
          status: { [Op.in]: ['scheduled', 'ongoing'] }
        },
        attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'createdBy', 'createdAt', 'updatedAt'],
        order: [['scheduledDate', 'ASC']],
        limit: 10
      });

      futureMeetings.forEach(meeting => {
        const meetingData = meeting.toJSON();
        const scheduledDateTime = new Date(meetingData.scheduledDate);
        const scheduledTime = meetingData.scheduledTime || '00:00:00';
        const [hours, minutes] = scheduledTime.split(':');
        scheduledDateTime.setHours(parseInt(hours) || 0, parseInt(minutes) || 0, 0, 0);
        
        const dueDate = scheduledDateTime.toISOString().split('T')[0];
        const timeStr = scheduledDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
        const daysUntil = Math.ceil((scheduledDateTime - now) / (1000 * 60 * 60 * 24));
        
        let priority = 'medium';
        if (daysUntil <= 3) priority = 'high';
        else if (daysUntil > 14) priority = 'low';

        upcomingTasks.push({
          id: `task-${meetingData.id}`,
          task: meetingData.title,
          priority,
          dueDate,
          scheduledTime: timeStr,
          scheduledDateTime: scheduledDateTime.toISOString(),
          meetingId: meetingData.id,
          meetingTitle: meetingData.title,
          location: meetingData.location || 'Not specified'
        });
      });
    } catch (err) {
      console.error('[getSecretaryDashboard] Error fetching upcoming tasks:', err);
    }

    console.log('[getSecretaryDashboard] Preparing response:', {
      activitiesCount: recentActivities.length,
      tasksCount: upcomingTasks.length,
      stats: {
        members: totalMembers,
        meetings: totalMeetings,
        announcements: totalAnnouncements,
        documents: totalDocuments
      }
    });

    const responseData = {
      success: true,
      data: {
        stats: {
          members: {
            total: totalMembers,
            growth: membersGrowth > 0 ? `+${membersGrowth}` : membersGrowth.toString()
          },
          meetings: {
            total: totalMeetings,
            growth: meetingsGrowth > 0 ? `+${meetingsGrowth}` : meetingsGrowth.toString()
          },
          announcements: {
            total: totalAnnouncements,
            growth: announcementsGrowth > 0 ? `+${announcementsGrowth}` : announcementsGrowth.toString()
          },
          documents: {
            total: totalDocuments,
            growth: documentsGrowth > 0 ? `+${documentsGrowth}` : documentsGrowth.toString()
          }
        },
        recentActivities,
        upcomingTasks
      }
    };

    console.log('[getSecretaryDashboard] Sending response with', recentActivities.length, 'activities and', upcomingTasks.length, 'tasks');
    res.json(responseData);
  } catch (error) {
    console.error('[getSecretaryDashboard] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch secretary dashboard data',
      error: error.message
    });
  }
};

/**
 * Helper function to notify system admins about agent actions
 */
const notifySystemAdmins = async (title, content, actionType = 'general') => {
  try {
    const systemAdmins = await User.findAll({
      where: {
        role: 'System Admin',
        status: 'active'
      },
      attributes: ['id', 'name', 'email', 'phone']
    });

    const notifications = systemAdmins.map(admin => ({
      userId: admin.id,
      type: actionType,
      channel: 'in_app',
      title,
      content,
      status: 'sent'
    }));

    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
      console.log(`[notifySystemAdmins] Created ${notifications.length} notifications for system admins`);
    }
  } catch (error) {
    console.error('[notifySystemAdmins] Error:', error);
    // Don't throw - notification failure shouldn't break the main flow
  }
};

/**
 * Delete member from group (Agent only)
 * DELETE /api/groups/:groupId/members/:memberId
 */
const deleteGroupMember = async (req, res) => {
  try {
    const { groupId, memberId } = req.params;
    const agent = req.user;

    // Only agents can delete members
    if (agent.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Only agents can delete members from groups'
      });
    }

    // Verify the group exists (agents can now modify any group)
    const group = await Group.findByPk(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        message: 'Group not found'
      });
    }

    // Note: Agents can now delete members from any group, not just groups they registered
    // All actions will be logged and reported to system admins

    // Get the member
    const member = await User.findByPk(memberId);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    if (member.groupId !== parseInt(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Member does not belong to this group'
      });
    }

    // Don't allow deleting Group Admin, Cashier, or Secretary
    if (['Group Admin', 'Cashier', 'Secretary'].includes(member.role)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete leadership roles. Please reassign them first.'
      });
    }

    const memberName = member.name;
    const groupName = group.name;

    // Delete the member (soft delete by setting status to inactive)
    member.status = 'inactive';
    member.groupId = null;
    await member.save();

    // Update group member count
    const activeMemberCount = await User.count({
      where: {
        groupId: parseInt(groupId),
        status: 'active'
      }
    });
    group.totalMembers = activeMemberCount;
    await group.save();

    // Log action
    await logAction(agent.id, 'DELETE_GROUP_MEMBER', 'User', memberId, {
      memberName,
      memberId,
      groupId,
      groupName,
      agentName: agent.name,
      agentId: agent.id,
      originalAgentId: group.agentId, // Track which agent originally registered this group
      isOwnGroup: group.agentId === agent.id // Indicate if this is the agent's own group
    }, req);

    // Always notify system admins when agent deletes a member (from any group)
    const groupOwnershipNote = group.agentId === agent.id 
      ? ' (from their own registered group)' 
      : ` (from group originally registered by Agent ID: ${group.agentId})`;
    
    await notifySystemAdmins(
      'Agent Deleted Group Member',
      `Agent ${agent.name} (ID: ${agent.id}) deleted member ${memberName} (ID: ${memberId}) from group "${groupName}" (ID: ${groupId})${groupOwnershipNote}.`,
      'agent_action'
    );

    res.json({
      success: true,
      message: 'Member deleted successfully',
      data: {
        memberId,
        memberName,
        groupId,
        groupName
      }
    });
  } catch (error) {
    console.error('Delete group member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete member',
      error: error.message
    });
  }
};

/**
 * Create member for Group Admin - DIRECT SQL IMPLEMENTATION
 * POST /api/groups/members
 * This is a completely independent endpoint that uses direct SQL
 */
const createGroupMember = async (req, res) => {
  console.log('[createGroupMember] ========== DIRECT SQL IMPLEMENTATION ==========');
  console.log('[createGroupMember] Request body:', req.body);
  console.log('[createGroupMember] User:', req.user?.id, req.user?.role);
  
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    // Only Group Admin, Secretary, or Cashier can use this endpoint
    if (!['Group Admin', 'Secretary', 'Cashier'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only Group Admin, Secretary, or Cashier can create members'
      });
    }
    
    // Get Group Admin's groupId
    const adminUser = await User.findByPk(userId, { attributes: ['id', 'groupId'] });
    if (!adminUser || !adminUser.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group Admin must belong to a group'
      });
    }
    
    const groupId = adminUser.groupId;
    
    // Extract and validate input
    const { firstName, lastName, email, phone, nationalId, dateOfBirth, location, password } = req.body;
    
    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !nationalId || !dateOfBirth || !location || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: firstName, lastName, email, phone, nationalId, dateOfBirth, location, password'
      });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }
    
    // Validate phone (10 digits)
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Phone number must be exactly 10 digits'
      });
    }
    
    // Validate national ID (16 digits)
    const nationalIdDigits = nationalId.replace(/\D/g, '');
    if (nationalIdDigits.length !== 16) {
      return res.status(400).json({
        success: false,
        message: 'National ID must be exactly 16 digits'
      });
    }
    
    // Validate date of birth (at least 10 years old, not future)
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
    
    if (birthDate > today) {
      return res.status(400).json({
        success: false,
        message: 'Date of birth cannot be in the future'
      });
    }
    
    if (birthDate > tenYearsAgo) {
      return res.status(400).json({
        success: false,
        message: 'Member must be at least 10 years old'
      });
    }
    
    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }
    
    // Normalize phone (format: +250XXXXXXXXX)
    const phoneWithoutLeadingZero = phoneDigits.startsWith('0') ? phoneDigits.substring(1) : phoneDigits;
    const normalizedPhone = `+250${phoneWithoutLeadingZero}`;
    
    // Use the ACTUAL email from the form - only normalize (trim whitespace, lowercase for consistency)
    // The email domain and address are preserved exactly as the user entered them
    const normalizedEmail = email.trim().toLowerCase();
    
    const fullName = `${firstName.trim()} ${lastName.trim()}`;
    const plainPassword = password;
    
    // Hash password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if phone, email, or national ID already exists using direct SQL
    const existingUsers = await sequelize.query(`
      SELECT id, phone, email, nationalId 
      FROM Users 
      WHERE phone = :phone OR email = :email OR nationalId = :nationalId
      LIMIT 1
    `, {
      replacements: { phone: normalizedPhone, email: normalizedEmail, nationalId: nationalIdDigits },
      type: sequelize.QueryTypes.SELECT
    });
    
    if (existingUsers && existingUsers.length > 0) {
      const existing = existingUsers[0];
      if (existing.phone === normalizedPhone) {
        return res.status(409).json({ 
          success: false, 
          message: `A user with the phone number "${normalizedPhone}" already exists. Please use a different phone number.` 
        });
      }
      if (existing.email === normalizedEmail) {
        return res.status(409).json({ 
          success: false, 
          message: `A user with the email address "${normalizedEmail}" already exists. Please use a different email address.` 
        });
      }
      if (existing.nationalId === nationalIdDigits) {
        return res.status(409).json({ 
          success: false, 
          message: 'A user with this national ID already exists. Please verify the national ID number.' 
        });
      }
    }
    
    // Insert member using direct SQL
    // IMPORTANT: All data is saved exactly as entered in the form textboxes:
    // - firstName, lastName: trimmed and combined as full name
    // - email: actual email from form (trimmed and lowercased for consistency only)
    // - phone: normalized to +250 format (required for system)
    // - nationalId: digits only (as entered)
    // - dateOfBirth: as selected in date picker
    // - location/address: as typed in textbox (trimmed)
    // - password: hashed for security
    const now = new Date();
    const result = await sequelize.query(`
      INSERT INTO Users (
        name, phone, email, nationalId, password, role, groupId, status, 
        address, dateOfBirth, totalSavings, createdAt, updatedAt
      ) VALUES (
        :name, :phone, :email, :nationalId, :password, 'Member', :groupId, 'active',
        :address, :dateOfBirth, 0, :createdAt, :updatedAt
      )
    `, {
      replacements: {
        name: fullName, // firstName + lastName from form
        phone: normalizedPhone, // Phone normalized to +250 format
        email: normalizedEmail, // ACTUAL email from form (e.g., user@gmail.com, NOT @umurengewallet.com)
        nationalId: nationalIdDigits, // National ID digits from form
        password: hashedPassword, // Password hashed for security
        groupId: groupId,
        address: location.trim(), // Location/address exactly as typed
        dateOfBirth: birthDate.toISOString().split('T')[0], // Date of birth as selected
        createdAt: now,
        updatedAt: now
      },
      type: sequelize.QueryTypes.INSERT
    });
    
    // result[0] is the insertId for MySQL
    const newMemberId = result[0];
    
    console.log('[createGroupMember] Member created successfully with ID:', newMemberId);
    
    // Create MemberApplication with approved status since created by leader
    try {
      await MemberApplication.create({
        userId: newMemberId,
        groupId: groupId,
        status: 'approved',
        reviewedBy: userId,
        reviewDate: now,
        occupation: null,
        address: location.trim(),
        reason: `Member created by ${userRole}`
      });
      console.log('[createGroupMember] MemberApplication created with approved status');
    } catch (appError) {
      console.error('[createGroupMember] Error creating MemberApplication (non-critical):', appError);
      // Don't fail the member creation if application creation fails
    }
    
    // Log action
    await logAction(userId, 'CREATE_MEMBER', 'User', newMemberId, {
      memberName: fullName,
      groupId: groupId,
      createdBy: userRole,
      status: 'approved'
    }, req);
    
    // Send welcome email to the new member
    if (normalizedEmail) {
      try {
        const { sendWelcomeEmailWithCredentials } = require('../notifications/emailService');
        const group = await Group.findByPk(groupId);
        const groupName = group ? group.name : 'your group';
        await sendWelcomeEmailWithCredentials(normalizedEmail, fullName, normalizedPhone, plainPassword, groupName);
        console.log('[createGroupMember] Welcome email sent to:', normalizedEmail);
      } catch (emailError) {
        console.error('[createGroupMember] Failed to send welcome email:', emailError);
        // Don't fail the creation if email fails
      }
    }
    
    // Send notification to all existing group members about the new member
    try {
      // Get all active group members (excluding the newly created member)
      const existingGroupMembers = await User.findAll({
        where: {
          groupId: groupId,
          status: 'active',
          id: { [Op.ne]: newMemberId } // Exclude the new member
        },
        attributes: ['id', 'name']
      });
      
      console.log(`[createGroupMember] Notifying ${existingGroupMembers.length} existing group members about new member`);
      
      if (existingGroupMembers.length > 0) {
        const group = await Group.findByPk(groupId);
        const groupName = group ? group.name : 'the group';
        
        // Create notifications for all existing members
        const notifications = existingGroupMembers.map(member => ({
          userId: member.id,
          type: 'announcement',
          channel: 'in_app',
          title: 'New Member Joined Your Group',
          content: `${fullName} has joined ${groupName}. Welcome them to the group!`,
          status: 'sent'
        }));
        
        await Notification.bulkCreate(notifications);
        console.log(`[createGroupMember] Created ${notifications.length} notifications for group members`);
      }
    } catch (notificationError) {
      console.error('[createGroupMember] Failed to send notifications to group members:', notificationError);
      // Don't fail the creation if notifications fail
    }
    
    // Return success
    res.status(201).json({
      success: true,
      message: 'Member created successfully',
      data: {
        id: newMemberId,
        name: fullName,
        phone: normalizedPhone,
        email: normalizedEmail,
        nationalId: nationalIdDigits,
        role: 'Member',
        groupId: groupId
      }
    });
  } catch (error) {
    console.error('[createGroupMember] Error:', error);
    console.error('[createGroupMember] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to create member',
      error: error.message
    });
  }
};

// Helper function to format time ago
function formatTimeAgo(date) {
  if (!date) return 'Unknown';
  const now = new Date();
  const past = new Date(date);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 4) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  
  const months = Math.floor(diffDays / 30);
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

/**
 * Burn or unburn a group member account
 * PUT /api/groups/members/:memberId/burn
 * PUT /api/groups/members/:memberId/unburn
 */
const burnGroupMember = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { action } = req.body; // 'burn' or 'unburn'
    const adminId = req.user.id;
    const adminRole = req.user.role;

    console.log(`[burnGroupMember] ${action} request for member ${memberId} by ${adminRole} ${adminId}`);

    // Only Group Admin can burn/unburn members
    if (adminRole !== 'Group Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only Group Admin can burn/unburn member accounts'
      });
    }

    // Get admin's group
    const admin = await User.findByPk(adminId, { attributes: ['id', 'groupId'] });
    if (!admin || !admin.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group Admin must belong to a group'
      });
    }

    const groupId = admin.groupId;

    // Get the member
    const member = await User.findByPk(memberId, {
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name']
        }
      ]
    });

    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    // Verify member belongs to the same group as admin
    if (member.groupId !== groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only burn/unburn members from your own group'
      });
    }

    // Prevent burning yourself
    if (memberId === adminId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot burn your own account'
      });
    }

    const isBurning = action === 'burn';
    const newStatus = isBurning ? 'burned' : 'active';
    const oldStatus = member.status;

    // Check if already in the desired state (case-insensitive)
    if (member.status && member.status.toLowerCase() === newStatus.toLowerCase()) {
      return res.status(400).json({
        success: false,
        message: `Account is already ${newStatus}`
      });
    }

    // Update member status
    member.status = newStatus;
    await member.save();

    // Log the action
    await logAction(adminId, isBurning ? 'BURN_MEMBER' : 'UNBURN_MEMBER', 'User', memberId, {
      memberId: memberId,
      memberName: member.name,
      oldStatus: oldStatus,
      newStatus: newStatus,
      groupId: groupId
    }, req);

    // Get group name
    const group = await Group.findByPk(groupId);
    const groupName = group ? group.name : 'your group';

    // Send email to the member
    if (member.email) {
      try {
        const { sendAccountBurnedEmail, sendAccountReactivatedEmail } = require('../notifications/emailService');
        if (isBurning) {
          await sendAccountBurnedEmail(member.email, member.name, groupName, null);
          console.log(`[burnGroupMember] Burn email sent to: ${member.email}`);
        } else {
          await sendAccountReactivatedEmail(member.email, member.name, groupName);
          console.log(`[burnGroupMember] Reactivation email sent to: ${member.email}`);
        }
      } catch (emailError) {
        console.error('[burnGroupMember] Failed to send email:', emailError);
        // Don't fail the operation if email fails
      }
    }

    // Send notifications to all group members (including the burned/unburned member)
    try {
      const { Op } = require('sequelize');
      const allGroupMembers = await User.findAll({
        where: {
          groupId: groupId
          // Include all members, including the burned/unburned member
        },
        attributes: ['id', 'name']
      });

      console.log(`[burnGroupMember] Notifying ${allGroupMembers.length} group members about ${action}`);

      if (allGroupMembers.length > 0) {
        const notificationMessage = isBurning
          ? `${member.name}'s account has been burned (suspended) in ${groupName}.`
          : `${member.name}'s account has been reactivated in ${groupName}.`;

        const notifications = allGroupMembers.map(groupMember => ({
          userId: groupMember.id,
          type: 'announcement',
          channel: 'in_app',
          title: isBurning ? 'Member Account Burned' : 'Member Account Reactivated',
          content: notificationMessage,
          status: 'sent'
        }));

        await Notification.bulkCreate(notifications);
        console.log(`[burnGroupMember] Created ${notifications.length} notifications for group members (including the affected member)`);
      }
    } catch (notificationError) {
      console.error('[burnGroupMember] Failed to send notifications to group members:', notificationError);
      // Don't fail the operation if notifications fail
    }

    res.json({
      success: true,
      message: `Member account ${isBurning ? 'burned' : 'reactivated'} successfully`,
      data: {
        memberId: memberId,
        memberName: member.name,
        status: newStatus
      }
    });
  } catch (error) {
    console.error('[burnGroupMember] Error:', error);
    res.status(500).json({
      success: false,
      message: `Failed to ${req.body.action || 'update'} member account`,
      error: error.message
    });
  }
};

module.exports = {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  getGroupStats,
  getMyGroupData,
  getGroupActivities,
  getGroupMembers,
  deleteGroupMember,
  mergeGroups,
  getGroupOverview,
  exportGroupOverview,
  scheduleOverviewReport,
  getSecretaryDashboard,
  createGroupMember,
  burnGroupMember
};

