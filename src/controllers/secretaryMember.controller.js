const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { User, Group, Loan, Contribution, Fine, Transaction, Meeting, Notification } = require('../models');
const { Op } = require('sequelize');
const ExcelJS = require('exceljs');
const { logAction } = require('../utils/auditLogger');

/**
 * Generate a strong random password (8-12 characters)
 */
function generatePassword() {
  const length = Math.floor(Math.random() * 5) + 8; // 8-12 characters
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*';
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  // Ensure at least one of each type
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = password.length; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Get all members for secretary's group
 * GET /api/secretary/members
 */
const getMembers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, status, startDate, endDate } = req.query;
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    const groupId = secretary.groupId;
    
    // Build where clause
    const whereClause = {
      groupId,
      role: 'Member'
    };
    
    // Filter by status
    if (status && status !== 'all') {
      if (status === 'burned') {
        // "Burned" is actually "suspended" status
        whereClause.status = 'suspended';
      } else {
        whereClause.status = status;
      }
    }
    
    // Filter by join date
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.createdAt[Op.lte] = new Date(endDate);
      }
    }
    
    // Search filter
    let members = [];
    if (search) {
      members = await User.findAll({
        where: {
          ...whereClause,
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { nationalId: { [Op.like]: `%${search}%` } }
          ]
        },
        order: [['createdAt', 'DESC']]
      });
    } else {
      members = await User.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']]
      });
    }
    
    // Get financial data for each member
    const membersWithData = await Promise.all(
      members.map(async (member) => {
        const memberData = member.toJSON();
        
        // Get total contributions
        const totalContributions = await Contribution.sum('amount', {
          where: {
            memberId: member.id,
            status: 'approved'
          }
        }) || 0;
        
        // Get last contribution
        const lastContribution = await Contribution.findOne({
          where: {
            memberId: member.id,
            status: 'approved'
          },
          order: [['createdAt', 'DESC']],
          attributes: ['createdAt']
        });
        
        // Determine contribution status
        let contributionStatus = 'current';
        if (lastContribution) {
          const daysSinceLastContribution = Math.floor((new Date() - new Date(lastContribution.createdAt)) / (1000 * 60 * 60 * 24));
          if (daysSinceLastContribution > 60) {
            contributionStatus = 'overdue';
          }
        } else {
          contributionStatus = 'pending';
        }
        
        // Check if account is "burned" (suspended)
        const isBurned = memberData.status === 'suspended';
        
        return {
          id: memberData.id,
          name: memberData.name,
          phone: memberData.phone,
          email: memberData.email,
          nationalId: memberData.nationalId,
          role: memberData.role,
          status: memberData.status === 'suspended' ? 'burned' : memberData.status,
          registrationDate: memberData.createdAt ? new Date(memberData.createdAt).toISOString().split('T')[0] : null,
          totalContributions: parseFloat(totalContributions) || 0,
          lastContribution: lastContribution ? new Date(lastContribution.createdAt).toISOString().split('T')[0] : null,
          contributionStatus,
          isBurned,
          burnedDate: isBurned ? memberData.updatedAt ? new Date(memberData.updatedAt).toISOString().split('T')[0] : null : null,
          reactivatedDate: null // Can be tracked if needed
        };
      })
    );
    
    // Calculate summary stats
    const totalMembers = membersWithData.length;
    const activeMembers = membersWithData.filter(m => m.status === 'active').length;
    const burnedMembers = membersWithData.filter(m => m.status === 'burned').length;
    const pendingMembers = membersWithData.filter(m => m.status === 'pending').length;
    
    res.json({
      success: true,
      data: {
        members: membersWithData,
        summary: {
          total: totalMembers,
          active: activeMembers,
          burned: burnedMembers,
          pending: pendingMembers
        }
      }
    });
  } catch (error) {
    console.error('[getMembers] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch members',
      error: error.message
    });
  }
};

/**
 * Create a new member
 * POST /api/secretary/members
 */
const createMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, email, nationalId, gender, address, role = 'Member' } = req.body;
    
    // Validate required fields
    if (!name || !phone || !email || !nationalId) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, email, and national ID are required'
      });
    }
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    const groupId = secretary.groupId;
    
    // Check if phone or email already exists
    const existingUser = await User.findOne({
      where: {
        [Op.or]: [
          { phone },
          { email: email.toLowerCase() }
        ]
      }
    });
    
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this phone or email already exists'
      });
    }
    
    // Check if national ID already exists
    const existingNationalId = await User.findOne({
      where: { nationalId }
    });
    
    if (existingNationalId) {
      return res.status(400).json({
        success: false,
        message: 'A user with this national ID already exists'
      });
    }
    
    // Generate password
    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);
    
    // Create member
    const newMember = await User.create({
      name,
      phone,
      email: email.toLowerCase(),
      nationalId,
      password: hashedPassword,
      role,
      groupId,
      status: 'active',
      address: address || null
    });
    
    // Send notification to all group members
    try {
      const groupMembers = await User.findAll({
        where: {
          groupId,
          status: 'active'
        },
        attributes: ['id']
      });
      
      const notifications = groupMembers.map(member => ({
        userId: member.id,
        type: 'member_registration',
        channel: 'in_app',
        title: 'New Member Joined',
        content: `A new member ${name} has joined the group.`,
        status: 'sent'
      }));
      
      if (notifications.length > 0) {
        await Notification.bulkCreate(notifications);
      }
    } catch (notifError) {
      console.error('[createMember] Error creating notifications:', notifError);
    }
    
    // Log action
    logAction(userId, 'MEMBER_CREATED', 'User', newMember.id, { name, phone, email }, req);
    
    res.status(201).json({
      success: true,
      message: 'Member created successfully',
      data: {
        member: {
          id: newMember.id,
          name: newMember.name,
          phone: newMember.phone,
          email: newMember.email,
          nationalId: newMember.nationalId
        },
        credentials: {
          email: newMember.email,
          phone: newMember.phone,
          password: plainPassword // Return plain password for secretary to share
        }
      }
    });
  } catch (error) {
    console.error('[createMember] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create member',
      error: error.message
    });
  }
};

/**
 * Update member details
 * PUT /api/secretary/members/:id
 */
const updateMember = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { name, phone, email, nationalId, gender, address } = req.body;
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    // Get member
    const member = await User.findByPk(id);
    
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }
    
    // Verify member belongs to secretary's group
    if (member.groupId !== secretary.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update members from your own group'
      });
    }
    
    // Update fields
    if (name) member.name = name;
    if (phone) member.phone = phone;
    if (email) member.email = email.toLowerCase();
    if (nationalId) member.nationalId = nationalId;
    if (address !== undefined) member.address = address;
    
    await member.save();
    
    // Log action
    logAction(userId, 'MEMBER_UPDATED', 'User', member.id, { name: member.name }, req);
    
    res.json({
      success: true,
      message: 'Member updated successfully',
      data: member
    });
  } catch (error) {
    console.error('[updateMember] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member',
      error: error.message
    });
  }
};

/**
 * Ban/Suspend/Activate member
 * PUT /api/secretary/members/:id/status
 */
const updateMemberStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status } = req.body; // 'active', 'suspended', 'inactive'
    
    if (!['active', 'suspended', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be active, suspended, or inactive'
      });
    }
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    // Get member
    const member = await User.findByPk(id);
    
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }
    
    // Verify member belongs to secretary's group
    if (member.groupId !== secretary.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only update members from your own group'
      });
    }
    
    const oldStatus = member.status;
    member.status = status;
    await member.save();
    
    // Send notification to group members
    try {
      const groupMembers = await User.findAll({
        where: {
          groupId: secretary.groupId,
          status: 'active',
          id: { [Op.ne]: id } // Exclude the member being updated
        },
        attributes: ['id']
      });
      
      const statusMessages = {
        'suspended': 'has been suspended',
        'inactive': 'has been deactivated',
        'active': 'has been reactivated'
      };
      
      const notifications = groupMembers.map(m => ({
        userId: m.id,
        type: 'member_status_change',
        channel: 'in_app',
        title: 'Member Status Updated',
        content: `Member ${member.name} ${statusMessages[status] || 'status has been updated'}.`,
        status: 'sent'
      }));
      
      if (notifications.length > 0) {
        await Notification.bulkCreate(notifications);
      }
    } catch (notifError) {
      console.error('[updateMemberStatus] Error creating notifications:', notifError);
    }
    
    // Log action
    logAction(userId, 'MEMBER_STATUS_UPDATED', 'User', member.id, { 
      oldStatus, 
      newStatus: status,
      memberName: member.name 
    }, req);
    
    res.json({
      success: true,
      message: `Member ${status === 'suspended' ? 'banned' : status === 'active' ? 'activated' : 'deactivated'} successfully`,
      data: member
    });
  } catch (error) {
    console.error('[updateMemberStatus] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member status',
      error: error.message
    });
  }
};

