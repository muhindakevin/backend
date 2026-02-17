const { Announcement, Group, User, Document } = require('../models');
const { Op } = require('sequelize');

/**
 * Create announcement (System Admin special endpoint)
 * POST /api/announcements/system-admin
 */
const createSystemAdminAnnouncement = async (req, res) => {
  try {
    const { title, content, priority, type, targetType, targetGroups, targetRoles } = req.body;
    const createdBy = req.user.id;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required'
      });
    }

    if (req.user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Only System Admins can use this endpoint'
      });
    }

    const { Notification, ChatMessage } = require('../models');
    let allRecipients = [];

    // Determine recipients based on targetType
    if (targetType === 'All') {
      // Get all active users
      allRecipients = await User.findAll({
        where: { status: 'active' },
        attributes: ['id', 'groupId']
      });
    } else if (targetType === 'Groups' && targetGroups && targetGroups.length > 0) {
      // Get users from selected groups
      allRecipients = await User.findAll({
        where: {
          groupId: { [Op.in]: targetGroups },
          status: 'active'
        },
        attributes: ['id', 'groupId']
      });
    } else if (targetType === 'Roles' && targetRoles && targetRoles.length > 0) {
      // Get users with selected roles
      allRecipients = await User.findAll({
        where: {
          role: { [Op.in]: targetRoles },
          status: 'active'
        },
        attributes: ['id', 'groupId']
      });
    } else {
      // Default: send to all if no specific target
      allRecipients = await User.findAll({
        where: { status: 'active' },
        attributes: ['id', 'groupId']
      });
    }

    // Create announcements for each group (or one system-wide if All)
    const createdAnnouncements = [];
    let groupIds = [];
    
    if (targetType === 'Groups' && targetGroups && targetGroups.length > 0) {
      groupIds = targetGroups;
    } else if (targetType === 'Roles' && targetRoles && targetRoles.length > 0) {
      // Get unique group IDs from recipients
      groupIds = [...new Set(allRecipients.map(u => u.groupId).filter(Boolean))];
    } else if (targetType === 'All') {
      // For "All", get all groups and create announcement for each group
      const { Group } = require('../models');
      const allGroups = await Group.findAll({
        attributes: ['id']
      });
      groupIds = allGroups.map(g => g.id);
    } else {
      // Fallback: get unique group IDs from recipients
      groupIds = [...new Set(allRecipients.map(u => u.groupId).filter(Boolean))];
    }

    // Create announcement for each group
    if (groupIds.length > 0) {
      for (const groupId of groupIds) {
        const announcement = await Announcement.create({
          groupId,
          title,
          content,
          priority: priority || 'medium',
          type: type || 'General',
          createdBy,
          status: 'sent',
          sentAt: new Date()
        });
        createdAnnouncements.push(announcement);
      }
    } else {
      // If no groups found, create a system-wide announcement (groupId = null)
      // This should only happen if there are no groups in the system
      const announcement = await Announcement.create({
        groupId: null,
        title,
        content,
        priority: priority || 'medium',
        type: type || 'General',
        createdBy,
        status: 'sent',
        sentAt: new Date()
      });
      createdAnnouncements.push(announcement);
    }

    // Create notifications for all recipients
    const notifications = allRecipients.map(user => ({
      userId: user.id,
      type: 'announcement',
      channel: 'in_app',
      title: `New Announcement: ${title}`,
      content: content.substring(0, 200),
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    if (notifications.length > 0) {
      await Notification.bulkCreate(notifications);
      console.log(`[createSystemAdminAnnouncement] Created ${notifications.length} notifications`);
    }

    // Add to group chats if applicable
    for (const announcement of createdAnnouncements) {
      if (announcement.groupId) {
        try {
          await ChatMessage.create({
            groupId: announcement.groupId,
            senderId: createdBy,
            message: `📢 ${announcement.title}\n\n${announcement.content}`,
            type: 'system'
          });
        } catch (chatError) {
          console.error('[createSystemAdminAnnouncement] Error adding to group chat:', chatError);
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `Announcement created and sent to ${allRecipients.length} recipients`,
      data: {
        announcements: createdAnnouncements,
        recipientsCount: allRecipients.length
      }
    });
  } catch (error) {
    console.error('[createSystemAdminAnnouncement] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement',
      error: error.message
    });
  }
};

/**
 * Create announcement
 * POST /api/announcements
 */
const createAnnouncement = async (req, res) => {
  try {
    const { groupId, title, content, priority } = req.body;
    const createdBy = req.user.id;

    if (!groupId || !title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Group ID, title, and content are required'
      });
    }

    // If sendToGroup is true, create and send immediately
    const { sendToGroup } = req.body;
    const status = sendToGroup ? 'sent' : 'draft';

    const announcement = await Announcement.create({
      groupId,
      title,
      content,
      priority: priority || 'medium',
      createdBy,
      status: status
    });

    // Auto-create document for announcement
    setImmediate(async () => {
      try {
        const creator = await User.findByPk(createdBy);
        await Document.create({
          groupId,
          title: `Announcement: ${announcement.title}`,
          description: `Announcement created on ${new Date().toLocaleDateString()}. ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`,
          fileUrl: `/announcements/${announcement.id}`,
          fileName: `announcement-${announcement.id}.txt`,
          fileType: 'txt',
          category: 'announcement',
          uploadedBy: createdBy,
          uploadedByRole: creator?.role || 'Secretary',
          referenceType: 'Announcement',
          referenceId: announcement.id,
          status: 'active'
        });
        console.log(`[createAnnouncement] Auto-created document for announcement ${announcement.id}`);
      } catch (docError) {
        console.error('[createAnnouncement] Error creating document:', docError);
        // Don't fail the request if document creation fails
      }
    });

    // If sendToGroup is true, send notifications immediately
    if (sendToGroup) {
      try {
        const { Notification, ChatMessage } = require('../models');
        
        // Get all active group members
        const groupMembers = await User.findAll({
          where: {
            groupId: announcement.groupId,
            status: 'active'
          },
          attributes: ['id']
        });

        // Create notifications for all members
        const notifications = groupMembers.map(member => ({
          userId: member.id,
          type: 'announcement',
          channel: 'in_app',
          title: `New Announcement: ${announcement.title}`,
          content: announcement.content.substring(0, 200),
          status: 'sent'
        }));

        if (notifications.length > 0) {
          await Notification.bulkCreate(notifications);
          console.log(`[createAnnouncement] Created ${notifications.length} notifications`);
        }

        // Add to group chat
        try {
          await ChatMessage.create({
            groupId: announcement.groupId,
            senderId: createdBy,
            message: `📢 ${announcement.title}\n\n${announcement.content}`,
            type: 'system'
          });
        } catch (chatError) {
          console.error('[createAnnouncement] Error adding to group chat:', chatError);
        }

        announcement.sentAt = new Date();
        await announcement.save();
      } catch (notificationError) {
        console.error('[createAnnouncement] Error sending notifications:', notificationError);
        // Don't fail the request if notifications fail
      }
    }

    res.status(201).json({
      success: true,
      message: sendToGroup ? 'Announcement created and sent successfully' : 'Announcement created successfully',
      data: announcement
    });
  } catch (error) {
    console.error('Create announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement',
      error: error.message
    });
  }
};

