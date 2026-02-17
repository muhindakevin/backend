const { LearnGrowContent, User, Group, Notification, ChatMessage, TrainingProgress } = require('../models');
const { sendLearnGrowUpdate } = require('../notifications/emailService');
const { Op } = require('sequelize');

// Verify models are loaded
if (!LearnGrowContent) {
  console.error('[learngrow.controller] LearnGrowContent model not available');
}
if (!User) {
  console.error('[learngrow.controller] User model not available');
}

// Ensure User model is available for associations
if (!User) {
  console.error('[learngrow.controller] User model not available');
}

/**
 * Create Learn & Grow content
 * POST /api/learn-grow
 */
const createContent = async (req, res) => {
  try {
    const { title, description, content, type, category, fileUrl, thumbnailUrl, duration, targetAudience } = req.body;
    const createdBy = req.user.id;

    if (!title || !type) {
      return res.status(400).json({
        success: false,
        message: 'Title and type are required'
      });
    }

    const learnContent = await LearnGrowContent.create({
      title,
      description,
      content,
      type,
      category,
      fileUrl,
      thumbnailUrl,
      duration: duration ? parseInt(duration) : null,
      targetAudience: targetAudience || 'members',
      createdBy,
      status: 'published'
    });

    // Send notifications based on target audience
    setImmediate(async () => {
      try {
        const finalTargetAudience = targetAudience || 'members';
        const isForAgents = finalTargetAudience === 'agent' || finalTargetAudience === 'both' || finalTargetAudience === 'agents';
        const isForMembers = finalTargetAudience === 'members' || finalTargetAudience === 'both';
        const isForSecretary = finalTargetAudience === 'secretary' || finalTargetAudience === 'both';

        // If training is for agents, send chat messages and notifications to all agents
        if (isForAgents) {
          try {
            const allAgents = await User.findAll({
              where: {
                role: 'Agent',
                status: 'active'
              },
              attributes: ['id', 'name', 'email', 'phone']
            });

            console.log(`[createContent] Sending notifications to ${allAgents.length} agents about new training: ${title}`);

            // Get System Admin who created the training (sender)
            const creator = await User.findByPk(createdBy, {
              attributes: ['id', 'name']
            });

            // Send chat messages to all agents from System Admin
            const chatMessages = [];
            for (const agent of allAgents) {
              try {
                const chatMessage = await ChatMessage.create({
                  groupId: null,
                  senderId: createdBy, // System Admin
                  receiverId: agent.id, // Agent
                  message: `New Training Available: ${title}\n\n${description ? description.substring(0, 200) : 'A new training has been posted for agents. Please check the Training page.'}\n\nView in Training page.`,
                  type: 'text',
                  fileUrl: null
                });
                chatMessages.push(chatMessage);
              } catch (chatError) {
                console.error(`[createContent] Failed to send chat message to agent ${agent.id}:`, chatError);
                // Continue with other agents
              }
            }

            // Create in-app notifications for all agents
            const agentNotifications = allAgents.map(agent => ({
              userId: agent.id,
              type: 'training_update',
              channel: 'in_app',
              title: `New Training Available: ${title}`,
              content: description ? description.substring(0, 200) : `A new training "${title}" has been posted for agents. Please check the Training page.`,
              status: 'sent'
            }));

            if (agentNotifications.length > 0) {
              await Notification.bulkCreate(agentNotifications);
              console.log(`[createContent] Created ${agentNotifications.length} in-app notifications for agents`);
            }

            // Emit Socket.io events for real-time updates (if available)
            const io = req.app ? req.app.get('io') : null;
            if (io) {
              for (const agent of allAgents) {
                io.to(`user:${agent.id}`).emit('new_training', {
                  training: learnContent,
                  message: `New training available: ${title}`
                });
                io.to(`user:${agent.id}`).emit('play_notification_sound');
              }
            }
          } catch (agentError) {
            console.error('[createContent] Error sending notifications to agents:', agentError);
            // Don't fail the request if agent notifications fail
          }
        }

        // Send notifications to members if applicable
        if (isForMembers) {
          try {
            const allMembers = await User.findAll({
              where: {
                role: 'Member',
                status: 'active'
              },
              attributes: ['id', 'name', 'email', 'phone', 'groupId']
            });

            console.log(`[createContent] Sending notifications to ${allMembers.length} members about new Learn & Grow content`);

            // Create in-app notifications for all members
            const notifications = allMembers.map(member => ({
              userId: member.id,
              type: 'learn_grow_update',
              channel: 'in_app',
              title: `New ${type} Content Available: ${title}`,
              content: description ? description.substring(0, 200) : `New ${type} content "${title}" is now available in Learn & Grow.`,
              status: 'sent'
            }));

            if (notifications.length > 0) {
              await Notification.bulkCreate(notifications);
              console.log(`[createContent] Created ${notifications.length} in-app notifications`);
            }

            // Send email notifications to members who have email configured
            for (const member of allMembers) {
              if (member.email) {
                try {
                  await sendLearnGrowUpdate(member.email, member.name, title);
                } catch (emailError) {
                  console.error(`[createContent] Failed to send email to ${member.email}:`, emailError);
                }
              }
            }
          } catch (memberError) {
            console.error('[createContent] Error sending notifications to members:', memberError);
          }
        }
      } catch (notificationError) {
        console.error('[createContent] Error sending notifications:', notificationError);
        // Don't fail the request if notifications fail
      }
    });

    res.status(201).json({
      success: true,
      message: 'Content created successfully',
      data: learnContent
    });
  } catch (error) {
    console.error('Create content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create content',
      error: error.message
    });
  }
};

