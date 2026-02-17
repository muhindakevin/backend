const { Meeting, User, Announcement, ChatMessage, Contribution, Loan, Transaction, Document, Notification, sequelize } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');

/**
 * Get meeting statistics
 * GET /api/secretary/reports/meetings/stats
 */
const getMeetingStats = async (req, res) => {
  try {
    const user = req.user;
    
    console.log(`[getMeetingStats] User ID: ${user.id}, Role: ${user.role}, GroupId: ${user.groupId}`);
    
    if (!user.groupId) {
      console.warn('[getMeetingStats] No groupId found for user');
      return res.json({
        success: true,
        data: {
          totalMeetings: 0,
          averageAttendance: 0,
          attendanceRate: 0,
          minutesRecorded: 0
        }
      });
    }

    const groupId = parseInt(user.groupId);
    console.log(`[getMeetingStats] Fetching meetings for groupId: ${groupId}`);

    // Get total meetings
    const totalMeetings = await Meeting.count({
      where: { groupId: groupId }
    });
    console.log(`[getMeetingStats] Total meetings: ${totalMeetings}`);

    // Get all meetings with attendance
    const meetings = await Meeting.findAll({
      where: { groupId: groupId },
      attributes: ['id', 'attendance', 'minutes']
    });
    console.log(`[getMeetingStats] Found ${meetings.length} meetings`);

    // Calculate average attendance
    let totalAttendance = 0;
    let meetingsWithAttendance = 0;
    let meetingsWithMinutes = 0;

    meetings.forEach(meeting => {
      if (meeting.attendance && Array.isArray(meeting.attendance)) {
        totalAttendance += meeting.attendance.length;
        meetingsWithAttendance++;
      }
      if (meeting.minutes && meeting.minutes.trim().length > 0) {
        meetingsWithMinutes++;
      }
    });

    const averageAttendance = meetingsWithAttendance > 0 
      ? Math.round(totalAttendance / meetingsWithAttendance) 
      : 0;

    // Get total active members in group
    const totalMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member',
        status: 'active'
      }
    });
    console.log(`[getMeetingStats] Total active members: ${totalMembers}`);

    // Calculate attendance rate (average attendance / total members * 100)
    const attendanceRate = totalMembers > 0 && meetingsWithAttendance > 0
      ? Math.round((averageAttendance / totalMembers) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        totalMeetings,
        averageAttendance,
        attendanceRate,
        minutesRecorded: meetingsWithMinutes
      }
    });
  } catch (error) {
    console.error('Get meeting stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting statistics',
      error: error.message
    });
  }
};

/**
 * Export meeting report
 * GET /api/secretary/reports/meetings/export
 */
