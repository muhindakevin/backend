const { Vote, VoteOption, VoteResponse, Group, User } = require('../models');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');

/**
 * Create vote
 * POST /api/voting
 */
const createVote = async (req, res) => {
  try {
    const { groupId, title, description, type, endDate, options } = req.body;
    const createdBy = req.user.id;

    if (!groupId || !title || !endDate || !options || options.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Group ID, title, end date, and at least 2 options are required'
      });
    }

    // Validate vote type - fallback to 'other' if type is not in enum
    const validTypes = [
      'loan_approval', 'loan_approval_override', 'member_admission', 'fine_waiver', 
      'policy_change', 'withdrawal_approval', 'contribution_change', 
      'saving_amount_change', 'fine_change', 'fine_amount_change', 
      'interest_rate_change', 'other'
    ];
    const voteType = validTypes.includes(type) ? type : 'other';

    const vote = await Vote.create({
      groupId,
      title,
      description,
      type: voteType,
      endDate: new Date(endDate),
      createdBy,
      status: 'open'
    });

    // Create vote options
    const voteOptions = await Promise.all(
      options.map(optionText =>
        VoteOption.create({
          voteId: vote.id,
          option: optionText
        })
      )
    );

    logAction(createdBy, 'VOTE_CREATED', 'Vote', vote.id, { groupId, title }, req);

    res.status(201).json({
      success: true,
      message: 'Vote created successfully',
      data: {
        ...vote.toJSON(),
        options: voteOptions
      }
    });
  } catch (error) {
    console.error('Create vote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create vote',
      error: error.message
    });
  }
};

/**
 * Get votes
 * GET /api/voting
 */
const getVotes = async (req, res) => {
  try {
    const { groupId, status } = req.query;
    const user = req.user;

    let whereClause = {};

    // Allow Group Admin, Cashier, Secretary, and Members to view votes for their group
    if ((user.role === 'Group Admin' || user.role === 'Cashier' || user.role === 'Secretary' || user.role === 'Member') && user.groupId) {
      whereClause.groupId = user.groupId;
    } else if (groupId) {
      whereClause.groupId = groupId;
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const votes = await Vote.findAll({
      where: whereClause,
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'] },
        { association: 'creator', attributes: ['id', 'name'] },
        { association: 'options' }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Clean descriptions - remove metadata from all votes
    const cleanedVotes = votes.map(vote => {
      const voteData = vote.toJSON();
      let cleanDescription = voteData.description || '';
      cleanDescription = cleanDescription.replace(/\[VOTE_METADATA_START\].*?\[VOTE_METADATA_END\]/s, '');
      cleanDescription = cleanDescription.replace(/<!-- METADATA:.*?-->/s, '');
      cleanDescription = cleanDescription.trim();
      voteData.description = cleanDescription;
      return voteData;
    });

    res.json({
      success: true,
      data: cleanedVotes
    });
  } catch (error) {
    console.error('Get votes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch votes',
      error: error.message
    });
  }
};

/**
 * Cast vote
 * POST /api/voting/:id/vote
 */
const castVote = async (req, res) => {
  try {
    const { id } = req.params;
    const { optionId } = req.body;
    const memberId = req.user.id;

    if (!optionId) {
      return res.status(400).json({
        success: false,
        message: 'Option ID is required'
      });
    }

    const vote = await Vote.findByPk(id, {
      include: [{ association: 'group' }]
    });

    if (!vote) {
      return res.status(404).json({
        success: false,
        message: 'Vote not found'
      });
    }

    if (vote.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'Vote is not open'
      });
    }

    if (new Date() > new Date(vote.endDate)) {
      return res.status(400).json({
        success: false,
        message: 'Vote has ended'
      });
    }

    // Check if user already voted
    const existingVote = await VoteResponse.findOne({
      where: { voteId: id, memberId }
    });

    if (existingVote) {
      return res.status(400).json({
        success: false,
        message: 'You have already voted'
      });
    }

    // Verify option belongs to this vote
    const option = await VoteOption.findByPk(optionId);
    if (!option || option.voteId !== parseInt(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid vote option'
      });
    }

    // Create vote response
    await VoteResponse.create({
      voteId: id,
      optionId,
      memberId
    });

    // Update vote counts
    option.voteCount = (option.voteCount || 0) + 1;
    await option.save();

    vote.totalVotes = (vote.totalVotes || 0) + 1;
    await vote.save();

    logAction(memberId, 'VOTE_CAST', 'Vote', vote.id, { optionId }, req);

    res.json({
      success: true,
      message: 'Vote cast successfully',
      data: { vote, option }
    });
  } catch (error) {
    console.error('Cast vote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cast vote',
      error: error.message
    });
  }
};

