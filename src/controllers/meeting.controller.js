const { Meeting, Group, User, Fine } = require('../models');
const { sendMeetingReminder } = require('../notifications/smsService');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

/**
 * Create meeting
 * POST /api/meetings
 */
const createMeeting = async (req, res) => {
  try {
    const { groupId, title, agenda, scheduledDate, scheduledTime, location } = req.body;
    const createdBy = req.user.id;

    if (!groupId || !title || !scheduledDate || !scheduledTime) {
      return res.status(400).json({
        success: false,
        message: 'Group ID, title, scheduled date, and time are required'
      });
    }

    // Handle agenda - convert array to string if needed
    let agendaText = agenda;
    if (Array.isArray(agenda)) {
      agendaText = agenda.filter(item => item && item.trim()).join('\n');
    } else if (typeof agenda === 'string') {
      agendaText = agenda;
    } else {
      agendaText = null;
    }

    const meeting = await Meeting.create({
      groupId: parseInt(groupId),
      title: title.trim(),
      agenda: agendaText,
      scheduledDate: new Date(scheduledDate),
      scheduledTime: scheduledTime,
      location: location ? location.trim() : null,
      createdBy: parseInt(createdBy),
      status: 'scheduled'
    });

    console.log(`[createMeeting] Meeting saved to database with ID: ${meeting.id}, Title: "${meeting.title}"`);

    // Send notifications and announcement asynchronously (don't block response)
    setImmediate(async () => {
      try {
        const { Announcement, Notification, ChatMessage } = require('../models');
        
        // Get all active group members first
        const members = await User.findAll({
          where: { groupId, status: 'active' },
          attributes: ['id', 'name', 'phone']
        });

        if (members.length === 0) {
          console.log(`[createMeeting] No active members found for group ${groupId}`);
          return;
        }

        // Create announcement for the meeting
        const agendaText = Array.isArray(agenda) ? agenda.join('\n• ') : (agenda || 'To be discussed');
        const dateStr = new Date(scheduledDate).toLocaleDateString();
        const announcementContent = `New Meeting Scheduled: ${title}\n\nDate: ${dateStr}\nTime: ${scheduledTime}\n${location ? `Location: ${location}\n` : ''}\nAgenda:\n• ${agendaText}\n\nPlease mark your calendar and attend.`;

        const announcement = await Announcement.create({
          groupId,
          title: `Meeting: ${title}`,
          content: announcementContent,
          priority: 'high',
          createdBy,
          status: 'sent' // Mark as sent immediately
        });

        // Create in-app notifications for all members
        const notifications = members.map(member => ({
          userId: member.id,
          type: 'meeting_reminder',
          channel: 'in_app',
          title: `New Meeting: ${title}`,
          content: `Meeting scheduled for ${dateStr} at ${scheduledTime}${location ? ` in ${location}` : ''}`,
          status: 'sent'
        }));

        // Bulk create notifications
        await Notification.bulkCreate(notifications);
        console.log(`[createMeeting] Created ${notifications.length} meeting notifications for meeting "${title}"`);

        // Add system message to group chat
        try {
          await ChatMessage.create({
            groupId,
            senderId: createdBy,
            message: `📅 New meeting scheduled: ${title} on ${dateStr} at ${scheduledTime}`,
            type: 'system'
          });
        } catch (chatError) {
          console.error('[createMeeting] Failed to create chat message:', chatError.message);
        }

        // Send SMS reminders asynchronously (don't block)
        members.forEach(member => {
          if (member.phone) {
            sendMeetingReminder(
              member.phone,
              member.name,
              scheduledDate,
              scheduledTime
            ).catch(err => console.error(`[createMeeting] Failed to send SMS to ${member.phone}:`, err.message));
          }
        });

        console.log(`[createMeeting] Successfully sent notifications to ${members.length} members for meeting "${title}"`);
      } catch (notifError) {
        console.error('[createMeeting] Notification error:', notifError.message);
        console.error('[createMeeting] Notification error stack:', notifError.stack);
      }
    });

    // Verify meeting was saved by checking if it has an ID
    if (!meeting || !meeting.id) {
      console.error('[createMeeting] ERROR: Meeting was not saved to database - no ID returned');
      return res.status(500).json({
        success: false,
        message: 'Failed to save meeting to database'
      });
    }

    console.log(`[createMeeting] ✓ Meeting successfully saved to database - ID: ${meeting.id}, Title: "${meeting.title}"`);

    logAction(createdBy, 'MEETING_CREATED', 'Meeting', meeting.id, { groupId, title }, req);

    // Return meeting data
    const meetingData = meeting.toJSON ? meeting.toJSON() : meeting;
    
    res.status(201).json({
      success: true,
      message: 'Meeting created successfully and saved to database',
      data: meetingData
    });
  } catch (error) {
    console.error('Create meeting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create meeting',
      error: error.message
    });
  }
};

