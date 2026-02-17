const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { ChatMessage, Group, User, Notification } = require('../models');
const { sendEmail } = require('../notifications/emailService');
const { Op } = require('sequelize');

/**
 * Get chat list (groups and users for the logged-in user)
 * GET /api/chat/list
 * For members: shows group chat + leaders in their group
 * For leaders: shows group chat + other leaders (same group and other groups) + members in their group
 * For admins/agents: shows all users they can chat with
 */
router.get('/list', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findByPk(userId);

    if (!user) {
      return res.json({
        success: true,
        data: []
      });
    }

    const isMember = user.role === 'Member';
    const isLeader = ['Group Admin', 'Cashier', 'Secretary'].includes(user.role);
    const isAdmin = ['System Admin', 'Agent'].includes(user.role);

    let chatList = [];
    let group = null;
    let allUsers = [];
    let leaders = [];

    // If user has a group, get group info and group chat
    if (user.groupId) {
      const groupId = parseInt(user.groupId);
      group = await Group.findByPk(groupId);
      
      // Get ALL users from the group (for group chat member count and chat list)
      // This includes Group Admin, Secretary, Cashier, and all Members
      allUsers = await User.findAll({
        where: {
          groupId: groupId,
          status: 'active'
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId'],
        order: [['name', 'ASC']] // Order by name for consistency
      });

      // Get group chat unread count (only group messages, not private)
      const groupUnreadCount = await ChatMessage.count({
        where: {
          groupId,
          senderId: { [Op.ne]: userId },
          receiverId: null, // Only group messages
          isRead: false
        }
      });

      // Get last message for group (only group messages)
      let lastGroupMessage = null;
      try {
        lastGroupMessage = await ChatMessage.findOne({
          where: { 
            groupId,
            receiverId: null // Only group messages
          },
          include: [
            { association: 'sender', attributes: ['id', 'name'], required: false }
          ],
          order: [['createdAt', 'DESC']]
        });
      } catch (msgError) {
        console.warn('[Chat] Error fetching last group message:', msgError.message);
      }

      // Add group chat FIRST (always visible if user has a group)
      if (group) {
        chatList.push({
          id: `group-${groupId}`,
          type: 'group',
          name: group.name,
          members: allUsers.length,
          lastMessage: lastGroupMessage ? {
            text: lastGroupMessage.message,
            sender: lastGroupMessage.sender?.name || 'Unknown',
            time: lastGroupMessage.createdAt
          } : null,
          unread: groupUnreadCount,
          groupId: groupId
        });
      }

      // Get leaders in the group
      // For Group Admin: include Secretary and Cashier from their SAME group
      // For Cashier: include Group Admin and Secretary from their SAME group
      // For other roles: include all leaders
      if (user.role === 'Group Admin') {
        const adminGroupId = parseInt(user.groupId);
        // Group Admin should see Secretary and Cashier from their SAME group
        leaders = allUsers.filter(u => {
          const userGroupId = parseInt(u.groupId || 0);
          return u.id !== userId && 
                 (u.role === 'Secretary' || u.role === 'Cashier') &&
                 userGroupId === adminGroupId;
        });
      } else if (user.role === 'Cashier') {
        const cashierGroupId = parseInt(user.groupId);
        // Cashier should see Group Admin and Secretary from their SAME group
        leaders = allUsers.filter(u => {
          const userGroupId = parseInt(u.groupId || 0);
          return u.id !== userId && 
                 (u.role === 'Group Admin' || u.role === 'Secretary') &&
                 userGroupId === cashierGroupId;
        });
      } else {
        leaders = allUsers.filter(u => 
          ['Group Admin', 'Cashier', 'Secretary'].includes(u.role)
        );
      }
    } else {
      // User doesn't have a group (System Admin, Agent, etc.)
      // They can still chat with leaders and other admins
      leaders = [];
    }

    // For Group Admin: Add Secretary, Cashier, ALL Members from their own group, System Admins, and Agents for help
    if (user.role === 'Group Admin' && user.groupId) {
      const adminGroupId = parseInt(user.groupId);
      
      // Get ALL Members from their SAME group only (excluding self)
      const groupMembers = allUsers.filter(u => {
        const userGroupId = parseInt(u.groupId || 0);
        return u.id !== userId && 
               u.role === 'Member' && 
               userGroupId === adminGroupId;
      });
      
      // Combine Secretary, Cashier (already in leaders) with ALL Members
      const existingIds = new Set(leaders.map(l => l.id));
      groupMembers.forEach(member => {
        if (!existingIds.has(member.id)) {
          leaders.push(member);
        }
      });
      
      // Add System Admins for help/support (all System Admins, regardless of group)
      const systemAdmins = await User.findAll({
        where: {
          role: 'System Admin',
          status: 'active',
          id: { [Op.ne]: userId }
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Add Agents for help/support (all Agents, regardless of group)
      const agents = await User.findAll({
        where: {
          role: 'Agent',
          status: 'active',
          id: { [Op.ne]: userId }
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Add System Admins and Agents to the list
      const existingAdminIds = new Set(leaders.map(l => l.id));
      systemAdmins.forEach(admin => {
        if (!existingAdminIds.has(admin.id)) {
          leaders.push(admin);
        }
      });
      agents.forEach(agent => {
        if (!existingAdminIds.has(agent.id)) {
          leaders.push(agent);
        }
      });
    }
    // For Cashier: completely rebuild leaders list from allUsers (which is already filtered to same group)
    else if (user.role === 'Cashier' && user.groupId) {
      const cashierGroupId = parseInt(user.groupId);
      // Completely rebuild leaders array from allUsers only (allUsers is already filtered to same group)
      // Include: Group Admin, Secretary, and all Members from the SAME group only
      leaders = allUsers.filter(u => {
        const userGroupId = parseInt(u.groupId || 0);
        return u.id !== userId && 
               userGroupId === cashierGroupId &&
               (u.role === 'Member' || u.role === 'Group Admin' || u.role === 'Secretary');
      });
    }
    // For other leaders (Secretary): add all members in their group to chat list
    else if (isLeader && user.groupId) {
      // Get all members in the leader's group (excluding the leader themselves)
      const groupMembers = allUsers.filter(u => 
        u.id !== userId && u.role === 'Member'
      );
      
      // Add members to the list (leaders can chat with members in their group)
      const existingLeaderIds = new Set(leaders.map(l => l.id));
      groupMembers.forEach(member => {
        if (!existingLeaderIds.has(member.id)) {
          leaders.push(member);
        }
      });
    }

    // For Agents: Show System Admins and Group Admins who have messaged them
    if (user.role === 'Agent') {
      // Get System Admins (agents can always chat with System Admins)
      const systemAdmins = await User.findAll({
        where: {
          role: 'System Admin',
          status: 'active',
          id: { [Op.ne]: userId }
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Get Group Admins who have sent messages to this agent (for support)
      const groupAdminsWhoMessaged = await ChatMessage.findAll({
        where: {
          receiverId: userId,
          senderId: { [Op.ne]: userId }
        },
        include: [
          {
            association: 'sender',
            attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId'],
            where: {
              role: 'Group Admin',
              status: 'active'
            },
            required: true
          }
        ],
        attributes: ['senderId'],
        group: ['senderId'],
        raw: true,
        nest: true
      });
      
      // Add System Admins to chat list
      systemAdmins.forEach(admin => {
        leaders.push(admin);
      });
      
      // Add Group Admins who have messaged the agent
      const existingIds = new Set(leaders.map(l => l.id));
      groupAdminsWhoMessaged.forEach(msg => {
        if (msg.sender && !existingIds.has(msg.sender.id)) {
          leaders.push(msg.sender);
        }
      });
    }
    // For System Admin: Get all Agents and Group Admins
    if (user.role === 'System Admin') {
      // Get all Agents
      const agents = await User.findAll({
        where: {
          role: 'Agent',
          status: 'active',
          id: { [Op.ne]: userId }
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Get all Group Admins
      const groupAdmins = await User.findAll({
        where: {
          role: 'Group Admin',
          status: 'active',
          id: { [Op.ne]: userId }
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Get all groups (for group chats)
      const allGroups = await Group.findAll({
        attributes: ['id', 'name', 'code']
      });
      
      // Add all groups to chat list
      for (const group of allGroups) {
        const groupUnreadCount = await ChatMessage.count({
          where: {
            groupId: group.id,
            senderId: { [Op.ne]: userId },
            receiverId: null,
            isRead: false
          }
        });
        
        const lastGroupMessage = await ChatMessage.findOne({
          where: { 
            groupId: group.id,
            receiverId: null
          },
          include: [
            { association: 'sender', attributes: ['id', 'name'], required: false }
          ],
          order: [['createdAt', 'DESC']]
        });
        
        chatList.push({
          id: `group-${group.id}`,
          type: 'group',
          name: group.name,
          members: 0, // Will be calculated if needed
          lastMessage: lastGroupMessage ? {
            text: lastGroupMessage.message,
            sender: lastGroupMessage.sender?.name || 'Unknown',
            time: lastGroupMessage.createdAt
          } : null,
          unread: groupUnreadCount,
          groupId: group.id
        });
      }
      
      // Add all agents and group admins to leaders list
      const existingLeaderIds = new Set(leaders.map(l => l.id));
      agents.forEach(agent => {
        if (!existingLeaderIds.has(agent.id)) {
          leaders.push(agent);
        }
      });
      groupAdmins.forEach(admin => {
        if (!existingLeaderIds.has(admin.id)) {
          leaders.push(admin);
        }
      });
    }
    // For Cashier, Secretary, and other admins: also get other leaders from other groups and admins
    // Group Admin already has System Admins added above, so skip this section
    // Cashier should only see members from their own group, so exclude Cashier from this section
    // Secretary should only see members from their own group, so exclude Secretary from this section
    else if (user.role !== 'Group Admin' && user.role !== 'Cashier' && user.role !== 'Secretary' && (isLeader || isAdmin)) {
      // Get other leaders from all groups
      const otherLeaders = await User.findAll({
        where: {
          role: { [Op.in]: ['Group Admin', 'Cashier', 'Secretary'] },
          status: 'active',
          id: { [Op.ne]: userId } // Exclude self
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Get System Admins and Agents (for leaders to chat with)
      const admins = await User.findAll({
        where: {
          role: { [Op.in]: ['System Admin', 'Agent'] },
          status: 'active',
          id: { [Op.ne]: userId } // Exclude self
        },
        attributes: ['id', 'name', 'phone', 'email', 'role', 'profileImage', 'groupId']
      });
      
      // Merge with existing leaders, avoiding duplicates
      const existingLeaderIds = new Set(leaders.map(l => l.id));
      otherLeaders.forEach(leader => {
        if (!existingLeaderIds.has(leader.id)) {
          leaders.push(leader);
        }
      });
      
      // Add admins to the list (leaders can chat with admins)
      admins.forEach(admin => {
        if (!existingLeaderIds.has(admin.id)) {
          leaders.push(admin);
        }
      });
    }

    // For Group Admin: Filter to ensure only valid users
    // Allow: Members, Secretary, Cashier from same group, System Admins, and Agents
    if (user.role === 'Group Admin' && user.groupId) {
      const adminGroupId = parseInt(user.groupId);
      leaders = leaders.filter(l => {
        // Allow System Admins and Agents (for help/support)
        if (l.role === 'System Admin' || l.role === 'Agent') {
          return true;
        }
        // For other users, must be from same group
        const leaderGroupId = parseInt(l.groupId || 0);
        return leaderGroupId === adminGroupId && 
               l.id !== userId &&
               (l.role === 'Member' || l.role === 'Secretary' || l.role === 'Cashier');
      });
    }

    // For Cashier: Final filter to ensure ONLY users from same group are shown
    // This is a safety check - Cashier should only see: Group chat + Secretary, Group Admin, and all Members from their own group
    if (user.role === 'Cashier' && user.groupId) {
      const cashierGroupId = parseInt(user.groupId);
      leaders = leaders.filter(l => {
        // Strictly enforce: must be from same group, must be Member/Secretary/Group Admin
        const leaderGroupId = parseInt(l.groupId || 0);
        if (leaderGroupId !== cashierGroupId) {
          return false; // Reject users from different groups
        }
        if (l.id === userId) {
          return false; // Reject self
        }
        // Only allow these roles from same group
        return ['Member', 'Secretary', 'Group Admin'].includes(l.role);
      });
    }

    // Final safety check for Cashier: ensure leaders array only contains same-group users
    if (user.role === 'Cashier' && user.groupId) {
      const cashierGroupId = parseInt(user.groupId);
      leaders = leaders.filter(l => {
        const leaderGroupId = parseInt(l.groupId || 0);
        return leaderGroupId === cashierGroupId && 
               l.id !== userId &&
               ['Member', 'Secretary', 'Group Admin'].includes(l.role);
      });
    }

    // For Secretary: Final filter to ensure ONLY users from same group are shown
    // Secretary should only see: Group chat + Group Admin, Cashier, and all Members from their own group
    if (user.role === 'Secretary' && user.groupId) {
      const secretaryGroupId = parseInt(user.groupId);
      leaders = leaders.filter(l => {
        // Strictly enforce: must be from same group, must be Member/Group Admin/Cashier
        const leaderGroupId = parseInt(l.groupId || 0);
        if (leaderGroupId !== secretaryGroupId) {
          return false; // Reject users from different groups
        }
        if (l.id === userId) {
          return false; // Reject self
        }
        // Only allow these roles from same group
        return ['Member', 'Group Admin', 'Cashier'].includes(l.role);
      });
    }

    // Add ALL leader/user/member chats (even if no messages exist yet)
    for (const leader of leaders) {
      if (leader.id === userId) continue; // Skip self
      
      // For Group Admin: Double-check that user is valid
      if (user.role === 'Group Admin' && user.groupId) {
        const adminGroupId = parseInt(user.groupId);
        const leaderGroupId = parseInt(leader.groupId || 0);
        
        // Allow System Admins and Agents (for help/support)
        if (leader.role === 'System Admin' || leader.role === 'Agent') {
          // System Admin or Agent is allowed, continue
        } else if (leaderGroupId !== adminGroupId) {
          continue; // Skip users from different groups
        } else if (!['Member', 'Secretary', 'Cashier'].includes(leader.role)) {
          continue; // Skip invalid roles (other Group Admins, etc.)
        }
      }

      // For Cashier: Strictly enforce same group and valid roles
      if (user.role === 'Cashier' && user.groupId) {
        const cashierGroupId = parseInt(user.groupId);
        const leaderGroupId = parseInt(leader.groupId || 0);
        
        // Strict check: must be from same group AND must be Member/Secretary/Group Admin
        if (leaderGroupId !== cashierGroupId) {
          continue; // Skip users from different groups
        }
        if (!['Member', 'Secretary', 'Group Admin'].includes(leader.role)) {
          continue; // Skip invalid roles (System Admin, Agent, other Cashiers, etc.)
        }
      }

      // For Secretary: Strictly enforce same group and valid roles
      if (user.role === 'Secretary' && user.groupId) {
        const secretaryGroupId = parseInt(user.groupId);
        const leaderGroupId = parseInt(leader.groupId || 0);
        
        // Strict check: must be from same group AND must be Member/Group Admin/Cashier
        if (leaderGroupId !== secretaryGroupId) {
          continue; // Skip users from different groups
        }
        if (!['Member', 'Group Admin', 'Cashier'].includes(leader.role)) {
          continue; // Skip invalid roles (System Admin, Agent, other Secretaries, etc.)
        }
      }

      let unreadCount = 0;
      try {
        // Try to count unread private messages (only if receiverId column exists)
        unreadCount = await ChatMessage.count({
          where: {
            senderId: leader.id,
            receiverId: userId,
            isRead: false
          }
        });
      } catch (countError) {
        // If receiverId column doesn't exist, set unreadCount to 0
        if (countError.message && countError.message.includes('receiverId')) {
          console.warn('[Chat] receiverId column not found, skipping unread count for private messages');
          unreadCount = 0;
        } else {
          throw countError; // Re-throw if it's a different error
        }
      }

      let lastMessage = null;
      try {
        // Try to find last private message (only if receiverId column exists)
        lastMessage = await ChatMessage.findOne({
          where: {
            [Op.or]: [
              { senderId: leader.id, receiverId: userId },
              { senderId: userId, receiverId: leader.id }
            ]
          },
          include: [
            { association: 'sender', attributes: ['id', 'name'], required: false }
          ],
          order: [['createdAt', 'DESC']]
        });
      } catch (msgError) {
        // If receiverId column doesn't exist, lastMessage will be null
        if (msgError.message && msgError.message.includes('receiverId')) {
          console.warn(`[Chat] receiverId column not found, skipping last message for leader ${leader.id}`);
          lastMessage = null;
        } else {
          console.warn(`[Chat] Error fetching last message for leader ${leader.id}:`, msgError.message);
          lastMessage = null;
        }
      }

      // Always add leader/member to chat list, even if no messages exist
      chatList.push({
        id: `user-${leader.id}`,
        type: 'private',
        name: leader.name,
        role: leader.role,
        phone: leader.phone,
        email: leader.email,
        members: 1,
        lastMessage: lastMessage ? {
          text: lastMessage.message,
          sender: lastMessage.sender?.name || 'Unknown',
          time: lastMessage.createdAt
        } : null,
        unread: unreadCount,
        receiverId: leader.id
      });
    }

    // For Group Admin: Final safety check - ensure only valid chats remain
    if (user.role === 'Group Admin' && user.groupId) {
      const adminGroupId = parseInt(user.groupId);
      
      // Get all valid user IDs from the filtered leaders array
      const validUserIds = new Set(leaders.map(l => l.id));
      
      // Build filtered chat list
      const filteredChats = [];
      for (const chat of chatList) {
        // Keep group chat (it's for their group)
        if (chat.type === 'group') {
          const chatGroupId = parseInt(chat.groupId || 0);
          if (chatGroupId === adminGroupId) {
            filteredChats.push(chat);
          }
        }
        // For private chats, check if the user ID is in our valid list
        else if (chat.type === 'private' && chat.receiverId) {
          if (validUserIds.has(chat.receiverId)) {
            const chatUser = leaders.find(l => l.id === chat.receiverId);
            if (chatUser) {
              // Allow System Admins and Agents
              if (chatUser.role === 'System Admin' || chatUser.role === 'Agent') {
                filteredChats.push(chat);
              }
              // For others, must be from same group
              else {
                const userGroupId = parseInt(chatUser.groupId || 0);
                if (userGroupId === adminGroupId && 
                    ['Member', 'Secretary', 'Cashier'].includes(chatUser.role)) {
                  filteredChats.push(chat);
                }
              }
            }
          }
        }
      }
      
      // Replace the chatList array contents
      chatList.splice(0, chatList.length, ...filteredChats);
    }

    // Sort: Group chat first, then by last message time (most recent first), then by name
    chatList.sort((a, b) => {
      // Group chat always first
      if (a.type === 'group') return -1
      if (b.type === 'group') return 1
      
      // Then by last message time (most recent first)
      if (a.lastMessage && b.lastMessage) {
        return new Date(b.lastMessage.time) - new Date(a.lastMessage.time)
      }
      if (a.lastMessage) return -1
      if (b.lastMessage) return 1
      
      // Then by role (leaders first, then members)
      const roleOrder = { 'System Admin': 1, 'Agent': 2, 'Group Admin': 3, 'Cashier': 4, 'Secretary': 5, 'Member': 6 }
      const aRoleOrder = roleOrder[a.role] || 99
      const bRoleOrder = roleOrder[b.role] || 99
      if (aRoleOrder !== bRoleOrder) {
        return aRoleOrder - bRoleOrder
      }
      
      // Finally by name
      return a.name.localeCompare(b.name)
    })

    res.json({
      success: true,
      data: chatList
    });
  } catch (error) {
    console.error('[Chat] Error fetching chat list:', error);
    console.error('[Chat] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch chat list',
      error: error.message,
      details: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

/**
 * Get chat messages for a group or private chat
 * GET /api/chat/:groupId?receiverId=X for private chat
 * GET /api/chat/:groupId for group chat
 */
router.get('/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { receiverId } = req.query;
    const userId = req.user.id;

    let whereClause = {};
    
    if (receiverId && groupId === 'user') {
      // Private chat - get messages between current user and receiver
      // This route is used when groupId is 'user' and receiverId is in query
      const parsedReceiverId = parseInt(receiverId);
      if (isNaN(parsedReceiverId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid receiverId'
        });
      }

      whereClause = {
        [Op.or]: [
          { senderId: userId, receiverId: parsedReceiverId },
          { senderId: parsedReceiverId, receiverId: userId }
        ],
        groupId: null // Private messages have no groupId
      };
    } else if (receiverId) {
      // Private chat - receiverId provided as query param
      const parsedReceiverId = parseInt(receiverId);
      if (isNaN(parsedReceiverId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid receiverId'
        });
      }

      whereClause = {
        [Op.or]: [
          { senderId: userId, receiverId: parsedReceiverId },
          { senderId: parsedReceiverId, receiverId: userId }
        ],
        groupId: null // Private messages have no groupId
      };
    } else {
      // Group chat - get all messages for the group
      const parsedGroupId = parseInt(groupId);
      if (isNaN(parsedGroupId)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid groupId'
        });
      }

      // Verify user is a member of this group (or Group Admin of this group, or System Admin)
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(403).json({
          success: false,
          message: 'User not found'
        });
      }
      
      // System Admin can access any group chat
      if (user.role === 'System Admin') {
        // Allow System Admin to access any group
      } else {
        // Allow if user is a member of this group OR if they're a Group Admin leading this group
        const userGroupId = parseInt(user.groupId || 0);
        if (userGroupId !== parsedGroupId) {
          return res.status(403).json({
            success: false,
            message: 'You are not a member of this group'
          });
        }
      }

      whereClause = { 
        groupId: parsedGroupId,
        receiverId: null // Group messages have no receiverId
      };
    }

    // Load all messages for chat history (like WhatsApp) - no limit for full history
    let messages = [];
    try {
      messages = await ChatMessage.findAll({
        where: whereClause,
        include: [
          { association: 'sender', attributes: ['id', 'name', 'phone', 'profileImage'], required: false }
        ],
        order: [['createdAt', 'ASC']], // Oldest first for chat display (chronological order)
      });
    } catch (findError) {
      console.error('[Chat] Error fetching messages:', findError);
      throw findError;
    }

    // Mark messages as read
    if (messages.length > 0) {
      const unreadIds = messages
        .filter(m => !m.isRead && m.senderId !== userId)
        .map(m => m.id);
      
      if (unreadIds.length > 0) {
        await ChatMessage.update(
          { isRead: true },
          { where: { id: { [Op.in]: unreadIds } } }
        );
      }
    }

    res.json({
      success: true,
      data: messages
    });
  } catch (error) {
    console.error('[Chat] Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: error.message
    });
  }
});

/**
 * Send private chat message
 * POST /api/chat/user
 * For private messages between users (like WhatsApp direct messages)
 */
router.post('/user', authenticate, async (req, res) => {
  try {
    const { message, type = 'text', fileUrl, recipientIds } = req.body;

    if (!message && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Message or file is required'
      });
    }

    if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length !== 1) {
      return res.status(400).json({
        success: false,
        message: 'recipientIds must be an array with exactly one user ID for private messages'
      });
    }

    const sender = await User.findByPk(req.user.id);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: 'Sender not found'
      });
    }

    const receiverId = parseInt(recipientIds[0]);
    if (isNaN(receiverId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid receiver ID'
      });
    }

    // Verify receiver exists
    const receiver = await User.findByPk(receiverId);
    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: 'Receiver not found'
      });
    }

    // Don't allow sending to yourself
    if (sender.id === receiverId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot send a message to yourself'
      });
    }

    // Validation rules for private messaging:
    // 1. Members can chat with leaders in their group
    // 2. Leaders can chat with other leaders (same group or different groups)
    // 3. System Admins/Agents can chat with anyone
    // 4. Anyone can chat with anyone (like WhatsApp) - but we'll keep some basic validation
    
    const isSenderMember = sender.role === 'Member';
    const isReceiverMember = receiver.role === 'Member';
    const isSenderLeader = ['Group Admin', 'Cashier', 'Secretary'].includes(sender.role);
    const isReceiverLeader = ['Group Admin', 'Cashier', 'Secretary'].includes(receiver.role);
    const isSenderAdmin = ['System Admin', 'Agent'].includes(sender.role);
    const isReceiverAdmin = ['System Admin', 'Agent'].includes(receiver.role);

    // Members can only chat with leaders in their group (not with other members)
    if (isSenderMember && isReceiverMember) {
      return res.status(403).json({
        success: false,
        message: 'Members cannot send private messages to other members. Use group chat instead.'
      });
    }

    // If sender is a member, they can only chat with leaders in their group
    if (isSenderMember && isReceiverLeader) {
      if (sender.groupId && receiver.groupId && sender.groupId !== receiver.groupId) {
        return res.status(403).json({
          success: false,
          message: 'You can only send private messages to leaders in your group'
        });
      }
    }

    // If sender is a leader, they can chat with members in their group
    if (isSenderLeader && isReceiverMember) {
      if (sender.groupId && receiver.groupId && sender.groupId !== receiver.groupId) {
        return res.status(403).json({
          success: false,
          message: 'You can only send private messages to members in your group'
        });
      }
    }

    // Leaders, Admins, and Agents can chat with anyone (no restrictions)
    // This allows leaders to chat with other leaders, admins, etc.

    // Create private message (NO groupId, only receiverId)
    let chatMessage;
    try {
      chatMessage = await ChatMessage.create({
        groupId: null, // Private messages don't have a groupId
        senderId: req.user.id,
        receiverId: receiverId,
        message: message || '',
        type,
        fileUrl
      });
    } catch (createError) {
      console.error('[Chat] Error creating private message:', createError);
      console.error('[Chat] Error details:', {
        groupId: null,
        senderId: req.user.id,
        receiverId: receiverId,
        message: message?.substring(0, 50),
        error: createError.message,
        sql: createError.sql
      });
      
      // If it's a database constraint error about groupId, provide helpful message
      if (createError.message && createError.message.includes('groupId') && createError.message.includes('null')) {
        return res.status(500).json({
          success: false,
          message: 'Database schema error: groupId column is not nullable. Please run the migration: node fix-chat-groupId-nullable.js',
          error: createError.message
        });
      }
      
      throw createError;
    }

    const messageWithSender = await ChatMessage.findByPk(chatMessage.id, {
      include: [
        { association: 'sender', attributes: ['id', 'name', 'phone', 'profileImage'] }
      ]
    });

    // Emit Socket.io event for real-time updates
    const io = req.app.get('io');
    if (io) {
      // Emit to the receiver
      io.to(`user:${receiverId}`).emit('new_message', {
        message: messageWithSender,
        receiverId: receiverId
      });
      // Also emit to sender so they see their own message immediately
      io.to(`user:${req.user.id}`).emit('new_message', {
        message: messageWithSender,
        receiverId: receiverId
      });
      // Play notification sound for receiver
      io.to(`user:${receiverId}`).emit('play_notification_sound');
    }

    // Create in-app notification for receiver (if offline)
    setImmediate(async () => {
      try {
        await Notification.create({
          userId: receiverId,
          type: 'chat_message',
          channel: 'in_app',
          title: `New Message from ${sender.name}`,
          content: message || 'You have a new private message',
          status: 'sent'
        });
      } catch (notifError) {
        console.error('[Chat] Error creating notification:', notifError);
      }
    });

    res.status(201).json({
      success: true,
      message: 'Private message sent successfully',
      data: messageWithSender
    });
  } catch (error) {
    console.error('[Chat] Error sending private message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send private message',
      error: error.message
    });
  }
});

