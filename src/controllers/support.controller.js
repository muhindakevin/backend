const { SupportTicket, User, Group, ChatMessage } = require('../models');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');

const listTickets = async (req, res) => {
  try {
    const where = {};
    // Members can only see their own tickets
    if (req.user.role === 'Member') {
      where.userId = req.user.id;
    }
    // Agents can only see tickets assigned to them
    else if (req.user.role === 'Agent') {
      where.assignedTo = req.user.id;
    }
    // System Admins can see all tickets
    
    const tickets = await SupportTicket.findAll({ 
      where, 
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email']
        }
      ], 
      order: [['createdAt','DESC']] 
    });
    return res.json({ success: true, data: tickets });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch tickets', error: error.message });
  }
};

const createTicket = async (req, res) => {
  try {
    const { subject, message, category, priority, userId, assignedTo, attachments } = req.body;
    if (!subject || !message) return res.status(400).json({ success: false, message: 'Subject and message are required' });
    
    // For System Admin, they can create tickets for any user
    // For other users, they can only create tickets for themselves
    let ticketUserId = req.user.id;
    if (req.user.role === 'System Admin' && userId) {
      // Verify the user exists
      const targetUser = await User.findByPk(userId);
      if (!targetUser) {
        return res.status(400).json({ success: false, message: 'User not found' });
      }
      ticketUserId = userId;
    }
    
    // If assignedTo is provided, verify it's a valid agent or system admin
    let assignedAgentId = null;
    if (assignedTo) {
      const agent = await User.findByPk(assignedTo);
      if (agent && (agent.role === 'Agent' || agent.role === 'System Admin')) {
        assignedAgentId = assignedTo;
      }
    }
    
    const ticket = await SupportTicket.create({ 
      userId: ticketUserId, 
      subject, 
      message, 
      category: category || 'other', 
      priority: priority || 'medium',
      assignedTo: assignedAgentId,
      status: 'open'
    });
    
    // Store attachments if provided (as JSON in resolution field temporarily, or create a separate table)
    // For now, we'll store it in a JSON format in a notes field if needed
    
    logAction(req.user.id, 'CREATE_TICKET', 'SupportTicket', ticket.id, { category, priority, assignedTo: assignedAgentId, userId: ticketUserId }, req);
    
    // Fetch created ticket with relations
    const createdTicket = await SupportTicket.findByPk(ticket.id, {
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    return res.json({ success: true, message: 'Ticket created successfully', data: createdTicket });
  } catch (error) {
    console.error('[createTicket] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to create ticket', error: error.message });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, resolution } = req.body;
    
    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    // Agents can only update tickets assigned to them
    if (req.user.role === 'Agent' && ticket.assignedTo !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only update tickets assigned to you' });
    }
    
    const updateData = {};
    if (status) {
      updateData.status = status;
      if (status === 'resolved' || status === 'closed') {
        updateData.resolvedAt = new Date();
      }
    }
    if (resolution) {
      updateData.resolution = resolution;
    }
    
    await ticket.update(updateData);
    logAction(req.user.id, 'UPDATE_TICKET', 'SupportTicket', ticket.id, updateData, req);
    
    // Fetch updated ticket with relations
    const updatedTicket = await SupportTicket.findByPk(id, {
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    return res.json({ success: true, message: 'Ticket updated', data: updatedTicket });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update ticket', error: error.message });
  }
};

const escalateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    // Only agents can escalate tickets
    if (req.user.role !== 'Agent') {
      return res.status(403).json({ success: false, message: 'Only agents can escalate tickets' });
    }
    
    // Verify ticket is assigned to this agent
    if (ticket.assignedTo !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only escalate tickets assigned to you' });
    }
    
    // Find a system admin to assign to
    const systemAdmin = await User.findOne({ 
      where: { role: 'System Admin', status: 'active' },
      attributes: ['id', 'name', 'email']
    });
    
    if (!systemAdmin) {
      return res.status(404).json({ success: false, message: 'No system admin available to assign ticket' });
    }
    
    // Update ticket: assign to system admin and add escalation note
    const escalationNote = `Escalated by Agent ${req.user.name}${reason ? `: ${reason}` : ''}`;
    const updatedMessage = `${ticket.message}\n\n--- ESCALATION ---\n${escalationNote}`;
    
    await ticket.update({
      assignedTo: systemAdmin.id,
      status: 'open',
      message: updatedMessage
    });
    
    logAction(req.user.id, 'ESCALATE_TICKET', 'SupportTicket', ticket.id, { 
      escalatedTo: systemAdmin.id, 
      reason 
    }, req);
    
    // Fetch updated ticket with relations
    const updatedTicket = await SupportTicket.findByPk(id, {
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email']
        }
      ]
    });
    
    return res.json({ 
      success: true, 
      message: 'Ticket escalated to system admin', 
      data: updatedTicket 
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to escalate ticket', error: error.message });
  }
};