/**
 * Get meetings
 * GET /api/meetings
 */
const getMeetings = async (req, res) => {
  try {
    const { groupId, status } = req.query;
    const user = req.user;

    console.log('[getMeetings] Request received:', {
      userId: user?.id,
      userRole: user?.role,
      userGroupId: user?.groupId,
      queryGroupId: groupId,
      queryStatus: status
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    let whereClause = {};

    // Determine groupId to filter by
    const userGroupId = user.groupId ? parseInt(user.groupId) : null;
    
    if (['Group Admin', 'Member', 'Secretary', 'Cashier'].includes(user.role) && userGroupId) {
      whereClause.groupId = userGroupId;
      console.log('[getMeetings] Filtering by user groupId:', userGroupId);
    } else if (groupId) {
      whereClause.groupId = parseInt(groupId);
      console.log('[getMeetings] Filtering by query groupId:', groupId);
    } else if (user.role !== 'System Admin' && user.role !== 'Agent') {
      // If no groupId and user is not system admin/agent, return empty
      console.log('[getMeetings] No groupId found, returning empty array');
      return res.json({
        success: true,
        data: []
      });
    }

    // Only filter by status if explicitly provided and not 'all'
    if (status && status !== 'all') {
      whereClause.status = status;
      console.log('[getMeetings] Filtering by status:', status);
    } else {
      console.log('[getMeetings] No status filter (showing all statuses)');
    }

    console.log('[getMeetings] Final whereClause:', whereClause);

    // Try to get meetings - use simpler approach first
    let meetings = [];
    
    try {
      // Validate Meeting model exists
      if (!Meeting) {
        console.error('[getMeetings] Meeting model is not defined');
        return res.json({
          success: true,
          data: []
        });
      }
      
      // Build query options - explicitly specify attributes to avoid non-existent columns
      const queryOptions = {
        attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt'],
        order: [['scheduledDate', 'DESC']]
      };
      
      // Only add where clause if it has conditions
      if (Object.keys(whereClause).length > 0) {
        queryOptions.where = whereClause;
      }
      
      // Optimized query - limit results and use simpler approach
      // Add limit to prevent fetching too many records
      queryOptions.limit = 1000; // Reasonable limit
      
      // First, try simple query without includes (much faster)
      const simpleMeetings = await Meeting.findAll(queryOptions);
      
      console.log('[getMeetings] Found', simpleMeetings?.length || 0, 'meetings from database');
      
      if (simpleMeetings && simpleMeetings.length > 0) {
        // Convert to plain objects efficiently
        const meetingsData = simpleMeetings.map(m => {
          const data = m.toJSON ? m.toJSON() : m;
          return {
            id: data.id,
            groupId: data.groupId,
            title: data.title,
            agenda: data.agenda,
            scheduledDate: data.scheduledDate,
            scheduledTime: data.scheduledTime,
            location: data.location,
            status: data.status,
            minutes: data.minutes,
            attendance: data.attendance,
            attendanceTakenBy: data.attendanceTakenBy,
            attendanceTakenAt: data.attendanceTakenAt,
            createdBy: data.createdBy,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt
          };
        });
        
        // Only fetch related data if we have meetings
        const groupIds = [...new Set(meetingsData.map(m => m.groupId).filter(Boolean))];
        const creatorIds = [...new Set(meetingsData.map(m => m.createdBy).filter(Boolean))];
        
        // Fetch groups and creators in parallel (optimized)
        const fetchPromises = [];
        if (groupIds.length > 0) {
          fetchPromises.push(
            Group.findAll({
              where: { id: { [Op.in]: groupIds } },
              attributes: ['id', 'name', 'code', 'totalMembers']
            }).then(gs => gs.map(g => {
              const gData = g.toJSON ? g.toJSON() : g;
              return { id: gData.id, name: gData.name, code: gData.code, totalMembers: gData.totalMembers };
            }))
          );
        } else {
          fetchPromises.push(Promise.resolve([]));
        }
        
        if (creatorIds.length > 0) {
          fetchPromises.push(
            User.findAll({
              where: { id: { [Op.in]: creatorIds } },
              attributes: ['id', 'name']
            }).then(us => us.map(u => {
              const uData = u.toJSON ? u.toJSON() : u;
              return { id: uData.id, name: uData.name };
            }))
          );
        } else {
          fetchPromises.push(Promise.resolve([]));
        }
        
        const [groups, creators] = await Promise.all(fetchPromises);
        
        // Create lookup maps (faster than array.find)
        const groupMap = new Map(groups.map(g => [g.id, g]));
        const creatorMap = new Map(creators.map(c => [c.id, c]));
        
        // Attach group and creator to each meeting (single pass)
        meetings = meetingsData.map(meeting => ({
          ...meeting,
          group: meeting.groupId ? (groupMap.get(meeting.groupId) || null) : null,
          creator: meeting.createdBy ? (creatorMap.get(meeting.createdBy) || null) : null
        }));
      } else {
        meetings = [];
      }
    } catch (dbError) {
      console.error('[getMeetings] Database error:', dbError.message);
      console.error('[getMeetings] Error stack:', dbError.stack);
      // Return empty array instead of throwing error
      meetings = [];
    }

    // Ensure we return an array
    const result = Array.isArray(meetings) ? meetings : [];
    
    console.log('[getMeetings] Returning', result.length, 'meetings');
    if (result.length > 0) {
      console.log('[getMeetings] Sample meeting:', {
        id: result[0].id,
        title: result[0].title,
        status: result[0].status,
        scheduledDate: result[0].scheduledDate,
        hasAttendance: !!result[0].attendance
      });
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[getMeetings] Top-level error:', error.message);
    console.error('[getMeetings] Error stack:', error.stack);
    
    // Return empty array instead of error to prevent frontend crashes
    res.json({
      success: true,
      data: [],
      message: 'No meetings found or error occurred'
    });
  }
};

/**
 * Update meeting (e.g., add minutes)
 * PUT /api/meetings/:id
 */
const updateMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, agenda, scheduledDate, scheduledTime, location, minutes, attendance, status } = req.body;
    const user = req.user;

    const meeting = await Meeting.findByPk(id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check permissions
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can update meetings.'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update meetings for your own group.'
      });
    }

    // Build update object with only fields that exist
    const updateData = {};
    if (title) updateData.title = title;
    if (agenda !== undefined) {
      // Handle agenda - convert array to string if needed
      if (Array.isArray(agenda)) {
        updateData.agenda = agenda.filter(item => item && item.trim()).join('\n');
      } else {
        updateData.agenda = agenda;
      }
    }
    if (scheduledDate) updateData.scheduledDate = new Date(scheduledDate);
    if (scheduledTime) updateData.scheduledTime = scheduledTime;
    if (location !== undefined) updateData.location = location;
    if (minutes !== undefined) updateData.minutes = minutes;
    if (attendance !== undefined) {
      // Ensure attendance is stored as JSON array
      if (Array.isArray(attendance)) {
        updateData.attendance = attendance;
      } else if (typeof attendance === 'string') {
        try {
          updateData.attendance = JSON.parse(attendance);
        } catch {
          updateData.attendance = [];
        }
      } else {
        updateData.attendance = [];
      }
      console.log(`[updateMeeting] Updated attendance for meeting ${id}: ${updateData.attendance.length} members`);
    }
    if (status) updateData.status = status;

    // Use update to avoid non-existent columns
    await Meeting.update(updateData, {
      where: { id: meeting.id }
    });
    
    // Fetch updated meeting for response
    const updatedMeeting = await Meeting.findByPk(meeting.id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    logAction(user.id, 'MEETING_UPDATED', 'Meeting', meeting.id, { title: updatedMeeting?.title || meeting.title }, req);

    res.json({
      success: true,
      message: 'Meeting updated successfully',
      data: updatedMeeting || meeting
    });
  } catch (error) {
    console.error('Update meeting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update meeting',
      error: error.message
    });
  }
};