/**
 * Get single vote with details
 * GET /api/voting/:id
 */
const getVoteById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const vote = await Vote.findByPk(id, {
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'] },
        { association: 'creator', attributes: ['id', 'name'] },
        { 
          association: 'options',
          include: [{ association: 'responses' }]
        }
      ]
    });

    if (!vote) {
      return res.status(404).json({
        success: false,
        message: 'Vote not found'
      });
    }

    // Calculate vote counts for each option
    const optionsWithCounts = vote.options.map(option => ({
      ...option.toJSON(),
      voteCount: option.responses ? option.responses.length : 0
    }));

    // Clean description - remove metadata
    let cleanDescription = vote.description || '';
    cleanDescription = cleanDescription.replace(/\[VOTE_METADATA_START\].*?\[VOTE_METADATA_END\]/s, '');
    cleanDescription = cleanDescription.replace(/<!-- METADATA:.*?-->/s, '');
    cleanDescription = cleanDescription.trim();

    const voteData = vote.toJSON();
    voteData.description = cleanDescription;

    res.json({
      success: true,
      data: {
        ...voteData,
        options: optionsWithCounts
      }
    });
  } catch (error) {
    console.error('Get vote by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vote',
      error: error.message
    });
  }
};

/**
 * Get user's vote for a specific vote
 * GET /api/voting/:id/my-vote
 */
const getMyVote = async (req, res) => {
  try {
    const { id } = req.params;
    const memberId = req.user.id;

    const voteResponse = await VoteResponse.findOne({
      where: { voteId: id, memberId },
      include: [
        { association: 'option' },
        { association: 'vote' }
      ]
    });

    if (!voteResponse) {
      return res.status(404).json({
        success: false,
        message: 'You have not voted on this proposal yet'
      });
    }

    res.json({
      success: true,
      data: {
        voteId: voteResponse.voteId,
        option: voteResponse.option,
        votedAt: voteResponse.createdAt
      }
    });
  } catch (error) {
    console.error('Get my vote error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your vote',
      error: error.message
    });
  }
};

/**
 * Helper function to automatically create a vote
 * This can be called from other controllers to create votes automatically
 * @param {Object} voteData - Vote data including groupId, title, description, type, endDate, options
 * @param {Number} createdBy - User ID who created the vote
 * @returns {Promise<Object>} Created vote object
 */
const createAutomaticVote = async (voteData) => {
  try {
    const { groupId, title, description, type, endDate, options } = voteData;
    
    if (!groupId || !title || !endDate || !options || options.length < 2) {
      throw new Error('Group ID, title, end date, and at least 2 options are required');
    }

    // Validate vote type - fallback to 'other' if type is not in enum
    const validTypes = [
      'loan_approval', 'loan_approval_override', 'member_admission', 'fine_waiver', 
      'policy_change', 'withdrawal_approval', 'contribution_change', 
      'saving_amount_change', 'fine_change', 'fine_amount_change', 
      'interest_rate_change', 'other'
    ];
    const voteType = validTypes.includes(type) ? type : 'other';

    const vote = await Vote.create({
      groupId,
      title,
      description,
      type: voteType,
      endDate: new Date(endDate),
      createdBy: voteData.createdBy || 1, // System user if not provided
      status: 'open'
    });

    // Create vote options
    const voteOptions = await Promise.all(
      options.map(optionText =>
        VoteOption.create({
          voteId: vote.id,
          option: optionText
        })
      )
    );

    // Log action if createdBy is provided
    if (voteData.createdBy) {
      const { logAction } = require('../utils/auditLogger');
      logAction(voteData.createdBy, 'VOTE_CREATED_AUTO', 'Vote', vote.id, { groupId, title, type }, null);
    }

    return {
      ...vote.toJSON(),
      options: voteOptions
    };
  } catch (error) {
    console.error('Create automatic vote error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      voteData: {
        groupId: voteData.groupId,
        type: voteData.type,
        title: voteData.title
      }
    });
    // Re-throw with more context
    throw new Error(`Failed to create automatic vote: ${error.message}`);
  }
};

/**
 * Approve or reject vote result and apply changes
 * POST /api/voting/:id/approve-result
 */
