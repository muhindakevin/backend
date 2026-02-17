const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { Notification } = require('../models');
const { Op } = require('sequelize');

/**
 * Get user notifications
 * GET /api/notifications
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const { read, type, limit = 50 } = req.query;
    const userId = req.user.id;

    let whereClause = { 
      userId,
      // Only return in-app notifications, filter out email/SMS notifications
      [Op.or]: [
        { channel: 'in_app' },
        { channel: null } // Legacy notifications without channel
      ]
    };

    if (read !== undefined) {
      whereClause.read = read === 'true';
    }

    if (type && type !== 'all') {
      whereClause.type = type;
    }

    const notifications = await Notification.findAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });

    // Helper function to strip HTML from notification content
    const stripHtml = (html) => {
      if (!html || typeof html !== 'string') return html || ''
      
      let text = html
      
      // Convert line breaks
      text = text.replace(/<br\s*\/?>/gi, '\n')
      text = text.replace(/<\/p>/gi, '\n')
      text = text.replace(/<\/div>/gi, '\n')
      text = text.replace(/<\/h[1-6]>/gi, '\n')
      
      // Remove script and style tags
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      
      // Remove all HTML tags
      text = text.replace(/<[^>]+>/g, '')
      
      // Decode HTML entities
      text = text.replace(/&nbsp;/g, ' ')
      text = text.replace(/&amp;/g, '&')
      text = text.replace(/&lt;/g, '<')
      text = text.replace(/&gt;/g, '>')
      text = text.replace(/&quot;/g, '"')
      text = text.replace(/&#39;/g, "'")
      text = text.replace(/&apos;/g, "'")
      
      // Clean up whitespace but preserve line breaks
      text = text.replace(/[ \t]+/g, ' ')
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n')
      text = text.trim()
      
      return text
    }

    // Clean HTML from notifications before sending
    const cleanedNotifications = notifications.map(notification => {
      const notificationData = notification.toJSON ? notification.toJSON() : notification
      
      // Clean content and title if they contain HTML
      if (notificationData.content && notificationData.content.includes('<')) {
        const cleaned = stripHtml(notificationData.content)
        // If cleaned content is empty or too short, provide a fallback
        notificationData.content = cleaned || 'Notification content'
      }
      if (notificationData.title && notificationData.title.includes('<')) {
        const cleaned = stripHtml(notificationData.title)
        notificationData.title = cleaned || 'Notification'
      }
      
      return notificationData
    })

    res.json({
      success: true,
      data: cleanedNotifications
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
});

/**
 * Create notification
 * POST /api/notifications
 * IMPORTANT: This route must come BEFORE parameterized routes like /:id/read
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { userId, type, channel, title, content, recipient, status } = req.body;
    const user = req.user;

    // Validate required fields
    if (!userId || !title || !content) {
      return res.status(400).json({
        success: false,
        message: 'userId, title, and content are required'
      });
    }

    // Check permissions: Users can only create notifications for themselves unless they're admins
    if (user.role === 'Member' && parseInt(userId) !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Members can only create notifications for themselves.'
      });
    }

    // For Group Admin, Secretary, Cashier: can create notifications for their group members
    if (['Group Admin', 'Secretary', 'Cashier'].includes(user.role)) {
      if (user.groupId) {
        const { User } = require('../models');
        const targetUser = await User.findByPk(parseInt(userId));
        if (!targetUser || targetUser.groupId !== user.groupId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only create notifications for members in your group.'
          });
        }
      }
    }

    const notification = await Notification.create({
      userId: parseInt(userId),
      type: type || 'general',
      channel: channel || 'in_app',
      title,
      content,
      recipient: recipient || null,
      status: status || 'sent'
    });

    res.status(201).json({
      success: true,
      message: 'Notification created successfully',
      data: notification
    });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create notification',
      error: error.message
    });
  }
});

/**
 * Send bulk notifications to multiple users
 * POST /api/notifications/bulk
 * IMPORTANT: This route must come BEFORE parameterized routes
 */
router.post('/bulk', authenticate, async (req, res) => {
  try {
    const { userIds, type, channel, title, content, recipient } = req.body;
    const user = req.user;

    // Validate required fields
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userIds array is required and must not be empty'
      });
    }

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'title and content are required'
      });
    }

    // For Group Admin, Secretary, Cashier: can only send to their group members
    if (['Group Admin', 'Secretary', 'Cashier'].includes(user.role)) {
      if (user.groupId) {
        const { User } = require('../models');
        const targetUsers = await User.findAll({
          where: {
            id: userIds.map(id => parseInt(id)),
            groupId: user.groupId
          },
          attributes: ['id']
        });

        if (targetUsers.length !== userIds.length) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You can only send notifications to members in your group.'
          });
        }
      }
    }

    // Create notifications for all users
    const notifications = userIds.map(userId => ({
      userId: parseInt(userId),
      type: type || 'general',
      channel: channel || 'in_app',
      title,
      content,
      recipient: recipient || null,
      status: 'sent'
    }));

    const createdNotifications = await Notification.bulkCreate(notifications);

    res.status(201).json({
      success: true,
      message: `Notifications sent successfully to ${createdNotifications.length} users`,
      data: { count: createdNotifications.length, notifications: createdNotifications }
    });
  } catch (error) {
    console.error('Bulk notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk notifications',
      error: error.message
    });
  }
});