/**
 * Delete meeting
 * DELETE /api/meetings/:id
 */
const deleteMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const meeting = await Meeting.findByPk(id);

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check permissions - only Group Admin or Secretary can delete
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can delete meetings.'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete meetings for your own group.'
      });
    }

    await meeting.destroy();

    logAction(user.id, 'MEETING_DELETED', 'Meeting', id, { title: meeting.title }, req);

    res.json({
      success: true,
      message: 'Meeting deleted successfully'
    });
  } catch (error) {
    console.error('Delete meeting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete meeting',
      error: error.message
    });
  }
};

/**
 * Get meeting details by ID
 * GET /api/meetings/:id
 */
const getMeetingById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const meeting = await Meeting.findByPk(id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt'],
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'role'],
          required: false
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ]
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view meetings for your own group.'
      });
    }

    // Get attendance details if attendance array exists (regardless of who took it)
    let attendanceDetails = [];
    let absentMembers = [];
    let attendanceTaken = false;
    let attendanceTakenBy = null;
    let attendanceTakenByUser = null;
    
    // Check if attendance was taken (array exists, even if empty)
    if (meeting.attendance && Array.isArray(meeting.attendance)) {
      attendanceTaken = true;
      
      // Get who took the attendance
      if (meeting.attendanceTakenBy) {
        attendanceTakenBy = meeting.attendanceTakenBy;
        try {
          attendanceTakenByUser = await User.findByPk(attendanceTakenBy, {
            attributes: ['id', 'name', 'role']
          });
        } catch (err) {
          console.error('[getMeetingById] Error fetching attendance taker:', err);
        }
      }
      
      if (meeting.attendance.length > 0) {
      const memberIds = meeting.attendance;
      
      // Get all group members
      const allGroupMembers = await User.findAll({
        where: {
          groupId: meeting.groupId,
          role: 'Member',
          status: 'active'
        },
        attributes: ['id', 'name', 'phone', 'email']
      });
      
      // Get members who attended
      const presentMembers = await User.findAll({
        where: {
          id: { [Op.in]: memberIds },
          groupId: meeting.groupId
        },
        attributes: ['id', 'name', 'phone', 'email']
      });
      
      attendanceDetails = presentMembers.map(m => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        email: m.email
      }));
      
      // Get members who were absent (all group members minus those who attended)
      const presentIds = new Set(memberIds);
      absentMembers = allGroupMembers
        .filter(m => !presentIds.has(m.id))
        .map(m => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          email: m.email
        }));
      }
      // If attendance array exists but is empty, it means attendance was taken but no one was marked present
    }

    // Parse agenda if it's a string
    let agendaItems = [];
    if (meeting.agenda) {
      if (typeof meeting.agenda === 'string') {
        agendaItems = meeting.agenda.split('\n').filter(item => item.trim());
      } else if (Array.isArray(meeting.agenda)) {
        agendaItems = meeting.agenda;
      }
    }

    const meetingData = meeting.toJSON();
    res.json({
      success: true,
      data: {
        ...meetingData,
        agendaItems,
        attendanceDetails,
        absentMembers,
        attendeesCount: attendanceDetails.length || (meeting.attendance ? meeting.attendance.length : 0),
        absentCount: absentMembers.length,
        attendanceTaken: attendanceTaken, // Indicates if attendance was taken (by anyone)
        attendanceTakenBy: attendanceTakenBy,
        attendanceTakenByUser: attendanceTakenByUser ? {
          id: attendanceTakenByUser.id,
          name: attendanceTakenByUser.name,
          role: attendanceTakenByUser.role
        } : null,
        attendanceTakenAt: meeting.attendanceTakenAt || null,
        minutesRecorded: !!meeting.minutes
      }
    });
  } catch (error) {
    console.error('Get meeting by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting details',
      error: error.message
    });
  }
};