/**
 * Get announcements
 * GET /api/announcements
 */
const getAnnouncements = async (req, res) => {
  try {
    const { groupId, status } = req.query;
    const user = req.user;

    let whereClause = {};

    // Determine groupId to filter by
    let targetGroupId = null;
    
    if (groupId) {
      // If groupId is provided in query, use it (but verify user has access)
      targetGroupId = parseInt(groupId);
      
      // Verify user belongs to this group (for security)
      if (user.groupId && parseInt(user.groupId) !== targetGroupId) {
        // Only allow if user is Agent or System Admin
        if (user.role !== 'Agent' && user.role !== 'System Admin') {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only view announcements for your own group.'
          });
        }
      }
    } else if (user.groupId) {
      // Use user's groupId if no groupId provided in query
      targetGroupId = parseInt(user.groupId);
    }

    // System Admin can see all announcements (no groupId filter)
    if (user.role === 'System Admin') {
      // Don't filter by groupId for System Admin - they see everything
      // But still respect status filter if provided
    } else if (targetGroupId) {
      whereClause.groupId = targetGroupId;
    } else {
      // If no groupId available, return empty for Members/Group Admins
      if (user.role === 'Member' || user.role === 'Group Admin') {
        return res.json({
          success: true,
          data: []
        });
      }
    }

    // Filter by status if provided
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    // Filter by targeted if provided (for Targeted tab)
    const { targeted } = req.query;
    if (targeted === 'true') {
      // Targeted announcements are those sent to specific groups (not all)
      // This means groupId is not null
      if (user.role === 'System Admin') {
        whereClause.groupId = { [Op.ne]: null };
      }
    }

    console.log(`[getAnnouncements] Fetching announcements for groupId: ${targetGroupId || 'all'}, status: ${status || 'all'}, user role: ${user.role}`);

    const announcements = await Announcement.findAll({
      where: whereClause,
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'], required: false },
        { association: 'creator', attributes: ['id', 'name'], required: false }
      ],
      order: [['createdAt', 'DESC']]
    });

    console.log(`[getAnnouncements] Found ${announcements.length} announcements for group ${targetGroupId}`);

    // Clean announcement content - remove metadata
    const cleanedAnnouncements = announcements.map(announcement => {
      const annData = announcement.toJSON();
      let cleanContent = annData.content || '';
      // Remove metadata markers
      cleanContent = cleanContent.replace(/\[VOTE_METADATA_START\].*?\[VOTE_METADATA_END\]/s, '');
      cleanContent = cleanContent.replace(/<!-- METADATA:.*?-->/s, '');
      cleanContent = cleanContent.trim();
      annData.content = cleanContent;
      return annData;
    });

    res.json({
      success: true,
      data: cleanedAnnouncements
    });
  } catch (error) {
    console.error('Get announcements error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements',
      error: error.message
    });
  }
};