/**
 * Get sent notifications (notifications sent by current user to others)
 * GET /api/notifications/sent
 */
router.get('/sent', authenticate, async (req, res) => {
  try {
    const { User, Notification } = require('../models');
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    // For Cashier, Secretary, Group Admin: get notifications sent to their group members
    if (['Group Admin', 'Secretary', 'Cashier'].includes(user.role) && user.groupId) {
      const groupMembers = await User.findAll({
        where: {
          groupId: user.groupId,
          status: 'active'
        },
        attributes: ['id']
      });

      const memberIds = groupMembers.map(m => m.id);

      const sentNotifications = await Notification.findAll({
        where: {
          userId: { [require('sequelize').Op.in]: memberIds }
        },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'email']
        }],
        order: [['createdAt', 'DESC']],
        limit: 100
      });

      res.json({
        success: true,
        data: sentNotifications
      });
    } else {
      res.json({
        success: true,
        data: []
      });
    }
  } catch (error) {
    console.error('Get sent notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sent notifications',
      error: error.message
    });
  }
});

/**
 * Mark all notifications as read
 * PUT /api/notifications/mark-all-read
 * IMPORTANT: This route must come BEFORE /:id/read to avoid route conflicts
 */
router.put('/mark-all-read', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;

    const updated = await Notification.update(
      { 
        read: true,
        readAt: new Date()
      },
      { 
        where: { 
          userId,
          read: false
        } 
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read',
      data: { updatedCount: updated[0] }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read',
      error: error.message
    });
  }
});

/**
 * Mark notification as read
 * PUT /api/notifications/:id/read
 */
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Validate ID is a number (not a string like "mark-all-read")
    if (isNaN(parseInt(id))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID'
      });
    }

    const notification = await Notification.findByPk(id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    if (notification.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    notification.read = true;
    notification.readAt = new Date();
    await notification.save();

    res.json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update notification',
      error: error.message
    });
  }
});

/**
 * Clean up HTML content from notifications (utility endpoint)
 * PUT /api/notifications/cleanup-html
 * This removes HTML tags from notification content
 */
router.put('/cleanup-html', authenticate, async (req, res) => {
  try {
    const { Notification } = require('../models');
    const userId = req.user.id;
    
    // Only allow System Admin or Agent to run cleanup
    if (!['System Admin', 'Agent'].includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only System Admins and Agents can run cleanup.'
      });
    }
    
    // Helper function to strip HTML
    const stripHtml = (html) => {
      if (!html || typeof html !== 'string') return html || ''
      
      let text = html
      
      // Convert line breaks
      text = text.replace(/<br\s*\/?>/gi, '\n')
      text = text.replace(/<\/p>/gi, '\n')
      text = text.replace(/<\/div>/gi, '\n')
      text = text.replace(/<\/h[1-6]>/gi, '\n')
      
      // Remove script and style tags
      text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      
      // Remove all HTML tags
      text = text.replace(/<[^>]+>/g, '')
      
      // Decode HTML entities
      text = text.replace(/&nbsp;/g, ' ')
      text = text.replace(/&amp;/g, '&')
      text = text.replace(/&lt;/g, '<')
      text = text.replace(/&gt;/g, '>')
      text = text.replace(/&quot;/g, '"')
      text = text.replace(/&#39;/g, "'")
      text = text.replace(/&apos;/g, "'")
      
      // Clean up whitespace
      text = text.replace(/[ \t]+/g, ' ')
      text = text.replace(/\n\s*\n\s*\n/g, '\n\n')
      text = text.trim()
      
      return text
    }
    
    // Find all notifications with HTML content
    const allNotifications = await Notification.findAll({
      where: {
        channel: { [Op.or]: ['in_app', null] }
      }
    });
    
    let cleanedCount = 0;
    const updates = [];
    
    for (const notification of allNotifications) {
      const originalContent = notification.content || '';
      const originalTitle = notification.title || '';
      
      // Check if content contains HTML
      if (originalContent.includes('<') && originalContent.includes('>')) {
        const cleanedContent = stripHtml(originalContent);
        const cleanedTitle = stripHtml(originalTitle);
        
        if (cleanedContent !== originalContent || cleanedTitle !== originalTitle) {
          updates.push({
            id: notification.id,
            content: cleanedContent,
            title: cleanedTitle
          });
          cleanedCount++;
        }
      }
    }
    
    // Update notifications in batches
    for (const update of updates) {
      await Notification.update(
        { content: update.content, title: update.title },
        { where: { id: update.id } }
      );
    }
    
    res.json({
      success: true,
      message: `Cleaned up ${cleanedCount} notifications with HTML content`,
      data: { cleanedCount, totalChecked: allNotifications.length }
    });
  } catch (error) {
    console.error('Cleanup HTML error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup HTML from notifications',
      error: error.message
    });
  }
});