/**
 * Update meeting attendance
 * PUT /api/meetings/:id/attendance
 */
const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const { attendance } = req.body; // Array of member IDs
    const user = req.user;

    const meeting = await Meeting.findByPk(id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update meetings for your own group.'
      });
    }

    // Check permissions - Secretary or Group Admin can update attendance
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can update attendance.'
      });
    }

    // Validate attendance array
    if (!Array.isArray(attendance)) {
      return res.status(400).json({
        success: false,
        message: 'Attendance must be an array of member IDs'
      });
    }

    // Verify all member IDs belong to the same group
    if (attendance.length > 0) {
      const members = await User.findAll({
        where: {
          id: { [Op.in]: attendance },
          groupId: meeting.groupId
        },
        attributes: ['id']
      });

      if (members.length !== attendance.length) {
        return res.status(400).json({
          success: false,
          message: 'Some member IDs do not belong to this group'
        });
      }
    }

    // Check if meeting is in the past
    const meetingDate = new Date(meeting.scheduledDate);
    const now = new Date();
    const isPastMeeting = meetingDate < now;
    
    // If meeting is in the past and attendance already exists, prevent updates
    if (isPastMeeting && meeting.attendance && Array.isArray(meeting.attendance) && meeting.attendance.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'Cannot update attendance for past meetings. Attendance has already been recorded.'
      });
    }

    // Update attendance with who took it and when
    await Meeting.update(
      { 
        attendance: attendance,
        attendanceTakenBy: user.id,
        attendanceTakenAt: new Date()
      },
      { where: { id: meeting.id } }
    );

    logAction(user.id, 'MEETING_ATTENDANCE_UPDATED', 'Meeting', meeting.id, { 
      attendanceCount: attendance.length,
      takenBy: user.role
    }, req);

    res.json({
      success: true,
      message: 'Attendance updated successfully',
      data: {
        meetingId: meeting.id,
        attendanceCount: attendance.length,
        attendance,
        attendanceTakenBy: user.id,
        attendanceTakenByRole: user.role
      }
    });
  } catch (error) {
    console.error('Update attendance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendance',
      error: error.message
    });
  }
};