const exportMeetingReport = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    const meetings = await Meeting.findAll({
      where: { groupId: user.groupId },
      include: [
        {
          association: 'creator',
          attributes: ['id', 'name', 'role']
        }
      ],
      order: [['scheduledDate', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Meeting Report');

    // Add headers
    worksheet.columns = [
      { header: 'Meeting ID', key: 'id', width: 10 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Scheduled Date', key: 'date', width: 15 },
      { header: 'Scheduled Time', key: 'time', width: 15 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Attendance Count', key: 'attendance', width: 15 },
      { header: 'Minutes Recorded', key: 'minutes', width: 15 },
      { header: 'Created By', key: 'creator', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 }
    ];

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data rows
    meetings.forEach(meeting => {
      const attendance = meeting.attendance && Array.isArray(meeting.attendance) 
        ? meeting.attendance.length 
        : 0;
      const hasMinutes = meeting.minutes && meeting.minutes.trim().length > 0 ? 'Yes' : 'No';
      
      worksheet.addRow({
        id: meeting.id,
        title: meeting.title,
        date: meeting.scheduledDate ? new Date(meeting.scheduledDate).toLocaleDateString() : 'N/A',
        time: meeting.scheduledTime || 'N/A',
        location: meeting.location || 'N/A',
        status: meeting.status || 'N/A',
        attendance: attendance,
        minutes: hasMinutes,
        creator: meeting.creator ? meeting.creator.name : 'Unknown',
        createdAt: meeting.createdAt ? new Date(meeting.createdAt).toLocaleString() : 'N/A'
      });
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=meeting_report_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export meeting report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export meeting report',
      error: error.message
    });
  }
};

/**
 * Get member statistics
 * GET /api/secretary/reports/members/stats
 */
const getMemberStats = async (req, res) => {
  try {
    const user = req.user;
    
    console.log(`[getMemberStats] User ID: ${user.id}, Role: ${user.role}, GroupId: ${user.groupId}`);
    
    if (!user.groupId) {
      console.warn('[getMemberStats] No groupId found for user');
      return res.json({
        success: true,
        data: {
          totalMembers: 0,
          activeMembers: 0,
          inactiveMembers: 0,
          newMembers: 0
        }
      });
    }

    const groupId = parseInt(user.groupId);
    console.log(`[getMemberStats] Fetching members for groupId: ${groupId}`);

    // Get total members
    const totalMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member'
      }
    });
    console.log(`[getMemberStats] Total members: ${totalMembers}`);

    // Get active members
    const activeMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member',
        status: 'active'
      }
    });
    console.log(`[getMemberStats] Active members: ${activeMembers}`);

    // Get inactive members (suspended + banned)
    const inactiveMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member',
        status: { [Op.in]: ['suspended', 'banned'] }
      }
    });
    console.log(`[getMemberStats] Inactive members: ${inactiveMembers}`);

    // Get new members (joined in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const newMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member',
        createdAt: { [Op.gte]: thirtyDaysAgo }
      }
    });
    console.log(`[getMemberStats] New members (last 30 days): ${newMembers}`);

    res.json({
      success: true,
      data: {
        totalMembers,
        activeMembers,
        inactiveMembers,
        newMembers
      }
    });
  } catch (error) {
    console.error('Get member stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member statistics',
      error: error.message
    });
  }
};

/**
 * Export member report
 * GET /api/secretary/reports/members/export
 */
const exportMemberReport = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    const members = await User.findAll({
      where: {
        groupId: user.groupId,
        role: 'Member'
      },
      attributes: ['id', 'name', 'email', 'phone', 'nationalId', 'status', 'totalSavings', 'createdAt'],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Member Report');

    worksheet.columns = [
      { header: 'Member ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'National ID', key: 'nationalId', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Total Savings', key: 'savings', width: 15 },
      { header: 'Join Date', key: 'joinDate', width: 15 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    members.forEach(member => {
      worksheet.addRow({
        id: member.id,
        name: member.name || 'N/A',
        email: member.email || 'N/A',
        phone: member.phone || 'N/A',
        nationalId: member.nationalId || 'N/A',
        status: member.status || 'active',
        savings: member.totalSavings || 0,
        joinDate: member.createdAt ? new Date(member.createdAt).toLocaleDateString() : 'N/A'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=member_report_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export member report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export member report',
      error: error.message
    });
  }
};

/**
 * Get member engagement data
 * GET /api/secretary/reports/members/engagement
 */
const getMemberEngagement = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.json({
        success: true,
        data: []
      });
    }

    const members = await User.findAll({
      where: {
        groupId: user.groupId,
        role: 'Member',
        status: 'active'
      },
      attributes: ['id', 'name', 'email', 'phone', 'totalSavings', 'createdAt']
    });

    // Get all meetings for attendance calculation
    const meetings = await Meeting.findAll({
      where: { groupId: user.groupId },
      attributes: ['id', 'attendance']
    });

    // Get contributions count per member using raw query
    const contributionCounts = await Contribution.findAll({
      where: { groupId: user.groupId },
      attributes: [
        'memberId',
        [sequelize.fn('COUNT', sequelize.col('Contribution.id')), 'count']
      ],
      group: ['memberId'],
      raw: true
    });

    const contributionMap = {};
    contributionCounts.forEach(c => {
      contributionMap[c.memberId] = parseInt(c.count || 0);
    });

    // Calculate engagement for each member
    const engagementData = members.map(member => {
      // Count meetings attended
      let meetingsAttended = 0;
      meetings.forEach(meeting => {
        if (meeting.attendance && Array.isArray(meeting.attendance) && meeting.attendance.includes(member.id)) {
          meetingsAttended++;
        }
      });

      // Get contribution count
      const contributionCount = contributionMap[member.id] || 0;

      // Calculate participation score (meetings + contributions)
      const participationScore = meetingsAttended + contributionCount;

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        totalSavings: member.totalSavings || 0,
        meetingsAttended,
        contributionCount,
        participationScore,
        joinDate: member.createdAt
      };
    });

    // Sort by participation score (descending)
    engagementData.sort((a, b) => b.participationScore - a.participationScore);

    res.json({
      success: true,
      data: engagementData
    });
  } catch (error) {
    console.error('Get member engagement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member engagement',
      error: error.message
    });
  }
};