/**
 * Get all Learn & Grow content
 * GET /api/learn-grow
 */
const getContent = async (req, res) => {
  try {
    const { type, category, status, targetAudience } = req.query;
    const user = req.user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    let whereClause = {};

    if (type && type !== 'all') {
      whereClause.type = type;
    }

    if (category) {
      whereClause.category = category;
    }

    // System Admin can see all content (draft, published, archived)
    if (user.role === 'System Admin') {
    if (status && status !== 'all') {
      whereClause.status = status;
      }
      // System Admin can filter by targetAudience if provided
      if (targetAudience && targetAudience !== 'all') {
        whereClause.targetAudience = targetAudience;
      }
      // Otherwise, System Admin sees all content regardless of targetAudience
    } else {
      // Other users only see published content
      whereClause.status = 'published';

    // Filter by target audience based on user role
    if (user.role === 'Secretary') {
      // Secretary sees ALL published content (can view all learn-grow content uploaded by System Admin)
      // No targetAudience filter for Secretary - they see everything
    } else if (user.role === 'Member') {
      // Members see courses for members OR both
      whereClause.targetAudience = {
        [Op.in]: ['members', 'both']
      };
    } else if (user.role === 'Agent') {
        // Agents see courses for agent, agents, OR both
      whereClause.targetAudience = {
          [Op.in]: ['agent', 'agents', 'both']
        };
      }
    }

    console.log('[getContent] Fetching content with whereClause:', JSON.stringify(whereClause));
    console.log('[getContent] User role:', user.role);

    // Remove targetAudience from whereClause to avoid column errors
    // We'll filter in memory after fetching if needed
    let safeWhereClause = { ...whereClause };
    const targetAudienceFilter = safeWhereClause.targetAudience;
    delete safeWhereClause.targetAudience;
    
    // Fetch content using raw query to avoid Sequelize trying to select targetAudience
    // This ensures it works even if the column doesn't exist in the database
    const { QueryTypes } = require('sequelize');
    const sequelize = LearnGrowContent.sequelize;
    
    // Build WHERE clause for raw query
    let whereConditions = [];
    let replacements = {};
    
    if (safeWhereClause.status) {
      whereConditions.push('status = :status');
      replacements.status = safeWhereClause.status;
    }
    if (safeWhereClause.type) {
      whereConditions.push('type = :type');
      replacements.type = safeWhereClause.type;
    }
    if (safeWhereClause.category) {
      whereConditions.push('category = :category');
      replacements.category = safeWhereClause.category;
    }
    
    const sqlWhereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    // Try to include targetAudience if column exists, otherwise exclude it
    let selectFields = `id, title, description, content, type, category, 
             fileUrl, thumbnailUrl, duration, status, views, 
             createdBy, createdAt, updatedAt`;
    
    // Check if targetAudience column exists
    try {
      const [columnCheck] = await sequelize.query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'LearnGrowContents' 
        AND COLUMN_NAME = 'targetAudience'
      `, { type: QueryTypes.SELECT });
      
      if (columnCheck && columnCheck.length > 0) {
        selectFields += ', targetAudience';
      }
    } catch (e) {
      console.warn('[getContent] Could not check for targetAudience column:', e.message);
    }
    
    let results = [];
    try {
      console.log('[getContent] Executing query with selectFields:', selectFields);
      console.log('[getContent] SQL WHERE clause:', sqlWhereClause);
      console.log('[getContent] Replacements:', replacements);
      
      const queryResult = await sequelize.query(`
        SELECT ${selectFields}
        FROM LearnGrowContents
        ${sqlWhereClause}
        ORDER BY createdAt DESC
      `, {
        replacements,
        type: QueryTypes.SELECT
      });
      
      console.log('[getContent] Query result type:', typeof queryResult);
      console.log('[getContent] Query result is array:', Array.isArray(queryResult));
      console.log('[getContent] Query result length:', queryResult ? (Array.isArray(queryResult) ? queryResult.length : 'not array') : 'null/undefined');
      
      // Handle different return formats from sequelize.query
      if (Array.isArray(queryResult)) {
        results = queryResult;
      } else if (queryResult && Array.isArray(queryResult[0])) {
        results = queryResult[0];
      } else if (queryResult && queryResult.length === 2 && Array.isArray(queryResult[0])) {
        // Sequelize sometimes returns [results, metadata]
        results = queryResult[0];
      } else {
        console.warn('[getContent] Unexpected query result format:', queryResult);
        results = [];
      }
    } catch (queryError) {
      console.error('[getContent] Query error:', queryError.message);
      console.error('[getContent] Query error stack:', queryError.stack);
      results = [];
    }
    
    // Final safety check - ensure results is always an array
    if (!Array.isArray(results)) {
      console.warn('[getContent] Results is not an array after processing, defaulting to empty array. Type:', typeof results);
      results = [];
    }
    
    console.log('[getContent] Final results count:', results.length);
    
    // Convert raw results to Sequelize instances
    let contents = results.map(row => {
      const instance = LearnGrowContent.build(row, { isNewRecord: false });
      // Set targetAudience if it exists, otherwise default to 'members'
      const audience = row.targetAudience || 'members';
      instance.setDataValue('targetAudience', audience);
      return instance;
    });
    
    // Apply targetAudience filter in memory if needed
    // Note: Secretary role sees all content, so skip filtering for Secretary
    if (targetAudienceFilter && user.role !== 'Secretary') {
      if (targetAudienceFilter[Op.in]) {
        // Filter by array of values
        contents = contents.filter(c => {
          const audience = c.getDataValue('targetAudience') || 'members';
          return targetAudienceFilter[Op.in].includes(audience);
        });
      } else if (typeof targetAudienceFilter === 'string') {
        // Filter by single value
        contents = contents.filter(c => {
          const audience = c.getDataValue('targetAudience') || 'members';
          return audience === targetAudienceFilter;
        });
      }
    }

    // Manually add creator info
    for (const content of contents) {
      if (content.createdBy) {
        try {
          const creator = await User.findByPk(content.createdBy, { 
            attributes: ['id', 'name']
          });
          if (creator) {
            content.setDataValue('creator', creator);
          }
        } catch (e) {
          console.error('[getContent] Error fetching creator:', e.message);
        }
      }
    }

    console.log(`[getContent] Found ${contents.length} content items`);

    res.json({
      success: true,
      data: contents
    });
  } catch (error) {
    console.error('[getContent] Error:', error);
    console.error('[getContent] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content',
      error: error.message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
};

/**
 * Get single content
 * GET /api/learn-grow/:id
 */
const getContentById = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('[getContentById] Fetching content with id:', id);

    // Fetch content without include first to avoid association issues
    let content = await LearnGrowContent.findByPk(id);
    
    if (content && content.createdBy) {
      try {
        const creator = await User.findByPk(content.createdBy, { 
          attributes: ['id', 'name']
        });
        if (creator) {
          content.setDataValue('creator', creator);
        }
      } catch (e) {
        console.error('[getContentById] Error fetching creator:', e.message);
      }
    }

    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Increment view count
    content.views = (content.views || 0) + 1;
    await content.save();

    res.json({
      success: true,
      data: content
    });
  } catch (error) {
    console.error('Get content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch content',
      error: error.message
    });
  }
};

/**
 * Get member progress for group admin
 * GET /api/learn-grow/progress
 */
const getMemberProgress = async (req, res) => {
  try {
    const user = req.user;
    
    // Get user's group
    const userWithGroup = await User.findByPk(user.id, {
      attributes: ['id', 'groupId']
    });
    
    if (!userWithGroup || !userWithGroup.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User does not belong to a group'
      });
    }
    
    const groupId = userWithGroup.groupId;
    
    // Get all published content
    const publishedContent = await LearnGrowContent.findAll({
      where: { status: 'published' },
      order: [['createdAt', 'DESC']]
    });
    
    // If no content exists, return empty
    if (publishedContent.length === 0) {
      return res.json({
        success: true,
        data: {
          members: [],
          content: [],
          stats: {
            totalMembers: 0,
            enrolledMembers: 0,
            completionRate: 0,
            totalCertificates: 0,
            activeLearners: 0,
            availableModules: 0
          }
        }
      });
    }
    
    // Get all active members in the group
    const groupMembers = await User.findAll({
      where: {
        groupId: groupId,
        status: 'active',
        role: 'Member'
      },
      attributes: ['id', 'name', 'phone', 'email', 'createdAt']
    });
    
    // For each member, calculate progress
    // Since we don't have a progress tracking model, we'll show available content
    const memberProgress = groupMembers.map(member => {
      // For now, we'll show 0% progress since there's no tracking
      // In a real system, you'd query a MemberProgress or ContentView table
      return {
        memberId: member.id,
        memberName: member.name,
        phone: member.phone || '',
        email: member.email || '',
        totalModules: publishedContent.length,
        completedModules: 0, // No tracking yet
        inProgress: 0,
        completionPercentage: 0,
        lastActivity: null,
        certificates: 0,
        currentModule: publishedContent.length > 0 ? publishedContent[0].title : 'Not Started'
      };
    });
    
    // Calculate stats
    const stats = {
      totalMembers: groupMembers.length,
      enrolledMembers: groupMembers.length, // All active members are enrolled
      completionRate: 0, // No tracking yet
      totalCertificates: 0, // No certificates yet
      activeLearners: 0, // No tracking yet
      availableModules: publishedContent.length
    };
    
    res.json({
      success: true,
      data: {
        members: memberProgress,
        content: publishedContent,
        stats: stats
      }
    });
  } catch (error) {
    console.error('Get member progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member progress',
      error: error.message
    });
  }
};

/**
 * Update training progress for agent
 * POST /api/learn-grow/progress
 */
const updateTrainingProgress = async (req, res) => {
  try {
    const { contentId, status, progressPercentage, timeSpent } = req.body;
    const userId = req.user.id;

    if (!contentId) {
      return res.status(400).json({
        success: false,
        message: 'Content ID is required'
      });
    }

    // Find or create progress record
    let progress = await TrainingProgress.findOne({
      where: {
        userId,
        contentId
      }
    });

    if (!progress) {
      progress = await TrainingProgress.create({
        userId,
        contentId,
        status: status || 'not_started',
        progressPercentage: progressPercentage || 0,
        timeSpent: timeSpent || 0
      });
    } else {
      // Update existing progress
      if (status) progress.status = status;
      if (progressPercentage !== undefined) progress.progressPercentage = progressPercentage;
      if (timeSpent !== undefined) progress.timeSpent = (progress.timeSpent || 0) + timeSpent;
      
      // If status is completed, set completedAt
      if (status === 'completed' && !progress.completedAt) {
        progress.completedAt = new Date();
      }
      
      await progress.save();
    }

    res.json({
      success: true,
      message: 'Training progress updated',
      data: progress
    });
  } catch (error) {
    console.error('Update training progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update training progress',
      error: error.message
    });
  }
};

/**
 * Get agent training progress with rankings
 * GET /api/learn-grow/agent/progress
 */
const getAgentTrainingProgress = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all agent trainings
    const agentTrainings = await LearnGrowContent.findAll({
      where: {
        status: 'published',
        targetAudience: {
          [Op.in]: ['agent', 'both']
        }
      },
      order: [['createdAt', 'DESC']]
    });
    
    // Manually add creator info
    for (const training of agentTrainings) {
      if (training.createdBy) {
        try {
          const creator = await User.findByPk(training.createdBy, { 
            attributes: ['id', 'name']
          });
          if (creator) {
            training.setDataValue('creator', creator);
          }
        } catch (e) {
          console.error('[getAgentTrainingProgress] Error fetching creator:', e.message);
        }
      }
    }

    // Get progress for current agent
    const agentProgress = await TrainingProgress.findAll({
      where: { userId },
      include: [
        { 
          model: LearnGrowContent, 
          as: 'content', 
          attributes: ['id', 'title', 'type', 'category', 'duration'],
          required: false
        }
      ]
    });

    // Create a map of contentId -> progress
    const progressMap = {};
    agentProgress.forEach(p => {
      progressMap[p.contentId] = p;
    });

    // Calculate rankings - get all agents' progress
    const allAgents = await User.findAll({
      where: {
        role: 'Agent',
        status: 'active'
      },
      attributes: ['id', 'name']
    });

    // Get all training progress for all agents
    const allProgress = await TrainingProgress.findAll({
      where: {
        userId: { [Op.in]: allAgents.map(a => a.id) },
        status: 'completed'
      },
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id', 'name'],
          required: false
        },
        { 
          model: LearnGrowContent, 
          as: 'content', 
          attributes: ['id', 'title'],
          required: false
        }
      ]
    });

    // Calculate completion counts per agent
    const agentCompletions = {};
    allAgents.forEach(agent => {
      agentCompletions[agent.id] = {
        agentId: agent.id,
        agentName: agent.name,
        completedCount: allProgress.filter(p => p.userId === agent.id).length,
        totalTrainings: agentTrainings.length
      };
    });

    // Sort agents by completion count (ranking)
    const rankings = Object.values(agentCompletions)
      .sort((a, b) => b.completedCount - a.completedCount)
      .map((agent, index) => ({
        ...agent,
        rank: index + 1
      }));

    // Find current agent's rank
    const currentAgentRank = rankings.find(r => r.agentId === userId) || {
      rank: rankings.length + 1,
      completedCount: 0,
      totalTrainings: agentTrainings.length
    };

    // Map trainings with progress
    const trainingsWithProgress = agentTrainings.map(training => {
      const progress = progressMap[training.id];
      return {
        ...training.toJSON(),
        progress: progress ? {
          status: progress.status,
          progressPercentage: progress.progressPercentage,
          timeSpent: progress.timeSpent,
          completedAt: progress.completedAt
        } : {
          status: 'not_started',
          progressPercentage: 0,
          timeSpent: 0,
          completedAt: null
        }
      };
    });

    res.json({
      success: true,
      data: {
        trainings: trainingsWithProgress,
        myRank: currentAgentRank.rank,
        myCompletedCount: currentAgentRank.completedCount,
        totalTrainings: agentTrainings.length,
        rankings: rankings.slice(0, 10) // Top 10 agents
      }
    });
  } catch (error) {
    console.error('Get agent training progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch training progress',
      error: error.message
    });
  }
};

/**
 * Update Learn & Grow content
 * PUT /api/learn-grow/:id
 */
const updateContent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, content, type, category, fileUrl, thumbnailUrl, duration, targetAudience, status } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Find the content
    const learnContent = await LearnGrowContent.findByPk(id);
    
    if (!learnContent) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Check permissions: Only System Admin or the creator can update
    if (userRole !== 'System Admin' && learnContent.createdBy !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this content'
      });
    }

    // Update fields
    if (title !== undefined) learnContent.title = title;
    if (description !== undefined) learnContent.description = description;
    if (content !== undefined) learnContent.content = content;
    if (type !== undefined) learnContent.type = type;
    if (category !== undefined) learnContent.category = category;
    if (fileUrl !== undefined) learnContent.fileUrl = fileUrl;
    if (thumbnailUrl !== undefined) learnContent.thumbnailUrl = thumbnailUrl;
    if (duration !== undefined) learnContent.duration = duration ? parseInt(duration) : null;
    if (targetAudience !== undefined) learnContent.targetAudience = targetAudience;
    if (status !== undefined) learnContent.status = status;

    await learnContent.save();

    res.json({
      success: true,
      message: 'Content updated successfully',
      data: learnContent
    });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update content',
      error: error.message
    });
  }
};

/**
 * Delete Learn & Grow content
 * DELETE /api/learn-grow/:id
 */
const deleteContent = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Find the content
    const learnContent = await LearnGrowContent.findByPk(id);
    
    if (!learnContent) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Check permissions: Only System Admin or the creator can delete
    if (userRole !== 'System Admin' && learnContent.createdBy !== userId) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this content'
      });
    }

    // Delete associated training progress
    await TrainingProgress.destroy({
      where: { contentId: id }
    });

    // Delete the content
    await learnContent.destroy();

    res.json({
      success: true,
      message: 'Content deleted successfully'
    });
  } catch (error) {
    console.error('Delete content error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete content',
      error: error.message
    });
  }
};

/**
 * Get members who haven't learned specific content (for Secretary)
 * GET /api/learn-grow/:id/non-learners
 */
const getNonLearners = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Only Secretary can access this
    if (user.role !== 'Secretary') {
      return res.status(403).json({
        success: false,
        message: 'Only Secretary can access this endpoint'
      });
    }

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary must belong to a group'
      });
    }

    // Get the content
    const content = await LearnGrowContent.findByPk(id);
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get all active members in the secretary's group
    const groupMembers = await User.findAll({
      where: {
        groupId: user.groupId,
        status: 'active',
        role: 'Member'
      },
      attributes: ['id', 'name', 'phone', 'email']
    });

    // Get all progress records for this content
    const progressRecords = await TrainingProgress.findAll({
      where: {
        contentId: id,
        status: 'completed'
      },
      attributes: ['userId']
    });

    const completedUserIds = new Set(progressRecords.map(p => p.userId));

    // Find members who haven't completed
    const nonLearners = groupMembers
      .filter(member => !completedUserIds.has(member.id))
      .map(member => ({
        id: member.id,
        name: member.name,
        phone: member.phone || 'N/A',
        email: member.email || 'N/A'
      }));

    res.json({
      success: true,
      data: {
        content: {
          id: content.id,
          title: content.title,
          type: content.type,
          category: content.category
        },
        nonLearners,
        totalMembers: groupMembers.length,
        completedCount: completedUserIds.size,
        nonLearnerCount: nonLearners.length
      }
    });
  } catch (error) {
    console.error('Get non-learners error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch non-learners',
      error: error.message
    });
  }
};

/**
 * Send reminder to members to study content (for Secretary)
 * POST /api/learn-grow/:id/send-reminder
 */
const sendReminder = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberIds } = req.body; // Array of member IDs to send reminder to
    const user = req.user;

    // Only Secretary can send reminders
    if (user.role !== 'Secretary') {
      return res.status(403).json({
        success: false,
        message: 'Only Secretary can send reminders'
      });
    }

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary must belong to a group'
      });
    }

    // Get the content
    const content = await LearnGrowContent.findByPk(id);
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    // Get members to send reminder to
    let targetMembers = [];
    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      // Send to specific members
      targetMembers = await User.findAll({
        where: {
          id: { [Op.in]: memberIds },
          groupId: user.groupId,
          status: 'active',
          role: 'Member'
        },
        attributes: ['id', 'name', 'phone', 'email']
      });
    } else {
      // Send to all non-learners in the group
      const groupMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          status: 'active',
          role: 'Member'
        },
        attributes: ['id', 'name', 'phone', 'email']
      });

      const progressRecords = await TrainingProgress.findAll({
        where: {
          contentId: id,
          status: 'completed'
        },
        attributes: ['userId']
      });

      const completedUserIds = new Set(progressRecords.map(p => p.userId));
      targetMembers = groupMembers.filter(member => !completedUserIds.has(member.id));
    }

    if (targetMembers.length === 0) {
      return res.json({
        success: true,
        message: 'No members to send reminder to',
        data: { sentCount: 0 }
      });
    }

    // Prepare reminder message
    const reminderMessage = `📚 Learning Reminder\n\nYou haven't completed the training: "${content.title}"\n\n${content.description ? content.description.substring(0, 200) : 'Please complete this training to enhance your knowledge.'}\n\nVisit the Training page to access this content.`;
    
    const reminderTitle = `Complete Training: ${content.title}`;
    const reminderContent = `You haven't completed the training "${content.title}". Please visit the Training page to access and complete this content.`;

    // Send chat messages and notifications
    const chatMessages = [];
    const notifications = [];

    for (const member of targetMembers) {
      try {
        // Send chat message from Secretary to Member
        const chatMessage = await ChatMessage.create({
          groupId: user.groupId,
          senderId: user.id, // Secretary
          receiverId: member.id, // Member
          message: reminderMessage,
          type: 'text',
          fileUrl: null
        });
        chatMessages.push(chatMessage);

        // Create notification
        notifications.push({
          userId: member.id,
          type: 'training_reminder',
          channel: 'in_app',
          title: reminderTitle,
          content: reminderContent,
          status: 'sent'
        });
      } catch (error) {
        console.error(`[sendReminder] Error sending reminder to member ${member.id}:`, error);
        // Continue with other members
      }
    }

    // Bulk create notifications
    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
    }

    // Emit Socket.io events for real-time updates
    const io = req.app ? req.app.get('io') : null;
    if (io) {
      for (const member of targetMembers) {
        io.to(`user:${member.id}`).emit('training_reminder', {
          content: {
            id: content.id,
            title: content.title
          },
          message: reminderMessage
        });
        io.to(`user:${member.id}`).emit('play_notification_sound');
      }
    }

    res.json({
      success: true,
      message: `Reminder sent to ${targetMembers.length} member(s)`,
      data: {
        sentCount: targetMembers.length,
        chatMessagesCount: chatMessages.length,
        notificationsCount: notifications.length,
        members: targetMembers.map(m => ({ id: m.id, name: m.name }))
      }
    });
  } catch (error) {
    console.error('Send reminder error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send reminder',
      error: error.message
    });
  }
};

module.exports = {
  createContent,
  getContent,
  getContentById,
  updateContent,
  deleteContent,
  getMemberProgress,
  updateTrainingProgress,
  getAgentTrainingProgress,
  getNonLearners,
  sendReminder
};