const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const ticket = await SupportTicket.findByPk(id, {
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId','phone','profileImage'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email', 'role']
        }
      ]
    });
    
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    // Check permissions
    if (req.user.role === 'Member' && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'Agent' && ticket.assignedTo !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    
    return res.json({ success: true, data: ticket });
  } catch (error) {
    console.error('[getTicketById] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch ticket', error: error.message });
  }
};

const solveTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { solutionCategory, solutionDescription } = req.body;
    
    if (!solutionCategory || !solutionDescription) {
      return res.status(400).json({ success: false, message: 'Solution category and description are required' });
    }
    
    const ticket = await SupportTicket.findByPk(id);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    // Only System Admin and assigned agents can solve tickets
    if (req.user.role === 'Member' && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (req.user.role === 'Agent' && ticket.assignedTo !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only solve tickets assigned to you' });
    }
    
    // Update ticket with solution
    const solutionText = `[${solutionCategory}]\n${solutionDescription}`;
    await ticket.update({
      status: 'resolved',
      resolution: solutionText,
      resolvedAt: new Date()
    });
    
    logAction(req.user.id, 'SOLVE_TICKET', 'SupportTicket', ticket.id, { 
      solutionCategory, 
      solutionDescription,
      resolvedAt: new Date()
    }, req);
    
    // Fetch updated ticket with relations
    const updatedTicket = await SupportTicket.findByPk(id, {
      include: [
        { 
          model: User, 
          as: 'user', 
          attributes: ['id','name','email','role','groupId','phone','profileImage'],
          include: [
            {
              model: Group,
              as: 'group',
              attributes: ['id', 'name', 'code']
            }
          ]
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email', 'role']
        }
      ]
    });
    
    return res.json({ success: true, message: 'Ticket solved successfully', data: updatedTicket });
  } catch (error) {
    console.error('[solveTicket] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to solve ticket', error: error.message });
  }
};

const getFAQs = async (req, res) => {
  try {
    // Get resolved tickets from the last 90 days, grouped by subject
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const resolvedTickets = await SupportTicket.findAll({
      where: {
        status: ['resolved', 'closed'],
        resolvedAt: {
          [Op.gte]: ninetyDaysAgo
        },
        resolution: {
          [Op.ne]: null
        }
      },
      order: [['resolvedAt', 'DESC']],
      limit: 100 // Get recent resolved tickets
    });
    
    // Normalize question text for better deduplication
    const normalizeQuestion = (text) => {
      return text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .replace(/^(how|what|when|where|why|can|do|does|is|are|will|would|should)\s+/i, '') // Remove common question starters
        .trim();
    };
    
    // Group tickets by normalized subject (question) only - no duplicates
    const faqMap = new Map();
    const categoryCounts = new Map(); // Track category frequency per question
    
    resolvedTickets.forEach(ticket => {
      const normalizedKey = normalizeQuestion(ticket.subject);
      
      if (!faqMap.has(normalizedKey)) {
        faqMap.set(normalizedKey, {
          question: ticket.subject, // Keep original question text
          answer: ticket.resolution || ticket.message,
          category: ticket.category,
          count: 0,
          lastResolved: ticket.resolvedAt,
          categories: new Map() // Track all categories for this question
        });
        categoryCounts.set(normalizedKey, new Map());
      }
      
      const faq = faqMap.get(normalizedKey);
      const catCounts = categoryCounts.get(normalizedKey);
      
      faq.count += 1;
      
      // Track category frequency
      if (!catCounts.has(ticket.category)) {
        catCounts.set(ticket.category, 0);
      }
      catCounts.set(ticket.category, catCounts.get(ticket.category) + 1);
      faq.categories.set(ticket.category, catCounts.get(ticket.category));
      
      // Update to most recent resolution if this ticket is newer
      if (new Date(ticket.resolvedAt) > new Date(faq.lastResolved)) {
        faq.answer = ticket.resolution || ticket.message;
        faq.lastResolved = ticket.resolvedAt;
      }
      
      // Update question to the most common version (longest/original)
      if (ticket.subject.length > faq.question.length) {
        faq.question = ticket.subject;
      }
    });
    
    // Determine the most common category for each FAQ
    faqMap.forEach((faq, key) => {
      const catCounts = categoryCounts.get(key);
      let maxCount = 0;
      let mostCommonCategory = faq.category;
      
      catCounts.forEach((count, category) => {
        if (count > maxCount) {
          maxCount = count;
          mostCommonCategory = category;
        }
      });
      
      faq.category = mostCommonCategory;
    });
    
    // Convert map to array and sort by count (most asked first), then by date
    const faqs = Array.from(faqMap.values())
      .sort((a, b) => {
        // First sort by count (frequency)
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        // Then by most recent
        return new Date(b.lastResolved) - new Date(a.lastResolved);
      })
      .slice(0, 50) // Limit to top 50 FAQs
      .map((faq, index) => ({
        id: `FAQ${String(index + 1).padStart(3, '0')}`,
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
        frequency: faq.count,
        lastUpdated: faq.lastResolved
      }));
    
    // Return FAQs - empty array if no resolved tickets
    return res.json({ success: true, data: faqs });
  } catch (error) {
    console.error('[getFAQs] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch FAQs', error: error.message });
  }
};