/**
 * Get communication statistics
 * GET /api/secretary/reports/communications/stats
 */
const getCommunicationStats = async (req, res) => {
  try {
    const user = req.user;
    
    console.log(`[getCommunicationStats] User ID: ${user.id}, Role: ${user.role}, GroupId: ${user.groupId}`);
    
    if (!user.groupId) {
      console.warn('[getCommunicationStats] No groupId found for user');
      return res.json({
        success: true,
        data: {
          totalAnnouncements: 0,
          noticesPosted: 0,
          messagesSent: 0,
          responseRate: 0
        }
      });
    }

    const groupId = parseInt(user.groupId);
    console.log(`[getCommunicationStats] Fetching communications for groupId: ${groupId}`);

    // Get total announcements
    const totalAnnouncements = await Announcement.count({
      where: { groupId: groupId }
    });
    console.log(`[getCommunicationStats] Total announcements: ${totalAnnouncements}`);

    // Notices = sent announcements
    const noticesPosted = await Announcement.count({
      where: {
        groupId: groupId,
        status: 'sent'
      }
    });
    console.log(`[getCommunicationStats] Notices posted: ${noticesPosted}`);

    // Get messages sent (group chat messages)
    const messagesSent = await ChatMessage.count({
      where: {
        groupId: groupId,
        type: { [Op.ne]: 'system' } // Exclude system messages
      }
    });
    console.log(`[getCommunicationStats] Messages sent: ${messagesSent}`);

    // Calculate response rate
    // Get total active members
    const totalActiveMembers = await User.count({
      where: {
        groupId: groupId,
        role: 'Member',
        status: 'active'
      }
    });
    console.log(`[getCommunicationStats] Total active members: ${totalActiveMembers}`);
    
    // Get unique members who have sent messages
    const uniqueSendersResult = await sequelize.query(
      `SELECT COUNT(DISTINCT senderId) as count FROM ChatMessages WHERE groupId = :groupId AND type != 'system'`,
      {
        replacements: { groupId: groupId },
        type: sequelize.QueryTypes.SELECT
      }
    );
    
    const uniqueSenders = uniqueSendersResult[0]?.count || 0;
    console.log(`[getCommunicationStats] Unique senders: ${uniqueSenders}`);
    
    // Response rate = percentage of active members who have sent at least one message
    // This gives a measure of engagement
    const responseRate = totalActiveMembers > 0 
      ? Math.round((uniqueSenders / totalActiveMembers) * 100)
      : 0;
    console.log(`[getCommunicationStats] Response rate: ${responseRate}%`);

    res.json({
      success: true,
      data: {
        totalAnnouncements,
        noticesPosted,
        messagesSent,
        responseRate
      }
    });
  } catch (error) {
    console.error('Get communication stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch communication statistics',
      error: error.message
    });
  }
};

/**
 * Export communication report
 * GET /api/secretary/reports/communications/export
 */