/**
 * Send group chat message
 * POST /api/chat/:groupId
 * Sends message to all members in the group (group chat)
 * Note: For private messages, use POST /api/chat/user
 */
router.post('/:groupId', authenticate, async (req, res) => {
  try {
    const { groupId } = req.params;
    const { message, type = 'text', fileUrl } = req.body;

    // If groupId is 'user', redirect to private message handler
    if (groupId === 'user') {
      return res.status(400).json({
        success: false,
        message: 'Use POST /api/chat/user for private messages'
      });
    }

    if (!message && !fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'Message or file is required'
      });
    }

    const sender = await User.findByPk(req.user.id);
    if (!sender) {
      return res.status(404).json({
        success: false,
        message: 'Sender not found'
      });
    }

    // Verify sender is a member of this group
    if (sender.groupId !== parseInt(groupId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this group'
      });
    }

    // For group messages, groupId must be a valid number
    const parsedGroupId = parseInt(groupId);
    if (isNaN(parsedGroupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid groupId'
      });
    }

    // Create group message (NO receiverId - this is a group message)
    const chatMessage = await ChatMessage.create({
      groupId: parsedGroupId,
      senderId: req.user.id,
      receiverId: null, // Group messages don't have a receiverId
      message: message || '',
      type,
      fileUrl
    });

    const messageWithSender = await ChatMessage.findByPk(chatMessage.id, {
      include: [
        { association: 'sender', attributes: ['id', 'name', 'phone', 'profileImage'] }
      ]
    });

    // Emit Socket.io event for real-time updates to all group members
    const io = req.app.get('io');
    if (io) {
      // Broadcast to all members in the group
      io.to(`group:${parsedGroupId}`).emit('new_message', {
        message: messageWithSender,
        groupId: parsedGroupId
      });
      // Play notification sound for all group members except sender
      io.to(`group:${parsedGroupId}`).emit('play_notification_sound');
    }

    // Create notifications for offline group members
    setImmediate(async () => {
      try {
        // Get all active group members
        const groupMembers = await User.findAll({
          where: {
            groupId: parsedGroupId,
            status: 'active',
            id: { [Op.ne]: req.user.id } // Exclude sender
          },
          attributes: ['id', 'name', 'email']
        });

        // Create in-app notifications for offline members
        const notificationPromises = groupMembers.map(member =>
          Notification.create({
            userId: member.id,
            type: 'chat_message',
            channel: 'in_app',
            title: `New Message in Group Chat`,
            content: `${sender.name}: ${message || 'You have a new message in group chat'}`,
            status: 'sent'
          }).catch(err => {
            console.warn(`[Chat] Failed to create notification for member ${member.id}:`, err.message);
          })
        );
        await Promise.all(notificationPromises);
      } catch (notifError) {
        console.error('[Chat] Error creating group notifications:', notifError);
        // Don't fail the message send if notifications fail
      }
    });

    res.status(201).json({
      success: true,
      message: 'Group message sent successfully',
      data: messageWithSender
    });
  } catch (error) {
    console.error('[Chat] Error sending group message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send group message',
      error: error.message
    });
  }
});

module.exports = router;