/**
 * Postpone meeting
 * PUT /api/meetings/:id/postpone
 */
const postponeMeeting = async (req, res) => {
  try {
    const { id } = req.params;
    const { newDate, newTime, reason } = req.body;
    const user = req.user;

    if (!newDate || !newTime) {
      return res.status(400).json({
        success: false,
        message: 'New date and time are required'
      });
    }

    const meeting = await Meeting.findByPk(id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only postpone meetings for your own group.'
      });
    }

    // Check permissions - Secretary or Group Admin can postpone
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can postpone meetings.'
      });
    }

    const oldDate = meeting.scheduledDate;
    const oldTime = meeting.scheduledTime;

    // Use update to avoid non-existent columns
    await Meeting.update(
      {
        scheduledDate: new Date(newDate),
        scheduledTime: newTime
      },
      {
        where: { id: meeting.id }
      }
    );

    // Send notifications to group members about the postponement
    try {
      const { Notification, ChatMessage } = require('../models');
      const groupMembers = await User.findAll({
        where: {
          groupId: meeting.groupId,
          status: 'active'
        },
        attributes: ['id']
      });

      const notifications = groupMembers.map(member => ({
        userId: member.id,
        type: 'meeting_postponed',
        channel: 'in_app',
        title: `Meeting Postponed: ${meeting.title}`,
        content: `The meeting "${meeting.title}" has been postponed to ${new Date(newDate).toLocaleDateString()} at ${newTime}.${reason ? ` Reason: ${reason}` : ''}`,
        status: 'sent'
      }));

      if (notifications.length > 0) {
        await Notification.bulkCreate(notifications);
      }

      // Add to group chat
      await ChatMessage.create({
        groupId: meeting.groupId,
        senderId: user.id,
        message: `📅 Meeting "${meeting.title}" has been postponed to ${new Date(newDate).toLocaleDateString()} at ${newTime}`,
        type: 'system'
      });
    } catch (notifError) {
      console.error('[postponeMeeting] Error sending notifications:', notifError);
    }

    logAction(user.id, 'MEETING_POSTPONED', 'Meeting', meeting.id, { 
      oldDate, 
      oldTime, 
      newDate, 
      newTime,
      reason 
    }, req);

    res.json({
      success: true,
      message: 'Meeting postponed successfully',
      data: meeting
    });
  } catch (error) {
    console.error('Postpone meeting error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to postpone meeting',
      error: error.message
    });
  }
};

/**
 * Record meeting minutes
 * PUT /api/meetings/:id/minutes
 */