/**
 * Get secretary notifications with categories
 * GET /api/notifications/secretary/categorized
 */
router.get('/secretary/categorized', authenticate, async (req, res) => {
  try {
    const { User, Notification, Announcement } = require('../models');
    const user = req.user;

    if (user.role !== 'Secretary' || !user.groupId) {
      return res.json({
        success: true,
        data: {
          alerts: [],
          notifications: [],
          summary: {
            unreadAlerts: 0,
            sentNotifications: 0,
            memberAlerts: 0,
            meetingAlerts: 0
          }
        }
      });
    }

    // Get all group members (to find notifications sent to them)
    const groupMembers = await User.findAll({
      where: {
        groupId: user.groupId,
        status: 'active'
      },
      attributes: ['id', 'name', 'role']
    });

    const memberIds = groupMembers.map(m => m.id);

    // Get Group Admin and Cashier IDs in this group
    const groupAdmins = groupMembers.filter(m => m.role === 'Group Admin').map(m => m.id);
    const cashiers = groupMembers.filter(m => m.role === 'Cashier').map(m => m.id);
    const senderIds = [...groupAdmins, ...cashiers];

    // First, get all notifications for the secretary (same as dropdown uses)
    const secretaryNotifications = await Notification.findAll({
      where: {
        userId: user.id,
        [Op.or]: [
          { channel: 'in_app' },
          { channel: null } // Legacy notifications without channel
        ]
      },
      order: [['createdAt', 'DESC']],
      limit: 500
    });

    // Also get notifications sent to group members (to see what Group Admin/Cashier sent)
    const groupNotifications = await Notification.findAll({
      where: {
        userId: { [Op.in]: memberIds },
        [Op.or]: [
          { channel: 'in_app' },
          { channel: null }
        ]
      },
      include: [{
        model: User,
        as: 'user',
        attributes: ['id', 'name', 'role', 'phone', 'email']
      }],
      order: [['createdAt', 'DESC']],
      limit: 500
    });

    // Combine both sets, removing duplicates
    const notificationMap = new Map();
    
    // Add secretary's own notifications
    secretaryNotifications.forEach(notif => {
      const notifData = notif.toJSON ? notif.toJSON() : notif;
      notificationMap.set(notifData.id, notifData);
    });
    
    // Add group notifications (these are sent to members, but secretary should see them too)
    groupNotifications.forEach(notif => {
      const notifData = notif.toJSON ? notif.toJSON() : notif;
      if (!notificationMap.has(notifData.id)) {
        notificationMap.set(notifData.id, notifData);
      }
    });

    const allNotifications = Array.from(notificationMap.values());

    // Fetch all announcements for the group
    const announcements = await Announcement.findAll({
      where: {
        groupId: user.groupId
      },
      include: [{
        association: 'creator',
        attributes: ['id', 'name', 'role']
      }],
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    // Helper function to strip HTML
    const stripHtml = (html) => {
      if (!html || typeof html !== 'string') return html || '';
      let text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
      return text;
    };

    // Categorize notifications
    const categorizeNotification = (notif) => {
      const type = notif.type || 'general';
      
      if (type.includes('meeting') || type === 'meeting_reminder') {
        return 'meeting';
      } else if (type.includes('loan') || type === 'loan_approval' || type === 'loan_rejection' || type === 'loan_request') {
        return 'loan';
      } else if (type.includes('contribution') || type === 'contribution_confirmation') {
        return 'contribution';
      } else if (type === 'announcement') {
        return 'announcement';
      } else if (type === 'registration' || type.includes('member')) {
        return 'member';
      } else if (type === 'fine_issued') {
        return 'fine';
      } else {
        return 'general';
      }
    };

    // Helper function to strip HTML (same as in main notifications endpoint)
    const stripHtmlForNotifications = (html) => {
      if (!html || typeof html !== 'string') return html || '';
      let text = html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
      return text;
    };

    // Process notifications (same format as dropdown uses)
    const processedNotifications = allNotifications.map(notif => {
      const notifData = notif.toJSON ? notif.toJSON() : notif;
      
      // Clean HTML (same as NotificationContext does)
      let cleanContent = notifData.content || notifData.message || '';
      if (cleanContent && cleanContent.includes('<')) {
        cleanContent = stripHtmlForNotifications(cleanContent);
      }
      if (!cleanContent || cleanContent.trim().length < 3) {
        cleanContent = 'Notification content';
      }
      
      let cleanTitle = notifData.title || 'Notification';
      if (cleanTitle && cleanTitle.includes('<')) {
        cleanTitle = stripHtmlForNotifications(cleanTitle);
      }
      if (!cleanTitle || cleanTitle.trim().length < 1) {
        cleanTitle = 'Notification';
      }

      // Determine sender based on notification type and content
      // userId in Notification is the RECIPIENT, not the sender
      let senderName = 'System';
      let senderRole = 'System';
      
      // Infer sender from notification type
      const notifType = notifData.type || '';
      if (notifType.includes('loan') && (notifType.includes('approval') || notifType.includes('rejection'))) {
        // Loan approvals/rejections typically come from Group Admin
        senderName = 'Group Admin';
        senderRole = 'Group Admin';
      } else if (notifType === 'contribution_confirmation') {
        // Contribution confirmations come from Cashier or system
        senderName = 'Cashier';
        senderRole = 'Cashier';
      } else if (notifType === 'meeting_reminder') {
        // Meeting reminders come from Group Admin or Secretary
        senderName = 'Group Admin';
        senderRole = 'Group Admin';
      } else if (notifType === 'announcement') {
        // Announcements come from Group Admin or Secretary
        senderName = 'Group Admin';
        senderRole = 'Group Admin';
      } else {
        // Default to System
        senderName = 'System';
        senderRole = 'System';
      }

      return {
        id: notifData.id,
        userId: notifData.userId, // Recipient ID
        type: notifData.type || 'general',
        category: categorizeNotification(notifData),
        title: cleanTitle,
        content: cleanContent,
        message: cleanContent, // Also include as 'message' for compatibility
        sender: senderName,
        senderRole: senderRole,
        read: notifData.read || false,
        priority: notifData.priority || 'medium',
        timestamp: notifData.createdAt || notifData.timestamp,
        createdAt: notifData.createdAt,
        timeAgo: getTimeAgo(notifData.createdAt),
        amount: notifData.amount
      };
    });

    // Process announcements
    const processedAnnouncements = announcements.map(ann => {
      const annData = ann.toJSON ? ann.toJSON() : ann;
      const cleanContent = stripHtml(annData.content || '');
      
      return {
        id: `ann_${annData.id}`,
        type: 'announcement',
        category: 'announcement',
        title: `Announcement: ${annData.title}`,
        content: cleanContent.substring(0, 200) + (cleanContent.length > 200 ? '...' : ''),
        sender: annData.creator?.name || 'Group Admin',
        senderRole: annData.creator?.role || 'Group Admin',
        read: false, // Announcements are always "unread" in alerts
        createdAt: annData.createdAt,
        timeAgo: getTimeAgo(annData.createdAt),
        announcementId: annData.id
      };
    });

    // Combine notifications and announcements
    const allAlerts = [...processedNotifications, ...processedAnnouncements]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Filter unread alerts
    const unreadAlerts = allAlerts.filter(a => !a.read);

    // Get sent notifications (notifications sent by secretary to others)
    // Since we can't track who sent notifications directly, we'll show notifications
    // that the secretary might have sent (based on type and context)
    // For now, we'll show a subset or use a different approach
    // Actually, let's get notifications sent to group members (excluding secretary's own notifications)
    const sentNotifications = processedNotifications.filter(n => {
      // Notifications sent to other group members (not to secretary herself)
      return memberIds.includes(n.userId) && n.userId !== user.id;
    }).slice(0, 50); // Limit to recent 50

    // Count by category
    const memberAlerts = allAlerts.filter(a => a.category === 'member' || a.type === 'registration').length;
    const meetingAlerts = allAlerts.filter(a => a.category === 'meeting').length;
    const loanAlerts = allAlerts.filter(a => a.category === 'loan').length;
    const contributionAlerts = allAlerts.filter(a => a.category === 'contribution').length;

    res.json({
      success: true,
      data: {
        alerts: allAlerts,
        notifications: sentNotifications,
        summary: {
          unreadAlerts: unreadAlerts.length,
          sentNotifications: sentNotifications.length,
          memberAlerts: memberAlerts,
          meetingAlerts: meetingAlerts,
          loanAlerts: loanAlerts,
          contributionAlerts: contributionAlerts
        }
      }
    });
  } catch (error) {
    console.error('Get secretary categorized notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categorized notifications',
      error: error.message
    });
  }
});

// Helper function to calculate time ago
function getTimeAgo(dateString) {
  if (!dateString) return 'Unknown';
  
  const now = new Date();
  const date = new Date(dateString);
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  return `${Math.floor(diffInSeconds / 604800)} weeks ago`;
}

module.exports = router;