const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Reply message is required' });
    }
    
    const ticket = await SupportTicket.findByPk(id, {
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'email', 'role']
        },
        {
          model: User,
          as: 'assignedAgent',
          attributes: ['id', 'name', 'email', 'role']
        }
      ]
    });
    
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    
    // Check permissions - user can only reply to their own tickets
    if (req.user.role === 'Member' && ticket.userId !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You can only reply to your own tickets' });
    }
    
    // Only allow replies if ticket is not resolved/closed
    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Cannot reply to a resolved or closed ticket' });
    }
    
    // If user is replying, send message to assigned agent or system admin
    if (req.user.role === 'Member') {
      const recipientId = ticket.assignedTo || null;
      
      if (!recipientId) {
        // Find a system admin to assign the ticket to
        const systemAdmin = await User.findOne({
          where: { role: 'System Admin', status: 'active' },
          attributes: ['id', 'name', 'email']
        });
        
        if (systemAdmin) {
          await ticket.update({ assignedTo: systemAdmin.id, status: 'in_progress' });
          
          // Send chat message to system admin
          await ChatMessage.create({
            senderId: req.user.id,
            receiverId: systemAdmin.id,
            message: `Ticket #${ticket.id} - ${ticket.subject}\n\nYour question: ${ticket.message}\n\nYour reply: ${message.trim()}`,
            type: 'text',
            isRead: false
          });
          
          logAction(req.user.id, 'REPLY_TICKET', 'SupportTicket', ticket.id, { message: message.trim() }, req);
          
          // Refresh ticket data
          const updatedTicket = await SupportTicket.findByPk(ticket.id, {
            include: [
              { model: User, as: 'user', attributes: ['id', 'name', 'email', 'role', 'groupId'] },
              { model: User, as: 'assignedAgent', attributes: ['id', 'name', 'email'] }
            ]
          });
          
          return res.json({
            success: true,
            message: 'Reply sent successfully. Your message has been forwarded to support.',
            data: updatedTicket
          });
        } else {
          // No system admin found - still send the reply but log it
          console.warn(`[replyToTicket] No system admin found for ticket ${ticket.id}`);
          return res.status(500).json({
            success: false,
            message: 'No support staff available. Please try again later.'
          });
        }
      } else {
        // Send chat message to assigned agent/admin
        await ChatMessage.create({
          senderId: req.user.id,
          receiverId: recipientId,
          message: `Ticket #${ticket.id} - ${ticket.subject}\n\nYour question: ${ticket.message}\n\nYour reply: ${message.trim()}`,
          type: 'text',
          isRead: false
        });
        
        // Update ticket status to in_progress if it's open
        if (ticket.status === 'open') {
          await ticket.update({ status: 'in_progress' });
        }
        
        logAction(req.user.id, 'REPLY_TICKET', 'SupportTicket', ticket.id, { message: message.trim() }, req);
        
        // Refresh ticket data
        const updatedTicket = await SupportTicket.findByPk(ticket.id, {
          include: [
            { model: User, as: 'user', attributes: ['id', 'name', 'email', 'role', 'groupId'] },
            { model: User, as: 'assignedAgent', attributes: ['id', 'name', 'email'] }
          ]
        });
        
        return res.json({
          success: true,
          message: 'Reply sent successfully. Your message has been forwarded to support.',
          data: updatedTicket
        });
      }
    }
    
    // If admin/agent is replying, send message to ticket owner
    if (['System Admin', 'Agent'].includes(req.user.role)) {
      // Send chat message to ticket owner
      await ChatMessage.create({
        senderId: req.user.id,
        receiverId: ticket.userId,
        message: `Re: Ticket #${ticket.id} - ${ticket.subject}\n\n${message.trim()}`,
        type: 'text',
        isRead: false
      });
      
      // Update ticket status
      if (ticket.status === 'open') {
        await ticket.update({ status: 'in_progress', assignedTo: req.user.id });
      }
      
      logAction(req.user.id, 'REPLY_TICKET', 'SupportTicket', ticket.id, { message: message.trim(), recipientId: ticket.userId }, req);
      
      // Refresh ticket data
      const updatedTicket = await SupportTicket.findByPk(ticket.id, {
        include: [
          { 
            model: User, 
            as: 'user', 
            attributes: ['id', 'name', 'email', 'role', 'groupId'],
            include: [
              {
                model: Group,
                as: 'group',
                attributes: ['id', 'name', 'code']
              }
            ]
          },
          { model: User, as: 'assignedAgent', attributes: ['id', 'name', 'email'] }
        ]
      });
      
      return res.json({
        success: true,
        message: 'Reply sent successfully. The user will receive your message in their inbox.',
        data: updatedTicket
      });
    }
    
    return res.status(403).json({ success: false, message: 'Access denied' });
  } catch (error) {
    console.error('[replyToTicket] Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to send reply', error: error.message });
  }
};

module.exports = { listTickets, createTicket, updateTicket, escalateTicket, getTicketById, solveTicket, getFAQs, replyToTicket };