const approveVoteResult = async (req, res) => {
  try {
    const { id } = req.params;
    const { approved } = req.body; // true to approve, false to reject
    const userId = req.user.id;

    const vote = await Vote.findByPk(id, {
      include: [
        { association: 'group' },
        { 
          association: 'options',
          include: [{ association: 'responses' }]
        }
      ]
    });

    if (!vote) {
      return res.status(404).json({
        success: false,
        message: 'Vote not found'
      });
    }

    // Check if user is Group Admin, Cashier, or Secretary of the group
    const user = await User.findByPk(userId);
    if (!user || user.groupId !== vote.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only approve votes for your own group'
      });
    }

    if (!['Group Admin', 'Cashier', 'Secretary'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Only group leaders can approve vote results'
      });
    }

    if (vote.status === 'closed') {
      return res.status(400).json({
        success: false,
        message: 'Vote has already been processed'
      });
    }

    // Calculate vote results
    const optionsWithCounts = vote.options.map(option => ({
      ...option.toJSON(),
      voteCount: option.responses ? option.responses.length : 0
    }));

    // Find approve and reject options
    const approveOption = optionsWithCounts.find(opt => 
      opt.option.toLowerCase().includes('approve') || 
      opt.option.toLowerCase().includes('yes')
    );
    const rejectOption = optionsWithCounts.find(opt => 
      opt.option.toLowerCase().includes('reject') || 
      opt.option.toLowerCase().includes('no')
    );

    const approveVotes = approveOption ? approveOption.voteCount : 0;
    const rejectVotes = rejectOption ? rejectOption.voteCount : 0;
    const totalVotes = approveVotes + rejectVotes;

    // For contribution_change votes, automatically determine result based on majority
    // If approved parameter is not provided, use majority vote
    let finalApproved = approved;
    if (vote.type === 'contribution_change' && (approved === undefined || approved === null)) {
      // Auto-approve if majority voted yes (more than 50%)
      finalApproved = totalVotes > 0 && approveVotes > rejectVotes;
      console.log(`[approveVoteResult] Auto-determining vote result: ${finalApproved ? 'APPROVED' : 'REJECTED'} (${approveVotes} approve, ${rejectVotes} reject)`);
    } else if (approved === undefined || approved === null) {
      // For other vote types, use the provided approved parameter or default to majority
      finalApproved = totalVotes > 0 && approveVotes > rejectVotes;
    }

    // Close the vote
    vote.status = 'closed';
    await vote.save();

    // If approved and vote type is contribution_change, apply the changes automatically
    if (finalApproved && vote.type === 'contribution_change') {
      try {
        // Extract metadata from description (try both formats)
        let proposedChanges = null;
        let metadataMatch = vote.description.match(/\[VOTE_METADATA_START\](.*?)\[VOTE_METADATA_END\]/s);
        if (metadataMatch) {
          proposedChanges = JSON.parse(metadataMatch[1]);
        } else {
          // Fallback to old format
          metadataMatch = vote.description.match(/<!-- METADATA: ({.*?}) -->/);
          if (metadataMatch) {
            proposedChanges = JSON.parse(metadataMatch[1]);
          }
        }
        
        if (proposedChanges) {
          const group = await Group.findByPk(vote.groupId);
          
          if (group) {
            if (proposedChanges.contributionAmount !== undefined) {
              group.contributionAmount = proposedChanges.contributionAmount;
            }
            // Note: Other fields (maximumAmount, dueDate, lateFee, gracePeriod) 
            // would need to be added to Group model or stored in Settings table
            // For now, we apply contributionAmount which is the main field
            await group.save();
            console.log(`[approveVoteResult] Applied contribution settings changes to group ${group.id}`);
          }
        }
      } catch (applyError) {
        console.error('[approveVoteResult] Error applying changes:', applyError);
        // Continue even if applying changes fails
      }
    }

    // If approved and vote type is fine_change, apply the fine rules changes
    if (finalApproved && vote.type === 'fine_change') {
      try {
        const { applyFineRules } = require('./fineRules.controller');
        let metadataMatch = vote.description.match(/\[VOTE_METADATA_START\](.*?)\[VOTE_METADATA_END\]/s);
        if (metadataMatch) {
          const metadata = JSON.parse(metadataMatch[1]);
          if (metadata.rules && metadata.groupId) {
            await applyFineRules(metadata.groupId, metadata.rules);
            console.log(`[approveVoteResult] Applied fine rules changes to group ${metadata.groupId}`);
          }
        }
      } catch (applyError) {
        console.error('[approveVoteResult] Error applying fine rules changes:', applyError);
        // Continue even if applying changes fails
      }
    }

    // Create announcement about vote result (but don't auto-send - admin will send it)
    // Also send notifications to all members
    try {
      const { Announcement, Notification } = require('../models');
      const resultText = finalApproved ? 'approved' : 'rejected';
      const announcementTitle = `Vote Result: ${vote.title}`;
      
      // Clean vote title and description for announcement
      let cleanTitle = vote.title;
      let cleanDescription = vote.description || '';
      cleanDescription = cleanDescription.replace(/\[VOTE_METADATA_START\].*?\[VOTE_METADATA_END\]/s, '');
      cleanDescription = cleanDescription.replace(/<!-- METADATA:.*?-->/s, '');
      cleanDescription = cleanDescription.trim();
      
      let announcementContent = `The voting proposal "${cleanTitle}" has been ${resultText}.\n\n`;
      announcementContent += `Vote Results:\n`;
      announcementContent += `• Approve: ${approveVotes} votes\n`;
      announcementContent += `• Reject: ${rejectVotes} votes\n\n`;
      if (finalApproved && vote.type === 'contribution_change') {
        announcementContent += `The contribution settings have been updated as proposed. All members must now contribute at least the new minimum amount.`;
      } else if (finalApproved && vote.type === 'fine_change') {
        announcementContent += `The fine rules have been updated as proposed. The new fine rules are now in effect.`;
      } else if (!finalApproved) {
        announcementContent += `The proposed changes have been rejected and will not be applied.`;
      }

      // Create announcement as draft - admin will send it manually
      await Announcement.create({
        groupId: vote.groupId,
        title: announcementTitle,
        content: announcementContent,
        priority: 'high',
        status: 'draft', // Don't auto-send, let admin send it
        createdBy: userId
      });

      // Send notifications to all group members about vote result
      try {
        const groupMembers = await User.findAll({
          where: {
            groupId: vote.groupId,
            status: 'active'
          },
          attributes: ['id']
        });

        const notifications = groupMembers.map(member => ({
          userId: member.id,
          type: 'announcement',
          channel: 'in_app',
          title: `Vote Result: ${cleanTitle}`,
          content: announcementContent.substring(0, 200),
          status: 'sent'
        }));

        if (notifications.length > 0) {
          await Notification.bulkCreate(notifications);
          console.log(`[approveVoteResult] Created ${notifications.length} notifications for vote result`);
        }
      } catch (notifError) {
        console.error('[approveVoteResult] Error creating notifications:', notifError);
      }

      // Send group chat message
      try {
        const { ChatMessage } = require('../models');
        await ChatMessage.create({
          groupId: vote.groupId,
          senderId: userId,
          message: `📢 ${announcementTitle}\n\n${announcementContent}`,
          type: 'system'
        });
      } catch (chatError) {
        console.error('[approveVoteResult] Error sending chat message:', chatError);
      }
    } catch (announcementError) {
      console.error('[approveVoteResult] Error creating announcement:', announcementError);
    }

    logAction(userId, 'VOTE_RESULT_APPROVED', 'Vote', vote.id, { approved: finalApproved, approveVotes, rejectVotes }, req);

    res.json({
      success: true,
      message: `Vote result ${finalApproved ? 'approved' : 'rejected'} successfully${vote.type === 'contribution_change' && finalApproved ? '. Contribution settings have been updated.' : ''}`,
      data: {
        vote,
        results: {
          approveVotes,
          rejectVotes,
          totalVotes: approveVotes + rejectVotes
        },
        approved: finalApproved,
        autoDetermined: vote.type === 'contribution_change' && approved === undefined
      }
    });
  } catch (error) {
    console.error('Approve vote result error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve vote result',
      error: error.message
    });
  }
};