const exportCommunicationReport = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    const announcements = await Announcement.findAll({
      where: { groupId: user.groupId },
      include: [
        {
          association: 'creator',
          attributes: ['id', 'name', 'role']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Communication Report');

    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Type', key: 'type', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Created By', key: 'creator', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 },
      { header: 'Sent At', key: 'sentAt', width: 20 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    announcements.forEach(ann => {
      worksheet.addRow({
        id: ann.id,
        title: ann.title,
        type: 'Announcement',
        status: ann.status || 'draft',
        priority: ann.priority || 'medium',
        creator: ann.creator ? ann.creator.name : 'Unknown',
        createdAt: ann.createdAt ? new Date(ann.createdAt).toLocaleString() : 'N/A',
        sentAt: ann.sentAt ? new Date(ann.sentAt).toLocaleString() : 'N/A'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=communication_report_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export communication report error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export communication report',
      error: error.message
    });
  }
};

/**
 * Export comprehensive transaction history
 * GET /api/secretary/reports/transactions/export
 */
const exportTransactionHistory = async (req, res) => {
  try {
    const user = req.user;
    const { format = 'excel' } = req.query;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    // Get all transactions for group members
    const groupMembers = await User.findAll({
      where: {
        groupId: user.groupId,
        role: 'Member'
      },
      attributes: ['id']
    });

    const memberIds = groupMembers.map(m => m.id);

    // Get all transactions
    const transactions = await Transaction.findAll({
      where: {
        userId: { [Op.in]: memberIds }
      },
      include: [
        {
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['transactionDate', 'DESC']]
    });

    // Get contributions
    const contributions = await Contribution.findAll({
      where: { groupId: user.groupId },
      include: [
        {
          association: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Get loans
    const loans = await Loan.findAll({
      where: { groupId: user.groupId },
      include: [
        {
          association: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const workbook = new ExcelJS.Workbook();

    // Transactions sheet
    const transactionsSheet = workbook.addWorksheet('Transactions');
    transactionsSheet.columns = [
      { header: 'Transaction ID', key: 'id', width: 15 },
      { header: 'Member Name', key: 'member', width: 25 },
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Payment Method', key: 'method', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Description', key: 'description', width: 30 }
    ];

    transactionsSheet.getRow(1).font = { bold: true };
    transactionsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    transactionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    transactions.forEach(t => {
      transactionsSheet.addRow({
        id: t.id,
        member: t.user ? t.user.name : 'Unknown',
        date: t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : 'N/A',
        type: t.type || 'N/A',
        amount: t.amount || 0,
        method: t.paymentMethod || 'N/A',
        status: t.status || 'N/A',
        description: t.description || ''
      });
    });

    // Contributions sheet
    const contributionsSheet = workbook.addWorksheet('Contributions');
    contributionsSheet.columns = [
      { header: 'Contribution ID', key: 'id', width: 15 },
      { header: 'Member Name', key: 'member', width: 25 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Payment Method', key: 'method', width: 15 },
      { header: 'Receipt Number', key: 'receipt', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Date', key: 'date', width: 15 }
    ];

    contributionsSheet.getRow(1).font = { bold: true };
    contributionsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF70AD47' }
    };
    contributionsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    contributions.forEach(c => {
      contributionsSheet.addRow({
        id: c.id,
        member: c.member ? c.member.name : 'Unknown',
        amount: c.amount || 0,
        method: c.paymentMethod || 'N/A',
        receipt: c.receiptNumber || 'N/A',
        status: c.status || 'N/A',
        date: c.createdAt ? new Date(c.createdAt).toLocaleDateString() : 'N/A'
      });
    });

    // Loans sheet
    const loansSheet = workbook.addWorksheet('Loans');
    loansSheet.columns = [
      { header: 'Loan ID', key: 'id', width: 10 },
      { header: 'Member Name', key: 'member', width: 25 },
      { header: 'Amount', key: 'amount', width: 15 },
      { header: 'Purpose', key: 'purpose', width: 30 },
      { header: 'Interest Rate', key: 'interest', width: 12 },
      { header: 'Duration', key: 'duration', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Date', key: 'date', width: 15 }
    ];

    loansSheet.getRow(1).font = { bold: true };
    loansSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFC000' }
    };
    loansSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    loans.forEach(l => {
      loansSheet.addRow({
        id: l.id,
        member: l.member ? l.member.name : 'Unknown',
        amount: l.amount || 0,
        purpose: l.purpose || 'N/A',
        interest: l.interestRate || 0,
        duration: l.duration || 0,
        status: l.status || 'N/A',
        date: l.createdAt ? new Date(l.createdAt).toLocaleDateString() : 'N/A'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=transaction_history_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export transaction history error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export transaction history',
      error: error.message
    });
  }
};

/**
 * Generate monthly summary report
 * GET /api/secretary/reports/monthly-summary/export
 */
const exportMonthlySummary = async (req, res) => {
  try {
    const user = req.user;
    const { month, year } = req.query;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    const targetDate = month && year 
      ? new Date(year, month - 1, 1)
      : new Date();
    
    const startDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    const endDate = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0, 23, 59, 59);

    // Get data for the month
    const contributions = await Contribution.sum('amount', {
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] },
        status: 'approved'
      }
    }) || 0;

    const loans = await Loan.sum('amount', {
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] },
        status: { [Op.in]: ['approved', 'disbursed'] }
      }
    }) || 0;

    const meetings = await Meeting.count({
      where: {
        groupId: user.groupId,
        scheduledDate: { [Op.between]: [startDate, endDate] }
      }
    });

    const announcements = await Announcement.count({
      where: {
        groupId: user.groupId,
        createdAt: { [Op.between]: [startDate, endDate] }
      }
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Monthly Summary');

    worksheet.columns = [
      { header: 'Category', key: 'category', width: 25 },
      { header: 'Value', key: 'value', width: 20 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    worksheet.addRow({ category: 'Month', value: `${targetDate.toLocaleString('default', { month: 'long' })} ${targetDate.getFullYear()}` });
    worksheet.addRow({ category: 'Total Contributions', value: contributions });
    worksheet.addRow({ category: 'Total Loans Disbursed', value: loans });
    worksheet.addRow({ category: 'Meetings Held', value: meetings });
    worksheet.addRow({ category: 'Announcements Sent', value: announcements });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=monthly_summary_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export monthly summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export monthly summary',
      error: error.message
    });
  }
};

/**
 * Export member engagement report
 * GET /api/secretary/reports/member-engagement/export
 */
const exportMemberEngagementReport = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    // Get engagement data (reuse logic from getMemberEngagement)
    const members = await User.findAll({
      where: {
        groupId: user.groupId,
        role: 'Member',
        status: 'active'
      },
      attributes: ['id', 'name', 'email', 'phone', 'totalSavings', 'createdAt']
    });

    const meetings = await Meeting.findAll({
      where: { groupId: user.groupId },
      attributes: ['id', 'attendance']
    });

    const contributions = await Contribution.findAll({
      where: { groupId: user.groupId },
      attributes: ['memberId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['memberId']
    });

    const contributionMap = {};
    contributions.forEach(c => {
      contributionMap[c.memberId] = parseInt(c.get('count'));
    });

    const engagementData = members.map(member => {
      let meetingsAttended = 0;
      meetings.forEach(meeting => {
        if (meeting.attendance && Array.isArray(meeting.attendance) && meeting.attendance.includes(member.id)) {
          meetingsAttended++;
        }
      });

      const contributionCount = contributionMap[member.id] || 0;
      const participationScore = meetingsAttended + contributionCount;

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        phone: member.phone,
        totalSavings: member.totalSavings || 0,
        meetingsAttended,
        contributionCount,
        participationScore,
        joinDate: member.createdAt
      };
    });

    engagementData.sort((a, b) => b.participationScore - a.participationScore);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Member Engagement');

    worksheet.columns = [
      { header: 'Member ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Total Savings', key: 'savings', width: 15 },
      { header: 'Meetings Attended', key: 'meetings', width: 15 },
      { header: 'Contributions Made', key: 'contributions', width: 15 },
      { header: 'Participation Score', key: 'score', width: 15 },
      { header: 'Join Date', key: 'joinDate', width: 15 }
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    engagementData.forEach(member => {
      worksheet.addRow({
        id: member.id,
        name: member.name,
        email: member.email || 'N/A',
        phone: member.phone || 'N/A',
        savings: member.totalSavings || 0,
        meetings: member.meetingsAttended || 0,
        contributions: member.contributionCount || 0,
        score: member.participationScore || 0,
        joinDate: member.joinDate ? new Date(member.joinDate).toLocaleDateString() : 'N/A'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=member_engagement_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export member engagement error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export member engagement report',
      error: error.message
    });
  }
};

/**
 * Export archive summary
 * GET /api/secretary/reports/archive-summary/export
 */
const exportArchiveSummary = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user || !user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    // Check if Document model is available
    if (!Document) {
      console.error('[exportArchiveSummary] Document model is not available');
      return res.status(500).json({
        success: false,
        message: 'Document model not available. This feature may not be configured.'
      });
    }

    const groupId = parseInt(user.groupId);
    if (isNaN(groupId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Group ID'
      });
    }

    // Fetch archived documents - use raw SQL query to avoid Sequelize issues
    let archivedDocuments = [];
    try {
      const [results] = await sequelize.query(
        `SELECT id, title, category, fileType, uploadedBy, createdAt 
         FROM Documents 
         WHERE groupId = :groupId AND status = 'archived' 
         ORDER BY createdAt DESC`,
        {
          replacements: { groupId: groupId },
          type: sequelize.QueryTypes.SELECT
        }
      );
      archivedDocuments = Array.isArray(results) ? results : [];
    } catch (queryError) {
      console.error('[exportArchiveSummary] Database query error:', queryError);
      console.error('[exportArchiveSummary] Error details:', {
        message: queryError.message,
        name: queryError.name,
        code: queryError.code
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch archived documents',
        error: queryError.message
      });
    }

    // Get uploader names - handle errors gracefully
    const uploaderMap = {};
    try {
      const uploaderIds = [...new Set(archivedDocuments.map(doc => doc.uploadedBy).filter(Boolean))];
      if (uploaderIds.length > 0) {
        const uploaders = await User.findAll({
          where: { id: { [Op.in]: uploaderIds } },
          attributes: ['id', 'name'],
          raw: true
        });
        uploaders.forEach(u => {
          if (u && u.id && u.name) {
            uploaderMap[u.id] = u.name;
          }
        });
      }
    } catch (uploaderError) {
      console.error('[exportArchiveSummary] Error fetching uploaders:', uploaderError);
      // Continue without uploader names - just use "Unknown"
    }

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Archive Summary');

    // Add headers
    worksheet.columns = [
      { header: 'Document ID', key: 'id', width: 12 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Category', key: 'category', width: 15 },
      { header: 'File Type', key: 'fileType', width: 12 },
      { header: 'Uploaded By', key: 'uploader', width: 20 },
      { header: 'Upload Date', key: 'date', width: 15 }
    ];

    // Style header row
    try {
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
    } catch (styleError) {
      console.error('[exportArchiveSummary] Error styling header:', styleError);
      // Continue without styling
    }

    // Add data rows
    if (!archivedDocuments || archivedDocuments.length === 0) {
      worksheet.addRow({
        id: 'N/A',
        title: 'No archived documents found',
        category: 'N/A',
        fileType: 'N/A',
        uploader: 'N/A',
        date: 'N/A'
      });
    } else {
      archivedDocuments.forEach((doc, index) => {
        try {
          const uploaderName = (doc.uploadedBy && uploaderMap[doc.uploadedBy]) 
            ? uploaderMap[doc.uploadedBy] 
            : 'Unknown';
          
          let uploadDate = 'N/A';
          try {
            if (doc.createdAt) {
              const date = new Date(doc.createdAt);
              if (!isNaN(date.getTime())) {
                uploadDate = date.toLocaleDateString();
              }
            }
          } catch (dateError) {
            console.error(`[exportArchiveSummary] Date error for doc ${doc.id}:`, dateError);
          }
          
          worksheet.addRow({
            id: doc.id || index + 1,
            title: String(doc.title || 'Untitled').substring(0, 100),
            category: String(doc.category || 'other'),
            fileType: String(doc.fileType || 'N/A'),
            uploader: String(uploaderName),
            date: uploadDate
          });
        } catch (rowError) {
          console.error(`[exportArchiveSummary] Error adding row ${index}:`, rowError);
          // Skip this row and continue
        }
      });
    }

    // Generate and send buffer
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=archive_summary_${Date.now()}.xlsx`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (bufferError) {
      console.error('[exportArchiveSummary] Error generating buffer:', bufferError);
      throw bufferError;
    }
  } catch (error) {
    console.error('[exportArchiveSummary] Unexpected error:', error);
    console.error('[exportArchiveSummary] Stack:', error.stack);
    
    res.status(500).json({
      success: false,
      message: 'Failed to export archive summary',
      error: error.message || 'Unknown error occurred'
    });
  }
};

/**
 * Export communication summary
 * GET /api/secretary/reports/communication-summary/export
 */
const exportCommunicationSummary = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Group ID not found'
      });
    }

    // This is similar to exportCommunicationReport but with more details
    const announcements = await Announcement.findAll({
      where: { groupId: user.groupId },
      include: [
        {
          association: 'creator',
          attributes: ['id', 'name', 'role']
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    const messages = await ChatMessage.findAll({
      where: {
        groupId: user.groupId,
        type: { [Op.ne]: 'system' }
      },
      include: [
        {
          association: 'sender',
          attributes: ['id', 'name', 'role']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: 1000
    });

    const workbook = new ExcelJS.Workbook();

    // Announcements sheet
    const announcementsSheet = workbook.addWorksheet('Announcements');
    announcementsSheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Title', key: 'title', width: 30 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Created By', key: 'creator', width: 20 },
      { header: 'Created At', key: 'createdAt', width: 20 }
    ];

    announcementsSheet.getRow(1).font = { bold: true };
    announcementsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };
    announcementsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    announcements.forEach(ann => {
      announcementsSheet.addRow({
        id: ann.id,
        title: ann.title,
        status: ann.status || 'draft',
        priority: ann.priority || 'medium',
        creator: ann.creator ? ann.creator.name : 'Unknown',
        createdAt: ann.createdAt ? new Date(ann.createdAt).toLocaleString() : 'N/A'
      });
    });

    // Messages sheet
    const messagesSheet = workbook.addWorksheet('Messages');
    messagesSheet.columns = [
      { header: 'Message ID', key: 'id', width: 12 },
      { header: 'Sender', key: 'sender', width: 25 },
      { header: 'Message', key: 'message', width: 50 },
      { header: 'Date', key: 'date', width: 20 }
    ];

    messagesSheet.getRow(1).font = { bold: true };
    messagesSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF70AD47' }
    };
    messagesSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    messages.forEach(msg => {
      messagesSheet.addRow({
        id: msg.id,
        sender: msg.sender ? msg.sender.name : 'Unknown',
        message: (msg.message || '').substring(0, 200),
        date: msg.createdAt ? new Date(msg.createdAt).toLocaleString() : 'N/A'
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=communication_summary_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error('Export communication summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export communication summary',
      error: error.message
    });
  }
};

module.exports = {
  getMeetingStats,
  exportMeetingReport,
  getMemberStats,
  exportMemberReport,
  getMemberEngagement,
  exportMemberEngagementReport,
  getCommunicationStats,
  exportCommunicationReport,
  exportTransactionHistory,
  exportMonthlySummary,
  exportArchiveSummary,
  exportCommunicationSummary
};