/**
 * Get member details with financial summary
 * GET /api/secretary/members/:id
 */
const getMemberDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    // Get member
    const member = await User.findByPk(id, {
      attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'address', 'role', 'status', 'groupId', 'totalSavings', 'createdAt']
    });
    
    // Get group separately to avoid association issues
    let group = null;
    if (member && member.groupId) {
      try {
        group = await Group.findByPk(member.groupId, {
          attributes: ['id', 'name', 'code']
        });
      } catch (err) {
        console.error('[getMemberDetails] Error fetching group:', err);
      }
    }
    
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }
    
    // Verify member belongs to secretary's group
    if (member.groupId !== secretary.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only view members from your own group'
      });
    }
    
    // Get financial data
    let totalContributions = 0;
    let totalLoans = 0;
    let outstandingLoans = 0;
    let totalFines = 0;
    
    try {
      totalContributions = await Contribution.sum('amount', {
        where: {
          memberId: id,
          status: 'approved'
        }
      }) || 0;
    } catch (err) {
      console.error('[getMemberDetails] Error fetching totalContributions:', err);
    }
    
    try {
      totalLoans = await Loan.sum('amount', {
        where: { memberId: id }
      }) || 0;
    } catch (err) {
      console.error('[getMemberDetails] Error fetching totalLoans:', err);
    }
    
    try {
      outstandingLoans = await Loan.sum('remainingAmount', {
        where: {
          memberId: id,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] }
        }
      }) || 0;
    } catch (err) {
      console.error('[getMemberDetails] Error fetching outstandingLoans:', err);
    }
    
    try {
      totalFines = await Fine.sum('amount', {
        where: {
          memberId: id,
          status: 'active'
        }
      }) || 0;
    } catch (err) {
      console.error('[getMemberDetails] Error fetching totalFines:', err);
    }
    
    // Get recent contributions
    let recentContributions = [];
    try {
      recentContributions = await Contribution.findAll({
        where: {
          memberId: id,
          status: 'approved'
        },
        order: [['createdAt', 'DESC']],
        limit: 10,
        attributes: ['id', 'amount', 'createdAt', 'paymentMethod', 'receiptNumber']
      });
    } catch (err) {
      console.error('[getMemberDetails] Error fetching recentContributions:', err);
      recentContributions = [];
    }
    
    // Get recent loans
    let recentLoans = [];
    try {
      recentLoans = await Loan.findAll({
        where: { memberId: id },
        order: [['requestDate', 'DESC']],
        limit: 10,
        attributes: ['id', 'amount', 'status', 'requestDate', 'purpose']
      });
    } catch (err) {
      console.error('[getMemberDetails] Error fetching recentLoans:', err);
      recentLoans = [];
    }
    
    // Get meetings attended (if attendance is tracked)
    // Note: MySQL JSON contains doesn't work the same way, so we'll fetch and filter
    let meetingsAttended = 0;
    try {
      // Use raw query to avoid Sequelize model column validation issues
      const sequelize = Meeting.sequelize;
      if (!sequelize) {
        console.error('[getMemberDetails] Sequelize instance not available');
        meetingsAttended = 0;
      } else {
        const meetings = await sequelize.query(
          `SELECT id, attendance FROM Meetings WHERE groupId = :groupId`,
          {
            replacements: { groupId: secretary.groupId },
            type: sequelize.QueryTypes.SELECT
          }
        );
      
        // Filter meetings where this member's ID is in the attendance array
        if (Array.isArray(meetings)) {
          meetingsAttended = meetings.filter(meeting => {
            if (!meeting || !meeting.attendance) return false;
            try {
              // Handle both string JSON and already parsed JSON
              const attendance = typeof meeting.attendance === 'string' 
                ? JSON.parse(meeting.attendance) 
                : meeting.attendance;
              const attendanceArray = Array.isArray(attendance) ? attendance : [];
              const memberIdInt = parseInt(id);
              const memberIdStr = String(id);
              return attendanceArray.some(attId => 
                attId === memberIdInt || 
                attId === memberIdStr || 
                String(attId) === memberIdStr ||
                parseInt(attId) === memberIdInt
              );
            } catch (parseErr) {
              console.error('[getMemberDetails] Error parsing attendance:', parseErr);
              return false;
            }
          }).length;
        }
      }
    } catch (err) {
      console.error('[getMemberDetails] Error counting meetings attended:', err);
      console.error('[getMemberDetails] Error message:', err.message);
      console.error('[getMemberDetails] Error stack:', err.stack);
      meetingsAttended = 0;
    }
    
    // Get activity history (recent transactions)
    let activityHistory = [];
    try {
      activityHistory = await Transaction.findAll({
        where: { userId: id },
        order: [['transactionDate', 'DESC']],
        limit: 20,
        attributes: ['id', 'type', 'amount', 'transactionDate', 'status', 'description']
      });
    } catch (err) {
      console.error('[getMemberDetails] Error fetching activity history:', err);
      activityHistory = [];
    }
    
    res.json({
      success: true,
      data: {
        member: {
          id: member.id,
          name: member.name,
          phone: member.phone,
          email: member.email,
          nationalId: member.nationalId,
          gender: member.gender,
          address: member.address,
          role: member.role,
          status: member.status,
          createdAt: member.createdAt,
          group: group ? {
            id: group.id,
            name: group.name,
            code: group.code
          } : null
        },
        financial: {
          totalContributions: parseFloat(totalContributions) || 0,
          totalLoans: parseFloat(totalLoans) || 0,
          outstandingLoans: parseFloat(outstandingLoans) || 0,
          totalFines: parseFloat(totalFines) || 0,
          totalSavings: parseFloat(member.totalSavings) || 0
        },
        recentContributions,
        recentLoans,
        meetingsAttended,
        activityHistory
      }
    });
  } catch (error) {
    console.error('[getMemberDetails] Top-level Error:', error);
    console.error('[getMemberDetails] Error message:', error.message);
    console.error('[getMemberDetails] Error stack:', error.stack);
    if (error.parent) {
      console.error('[getMemberDetails] Database error:', error.parent.message);
      console.error('[getMemberDetails] SQL:', error.parent.sql);
    }
    res.status(500).json({
      success: false,
      message: 'Failed to fetch member details',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Export members to Excel
 * GET /api/secretary/members/export
 */
const exportMembers = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, status, startDate, endDate } = req.query;
    
    // Get secretary's groupId
    const secretary = await User.findByPk(userId, {
      attributes: ['id', 'groupId']
    });
    
    if (!secretary || !secretary.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Secretary does not belong to a group'
      });
    }
    
    const groupId = secretary.groupId;
    
    // Build where clause (same as getMembers)
    const whereClause = {
      groupId,
      role: 'Member'
    };
    
    if (status && status !== 'all') {
      if (status === 'burned') {
        whereClause.status = 'suspended';
      } else {
        whereClause.status = status;
      }
    }
    
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.createdAt[Op.lte] = new Date(endDate);
      }
    }
    
    // Get members
    let members = [];
    if (search) {
      members = await User.findAll({
        where: {
          ...whereClause,
          [Op.or]: [
            { name: { [Op.like]: `%${search}%` } },
            { phone: { [Op.like]: `%${search}%` } },
            { email: { [Op.like]: `%${search}%` } },
            { nationalId: { [Op.like]: `%${search}%` } }
          ]
        },
        order: [['createdAt', 'DESC']]
      });
    } else {
      members = await User.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']]
      });
    }
    
    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Members');
    
    // Define columns
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'National ID', key: 'nationalId', width: 15 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Registration Date', key: 'registrationDate', width: 18 },
      { header: 'Total Contributions (RWF)', key: 'totalContributions', width: 20 },
      { header: 'Last Contribution', key: 'lastContribution', width: 18 }
    ];
    
    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    // Get financial data and add rows
    for (const member of members) {
      const totalContributions = await Contribution.sum('amount', {
        where: {
          memberId: member.id,
          status: 'approved'
        }
      }) || 0;
      
      const lastContribution = await Contribution.findOne({
        where: {
          memberId: member.id,
          status: 'approved'
        },
        order: [['createdAt', 'DESC']],
        attributes: ['createdAt']
      });
      
      worksheet.addRow({
        id: member.id,
        name: member.name,
        phone: member.phone,
        email: member.email,
        nationalId: member.nationalId || 'N/A',
        status: member.status === 'suspended' ? 'Burned' : member.status,
        registrationDate: member.createdAt ? new Date(member.createdAt).toLocaleDateString() : 'N/A',
        totalContributions: parseFloat(totalContributions) || 0,
        lastContribution: lastContribution ? new Date(lastContribution.createdAt).toLocaleDateString() : 'N/A'
      });
    }
    
    // Set response headers
    const filename = `members_export_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('[exportMembers] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export members',
      error: error.message
    });
  }
};

module.exports = {
  getMembers,
  createMember,
  updateMember,
  updateMemberStatus,
  getMemberDetails,
  exportMembers
};