/**
 * Send announcement
 * PUT /api/announcements/:id/send
 */
const sendAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { Notification, ChatMessage } = require('../models');

    const announcement = await Announcement.findByPk(id, {
      include: [{ association: 'group' }]
    });

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    // Verify user has permission to send this announcement
    const user = req.user;
    if (user.role === 'Group Admin' && user.groupId !== announcement.groupId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only send announcements for your own group.'
      });
    }

    // Clean announcement content before sending
    let cleanContent = announcement.content || '';
    cleanContent = cleanContent.replace(/\[VOTE_METADATA_START\].*?\[VOTE_METADATA_END\]/s, '');
    cleanContent = cleanContent.replace(/<!-- METADATA:.*?-->/s, '');
    cleanContent = cleanContent.trim();
    
    // Update announcement with cleaned content
    announcement.content = cleanContent;
    announcement.status = 'sent';
    announcement.sentAt = new Date();
    await announcement.save();

    // Auto-create or update document for announcement
    setImmediate(async () => {
      try {
        const existingDoc = await Document.findOne({
          where: {
            referenceType: 'Announcement',
            referenceId: announcement.id
          }
        });

        if (existingDoc) {
          // Update existing document
          existingDoc.title = `Announcement: ${announcement.title}`;
          existingDoc.description = `Announcement sent on ${new Date().toLocaleDateString()}. ${cleanContent.substring(0, 200)}${cleanContent.length > 200 ? '...' : ''}`;
          await existingDoc.save();
        } else {
          // Create new document
          const creator = await User.findByPk(user.id);
          await Document.create({
            groupId: announcement.groupId,
            title: `Announcement: ${announcement.title}`,
            description: `Announcement sent on ${new Date().toLocaleDateString()}. ${cleanContent.substring(0, 200)}${cleanContent.length > 200 ? '...' : ''}`,
            fileUrl: `/announcements/${announcement.id}`,
            fileName: `announcement-${announcement.id}.txt`,
            fileType: 'txt',
            category: 'announcement',
            uploadedBy: user.id,
            uploadedByRole: creator?.role || 'Secretary',
            referenceType: 'Announcement',
            referenceId: announcement.id,
            status: 'active'
          });
        }
        console.log(`[sendAnnouncement] Auto-created/updated document for announcement ${announcement.id}`);
      } catch (docError) {
        console.error('[sendAnnouncement] Error creating document:', docError);
        // Don't fail the request if document creation fails
      }
    });

    // Send notifications to all active group members
    try {
      const groupMembers = await User.findAll({
        where: {
          groupId: announcement.groupId,
          status: 'active'
        },
        attributes: ['id']
      });

      console.log(`[sendAnnouncement] Sending notifications to ${groupMembers.length} group members`);

      // Create notifications for all members (use cleaned content)
      const notifications = groupMembers.map(member => ({
        userId: member.id,
        type: 'announcement',
        channel: 'in_app',
        title: `New Announcement: ${announcement.title}`,
        content: cleanContent.substring(0, 200), // First 200 chars of cleaned content
        status: 'sent'
      }));

      if (notifications.length > 0) {
        await Notification.bulkCreate(notifications);
        console.log(`[sendAnnouncement] Created ${notifications.length} notifications`);
      }

      // Also send a system message to group chat (use cleaned content)
      try {
        await ChatMessage.create({
          groupId: announcement.groupId,
          senderId: user.id,
          message: `📢 ${announcement.title}\n\n${cleanContent}`,
          type: 'system'
        });
        console.log(`[sendAnnouncement] Added announcement to group chat`);
      } catch (chatError) {
        console.error('[sendAnnouncement] Error adding to group chat:', chatError);
        // Don't fail the request if chat message fails
      }
    } catch (notificationError) {
      console.error('[sendAnnouncement] Error sending notifications:', notificationError);
      // Don't fail the request if notifications fail
    }

    res.json({
      success: true,
      message: 'Announcement sent successfully to all group members',
      data: announcement
    });
  } catch (error) {
    console.error('Send announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send announcement',
      error: error.message
    });
  }
};