const recordMinutes = async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes } = req.body;
    const user = req.user;

    if (!minutes) {
      return res.status(400).json({
        success: false,
        message: 'Minutes content is required'
      });
    }

    const meeting = await Meeting.findByPk(id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only record minutes for meetings in your own group.'
      });
    }

    // Check permissions - Secretary or Group Admin can record minutes
    if (user.role !== 'Group Admin' && user.role !== 'Secretary' && user.role !== 'System Admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Group Admin or Secretary can record minutes.'
      });
    }

    // Use update to avoid non-existent columns
    const updateData = {
      minutes: minutes
    };
    if (meeting.status === 'scheduled' || meeting.status === 'ongoing') {
      updateData.status = 'completed';
    }
    
    await Meeting.update(updateData, {
      where: { id: meeting.id }
    });
    
    // Fetch updated meeting for response
    const updatedMeeting = await Meeting.findByPk(meeting.id, {
      attributes: ['id', 'groupId', 'title', 'agenda', 'scheduledDate', 'scheduledTime', 'location', 'status', 'minutes', 'attendance', 'attendanceTakenBy', 'attendanceTakenAt', 'createdBy', 'createdAt', 'updatedAt']
    });

    logAction(user.id, 'MEETING_MINUTES_RECORDED', 'Meeting', meeting.id, { 
      title: updatedMeeting?.title || meeting.title 
    }, req);

    res.json({
      success: true,
      message: 'Meeting minutes recorded successfully',
      data: updatedMeeting || meeting
    });
  } catch (error) {
    console.error('Record minutes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record minutes',
      error: error.message
    });
  }
};

/**
 * Get fines related to a meeting
 * GET /api/meetings/:id/fines
 */
const getMeetingFines = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const meeting = await Meeting.findByPk(id);
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get meeting date range (meeting date ± 1 day to catch fines issued around the meeting)
    const meetingDate = new Date(meeting.scheduledDate);
    const startDate = new Date(meetingDate);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(meetingDate);
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(23, 59, 59, 999);

    // Find fines that:
    // 1. Are in the same group
    // 2. Were issued around the meeting date (±1 day)
    // 3. OR have a reason that mentions the meeting (optional - can be enhanced)
    const fines = await Fine.findAll({
      where: {
        groupId: meeting.groupId,
        [Op.or]: [
          {
            issuedDate: {
              [Op.between]: [startDate, endDate]
            }
          },
          {
            reason: {
              [Op.like]: `%meeting%${meeting.id}%`
            }
          },
          {
            reason: {
              [Op.like]: `%${meeting.title}%`
            }
          }
        ]
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['issuedDate', 'DESC']]
    });

    res.json({
      success: true,
      data: fines
    });
  } catch (error) {
    console.error('Get meeting fines error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting fines',
      error: error.message
    });
  }
};

/**
 * Export meeting report as Excel
 * GET /api/meetings/:id/export
 */