/**
 * Get vote statistics
 * GET /api/voting/:id/stats
 */
const getVoteStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const vote = await Vote.findByPk(id, {
      include: [
        { 
          association: 'options',
          include: [{ 
            association: 'responses',
            include: [{ 
              model: User, 
              as: 'member', 
              attributes: ['id', 'name'] 
            }]
          }]
        },
        { association: 'group' }
      ]
    });

    if (!vote) {
      return res.status(404).json({
        success: false,
        message: 'Vote not found'
      });
    }

    // Get total members in group
    const totalMembers = await User.count({
      where: { 
        groupId: vote.groupId,
        status: 'active',
        role: 'Member'
      }
    });

    // Calculate statistics
    const optionsWithStats = vote.options.map(option => ({
      id: option.id,
      option: option.option,
      voteCount: option.responses ? option.responses.length : 0,
      voters: option.responses ? option.responses.map(r => ({
        id: r.member?.id,
        name: r.member?.name
      })) : []
    }));

    const totalVotes = optionsWithStats.reduce((sum, opt) => sum + opt.voteCount, 0);
    const participationRate = totalMembers > 0 ? (totalVotes / totalMembers) * 100 : 0;

    res.json({
      success: true,
      data: {
        vote: {
          id: vote.id,
          title: vote.title,
          description: vote.description,
          type: vote.type,
          status: vote.status,
          startDate: vote.startDate,
          endDate: vote.endDate
        },
        statistics: {
          totalMembers,
          totalVotes,
          participationRate: Math.round(participationRate * 100) / 100,
          options: optionsWithStats
        }
      }
    });
  } catch (error) {
    console.error('Get vote stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vote statistics',
      error: error.message
    });
  }
};