/**
 * Update announcement
 * PUT /api/announcements/:id
 */
const updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, priority, status } = req.body;
    const user = req.user;

    const announcement = await Announcement.findByPk(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    // Verify user has permission to update this announcement
    if (user.groupId && announcement.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update announcements for your own group.'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can update announcements.'
      });
    }

    // Update fields
    if (title) announcement.title = title;
    if (content !== undefined) announcement.content = content;
    if (priority) announcement.priority = priority;
    if (status) announcement.status = status;

    await announcement.save();

    res.json({
      success: true,
      message: 'Announcement updated successfully',
      data: announcement
    });
  } catch (error) {
    console.error('Update announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update announcement',
      error: error.message
    });
  }
};

/**
 * Delete announcement
 * DELETE /api/announcements/:id
 */
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const announcement = await Announcement.findByPk(id);

    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    // Verify user has permission to delete this announcement
    if (user.groupId && announcement.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete announcements for your own group.'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can delete announcements.'
      });
    }

    await announcement.destroy();

    res.json({
      success: true,
      message: 'Announcement deleted successfully'
    });
  } catch (error) {
    console.error('Delete announcement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete announcement',
      error: error.message
    });
  }
};

/**
 * Get announcement summary statistics
 * GET /api/announcements/summary
 */
const getAnnouncementSummary = async (req, res) => {
  try {
    const user = req.user;
    let groupId = null;

    if (user.groupId) {
      groupId = parseInt(user.groupId);
    } else if (user.role === 'System Admin' || user.role === 'Agent') {
      // Admins can see all, but for now return empty if no groupId
      return res.json({
        success: true,
        data: {
          total: 0,
          published: 0,
          drafts: 0,
          activeNotices: 0
        }
      });
    } else {
      return res.json({
        success: true,
        data: {
          total: 0,
          published: 0,
          drafts: 0,
          activeNotices: 0
        }
      });
    }

    const whereClause = { groupId };

    // Get total announcements (all announcements made for this group)
    const total = await Announcement.count({ 
      where: whereClause 
    });

    // Get published/sent announcements
    const published = await Announcement.count({
      where: {
        ...whereClause,
        status: 'sent'
      }
    });

    // Get draft announcements
    const drafts = await Announcement.count({
      where: {
        ...whereClause,
        status: 'draft'
      }
    });

    // Active notices = sent announcements (same as published)
    const activeNotices = published;

    console.log(`[getAnnouncementSummary] Group ${groupId}: Total=${total}, Published=${published}, Drafts=${drafts}, ActiveNotices=${activeNotices}`);

    res.json({
      success: true,
      data: {
        total,
        published,
        drafts,
        activeNotices
      }
    });
  } catch (error) {
    console.error('Get announcement summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcement summary',
      error: error.message
    });
  }
};

module.exports = {
  createAnnouncement,
  createSystemAdminAnnouncement,
  getAnnouncements,
  sendAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementSummary
};