const exportMeetingReport = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const meeting = await Meeting.findByPk(id, {
      include: [
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'role'],
          required: false
        },
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code'],
          required: false
        }
      ]
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Verify user belongs to the same group
    if (user.groupId && meeting.groupId !== user.groupId && user.role !== 'System Admin' && user.role !== 'Agent') {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Get attendance details
    let attendanceDetails = [];
    let absentMembers = [];
    if (meeting.attendance && Array.isArray(meeting.attendance) && meeting.attendance.length > 0) {
      const memberIds = meeting.attendance;
      const allGroupMembers = await User.findAll({
        where: {
          groupId: meeting.groupId,
          role: 'Member',
          status: 'active'
        },
        attributes: ['id', 'name', 'phone', 'email']
      });

      const presentMembers = await User.findAll({
        where: {
          id: { [Op.in]: memberIds },
          groupId: meeting.groupId
        },
        attributes: ['id', 'name', 'phone', 'email']
      });

      attendanceDetails = presentMembers.map(m => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        email: m.email
      }));

      const presentIds = new Set(memberIds);
      absentMembers = allGroupMembers
        .filter(m => !presentIds.has(m.id))
        .map(m => ({
          id: m.id,
          name: m.name,
          phone: m.phone,
          email: m.email
        }));
    }

    // Get fines related to the meeting
    const meetingDate = new Date(meeting.scheduledDate);
    const startDate = new Date(meetingDate);
    startDate.setDate(startDate.getDate() - 1);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(meetingDate);
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(23, 59, 59, 999);

    const fines = await Fine.findAll({
      where: {
        groupId: meeting.groupId,
        issuedDate: {
          [Op.between]: [startDate, endDate]
        }
      },
      include: [
        {
          model: User,
          as: 'member',
          attributes: ['id', 'name', 'phone']
        }
      ],
      order: [['issuedDate', 'DESC']]
    });

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();

    // Meeting Information Sheet
    const infoSheet = workbook.addWorksheet('Meeting Information');
    infoSheet.columns = [
      { header: 'Field', key: 'field', width: 25 },
      { header: 'Value', key: 'value', width: 50 }
    ];

    const agendaItems = meeting.agenda ? (typeof meeting.agenda === 'string' 
      ? meeting.agenda.split('\n').filter(item => item.trim())
      : meeting.agenda) : [];

    infoSheet.addRow({ field: 'Meeting ID', value: `MT${meeting.id}` });
    infoSheet.addRow({ field: 'Title', value: meeting.title || 'N/A' });
    infoSheet.addRow({ field: 'Date', value: meeting.scheduledDate ? new Date(meeting.scheduledDate).toLocaleDateString() : 'N/A' });
    infoSheet.addRow({ field: 'Time', value: meeting.scheduledTime || 'N/A' });
    infoSheet.addRow({ field: 'Location', value: meeting.location || 'N/A' });
    infoSheet.addRow({ field: 'Status', value: meeting.status || 'N/A' });
    infoSheet.addRow({ field: 'Created By', value: meeting.creator?.name || 'Unknown' });
    infoSheet.addRow({ field: 'Group', value: meeting.group?.name || 'N/A' });
    infoSheet.addRow({ field: 'Group Code', value: meeting.group?.code || 'N/A' });
    infoSheet.addRow({ field: 'Total Attendees', value: attendanceDetails.length });
    infoSheet.addRow({ field: 'Absent Members', value: absentMembers.length });
    infoSheet.addRow({ field: 'Minutes Recorded', value: meeting.minutes ? 'Yes' : 'No' });

    if (agendaItems.length > 0) {
      infoSheet.addRow({ field: 'Agenda', value: '' });
      agendaItems.forEach((item, index) => {
        infoSheet.addRow({ field: `  ${index + 1}.`, value: item });
      });
    }

    if (meeting.minutes) {
      infoSheet.addRow({ field: 'Minutes', value: '' });
      const minutesLines = meeting.minutes.split('\n');
      minutesLines.forEach(line => {
        infoSheet.addRow({ field: '', value: line });
      });
    }

    // Attendance Sheet
    const attendanceSheet = workbook.addWorksheet('Attendance');
    attendanceSheet.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    attendanceDetails.forEach(member => {
      attendanceSheet.addRow({
        name: member.name,
        phone: member.phone || 'N/A',
        email: member.email || 'N/A',
        status: 'Present'
      });
    });

    absentMembers.forEach(member => {
      attendanceSheet.addRow({
        name: member.name,
        phone: member.phone || 'N/A',
        email: member.email || 'N/A',
        status: 'Absent'
      });
    });

    // Fines Sheet
    if (fines.length > 0) {
      const finesSheet = workbook.addWorksheet('Fines');
      finesSheet.columns = [
        { header: 'Member Name', key: 'memberName', width: 25 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Amount (RWF)', key: 'amount', width: 15 },
        { header: 'Reason', key: 'reason', width: 40 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Issued Date', key: 'issuedDate', width: 15 },
        { header: 'Paid Date', key: 'paidDate', width: 15 }
      ];

      fines.forEach(fine => {
        finesSheet.addRow({
          memberName: fine.member?.name || 'Unknown',
          phone: fine.member?.phone || 'N/A',
          amount: parseFloat(fine.amount || 0).toLocaleString(),
          reason: fine.reason || 'N/A',
          status: fine.status || 'N/A',
          issuedDate: fine.issuedDate ? new Date(fine.issuedDate).toLocaleDateString() : 'N/A',
          paidDate: fine.paidDate ? new Date(fine.paidDate).toLocaleDateString() : 'N/A'
        });
      });
    }

    // Style header rows
    [infoSheet, attendanceSheet].forEach(sheet => {
      if (sheet.rowCount > 0) {
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }
    });

    if (fines.length > 0) {
      const finesSheet = workbook.getWorksheet('Fines');
      if (finesSheet && finesSheet.rowCount > 0) {
        finesSheet.getRow(1).font = { bold: true };
        finesSheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=meeting_report_${meeting.id}_${Date.now()}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export meeting report error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to export meeting report',
        error: error.message
      });
    }
  }
};

module.exports = {
  createMeeting,
  getMeetings,
  getMeetingById,
  updateMeeting,
  deleteMeeting,
  updateAttendance,
  postponeMeeting,
  recordMinutes,
  getMeetingFines,
  exportMeetingReport
};