/**
 * Extend voting deadline
 * PUT /api/voting/:id/extend-deadline
 */
const extendVotingDeadline = async (req, res) => {
  console.log('[extendVotingDeadline] Route called', { id: req.params.id, newEndDate: req.body.newEndDate });
  try {
    const { id } = req.params;
    const { newEndDate } = req.body;
    const userId = req.user.id;
    const { User } = require('../models');

    if (!newEndDate) {
      return res.status(400).json({
        success: false,
        message: 'New end date is required'
      });
    }

    const vote = await Vote.findByPk(id, {
      include: [{ association: 'group' }]
    });

    if (!vote) {
      return res.status(404).json({
        success: false,
        message: 'Vote not found'
      });
    }

    // Check permissions - only Group Admin, Cashier, or Secretary can extend deadline
    if (req.user.role !== 'Group Admin' && req.user.role !== 'Cashier' && req.user.role !== 'Secretary') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin, Cashier, or Secretary can extend voting deadlines.'
      });
    }

    // Verify user belongs to the same group
    if (req.user.groupId && parseInt(req.user.groupId) !== vote.groupId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only extend deadlines for votes in your own group.'
      });
    }

    // Check if vote is still open
    if (vote.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'Cannot extend deadline for a closed vote'
      });
    }

    const newEndDateObj = new Date(newEndDate);
    const currentEndDate = new Date(vote.endDate);

    // Validate new end date is in the future
    if (newEndDateObj <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'New end date must be in the future'
      });
    }

    // Validate new end date is after current end date
    if (newEndDateObj <= currentEndDate) {
      return res.status(400).json({
        success: false,
        message: 'New end date must be after the current deadline'
      });
    }

    // Update the deadline
    vote.endDate = newEndDateObj;
    await vote.save();

    // Create notification for all group members about deadline extension
    try {
      const { Notification, ChatMessage } = require('../models');
      const groupMembers = await User.findAll({
        where: {
          groupId: vote.groupId,
          status: 'active'
        },
        attributes: ['id']
      });

      const notifications = groupMembers.map(member => ({
        userId: member.id,
        type: 'announcement',
        channel: 'in_app',
        title: `Voting Deadline Extended: ${vote.title}`,
        content: `The voting deadline for "${vote.title}" has been extended to ${newEndDateObj.toLocaleDateString()}. You still have time to vote!`,
        status: 'sent'
      }));

      if (notifications.length > 0) {
        await Notification.bulkCreate(notifications);
        console.log(`[extendVotingDeadline] Created ${notifications.length} notifications`);
      }

      // Send group chat message
      try {
        await ChatMessage.create({
          groupId: vote.groupId,
          senderId: userId,
          message: `⏰ Voting Deadline Extended\n\nThe voting deadline for "${vote.title}" has been extended to ${newEndDateObj.toLocaleDateString()} at ${newEndDateObj.toLocaleTimeString()}. You still have time to cast your vote!`,
          type: 'system'
        });
      } catch (chatError) {
        console.error('[extendVotingDeadline] Error sending chat message:', chatError);
      }
    } catch (notifError) {
      console.error('[extendVotingDeadline] Error creating notifications:', notifError);
    }

    logAction(userId, 'VOTE_DEADLINE_EXTENDED', 'Vote', vote.id, { 
      oldEndDate: currentEndDate.toISOString(), 
      newEndDate: newEndDateObj.toISOString() 
    }, req);

    res.json({
      success: true,
      message: 'Voting deadline extended successfully. All members have been notified.',
      data: {
        vote,
        oldEndDate: currentEndDate,
        newEndDate: newEndDateObj
      }
    });
  } catch (error) {
    console.error('Extend voting deadline error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to extend voting deadline',
      error: error.message
    });
  }
};

module.exports = {
  createVote,
  getVotes,
  castVote,
  getVoteById,
  getMyVote,
  createAutomaticVote,
  approveVoteResult,
  getVoteStats,
  extendVotingDeadline
};

