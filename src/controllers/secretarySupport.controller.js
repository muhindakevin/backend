const { MemberApplication, User, Group, Loan, Contribution, Transaction, Notification, Meeting } = require('../models');
const { Op } = require('sequelize');
const { logAction } = require('../utils/auditLogger');
const { sendApprovalEmail, sendWelcomeEmail, sendEmail } = require('../notifications/emailService');
const { sendRegistrationConfirmation } = require('../notifications/smsService');
const ExcelJS = require('exceljs');

/**
 * Get pending member verifications
 * GET /api/secretary/support/verifications
 */
const getPendingVerifications = async (req, res) => {
  try {
    const user = req.user;
    
    if (!user.groupId) {
      return res.json({
        success: true,
        data: []
      });
    }

    const applications = await MemberApplication.findAll({
      where: {
        groupId: user.groupId,
        status: 'pending'
      },
      include: [
        {
          association: 'user',
          attributes: ['id', 'name', 'phone', 'email', 'nationalId', 'occupation', 'address', 'dateOfBirth', 'status']
        },
        {
          association: 'group',
          attributes: ['id', 'name', 'code']
        },
        {
          association: 'reviewer',
          attributes: ['id', 'name', 'role'],
          required: false
        }
      ],
      order: [['createdAt', 'DESC']]
    });

    // Format applications for display
    const formattedApplications = applications.map(app => {
      const user = app.user;
      const documents = [];
      
      if (user.nationalId) documents.push('ID');
      if (app.documents && Array.isArray(app.documents) && app.documents.length > 0) {
        documents.push(...app.documents.map(doc => {
          if (typeof doc === 'string') return doc;
          if (doc.type) return doc.type;
          return 'Document';
        }));
      }
      if (app.address) documents.push('Proof of Address');
      if (user.occupation) documents.push('Occupation Details');

      return {
        id: app.id,
        member: user.name,
        memberId: user.id,
        phone: user.phone,
        email: user.email,
        nationalId: user.nationalId,
        documents: documents.join(', ') || 'No documents',
        documentsArray: app.documents || [],
        status: app.status,
        submittedDate: app.createdAt,
        occupation: app.occupation || user.occupation,
        address: app.address || user.address,
        reason: app.reason,
        reviewedBy: app.reviewedBy,
        reviewer: app.reviewer ? app.reviewer.name : null,
        reviewerRole: app.reviewer ? app.reviewer.role : null
      };
    });

    res.json({
      success: true,
      data: formattedApplications
    });
  } catch (error) {
    console.error('Get pending verifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending verifications',
      error: error.message
    });
  }
};

/**
 * Verify/Approve member application
 * PUT /api/secretary/support/verifications/:id/verify
 */
const verifyMemberApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const verifierId = req.user.id;
    const verifierRole = req.user.role;
    const verifierName = req.user.name;

    const app = await MemberApplication.findByPk(id, {
      include: [
        { association: 'user' },
        { association: 'group' }
      ]
    });

    if (!app) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Verify secretary has access to this group
    if (req.user.groupId !== app.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only verify applications for your own group'
      });
    }

    if (app.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been processed'
      });
    }

    const user = app.user;
    
    // Approve the application
    user.groupId = app.groupId;
    user.status = 'active';
    await user.save();

    app.status = 'approved';
    app.reviewedBy = verifierId;
    app.reviewDate = new Date();
    await app.save();

    // Log action
    logAction(verifierId, 'MEMBER_VERIFIED', 'MemberApplication', app.id, {
      memberId: user.id,
      memberName: user.name,
      verifiedBy: verifierName,
      verifiedByRole: verifierRole
    }, req);

    // Send notifications
    try {
      if (user.phone) {
        await sendRegistrationConfirmation(user.phone, user.name || 'Member').catch(err => {
          console.error('[verifyMemberApplication] SMS error:', err);
        });
      }
      if (user.email) {
        await sendApprovalEmail(user.email, user.name || 'Member').catch(err => {
          console.error('[verifyMemberApplication] Approval email error:', err);
        });
        await sendWelcomeEmail(user.email, user.name || 'Member').catch(err => {
          console.error('[verifyMemberApplication] Welcome email error:', err);
        });
      }

      // Notify group members
      const groupMembers = await User.findAll({
        where: {
          groupId: app.groupId,
          status: 'active',
          id: { [Op.ne]: user.id }
        },
        attributes: ['id']
      });

      const notificationPromises = groupMembers.map(member =>
        Notification.create({
          userId: member.id,
          type: 'member_approved',
          channel: 'in_app',
          title: 'New Member Verified',
          content: `${user.name} has been verified and joined the group. Verified by ${verifierName} (${verifierRole}).`,
          status: 'sent'
        }).catch(err => {
          console.error(`Failed to create notification for member ${member.id}:`, err);
          return null;
        })
      );

      await Promise.all(notificationPromises);
    } catch (notifError) {
      console.error('[verifyMemberApplication] Notification error:', notifError);
      // Don't fail the verification if notifications fail
    }

    res.json({
      success: true,
      message: `Member verified successfully by ${verifierName} (${verifierRole}). User has been notified.`,
      data: {
        application: app,
        user,
        verifiedBy: verifierName,
        verifiedByRole: verifierRole
      }
    });
  } catch (error) {
    console.error('Verify member application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify member application',
      error: error.message
    });
  }
};

/**
 * Reject member application
 * PUT /api/secretary/support/verifications/:id/reject
 */
const rejectMemberApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const rejectorId = req.user.id;
    const rejectorName = req.user.name;
    const rejectorRole = req.user.role;

    const app = await MemberApplication.findByPk(id, {
      include: [
        { association: 'user' },
        { association: 'group' }
      ]
    });

    if (!app) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Verify secretary has access to this group
    if (req.user.groupId !== app.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only reject applications for your own group'
      });
    }

    if (app.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Application has already been processed'
      });
    }

    app.status = 'rejected';
    app.reviewedBy = rejectorId;
    app.reviewDate = new Date();
    app.rejectionReason = reason || 'Application rejected by secretary';
    await app.save();

    // Log action
    logAction(rejectorId, 'MEMBER_REJECTED', 'MemberApplication', app.id, {
      memberId: app.userId,
      memberName: app.user.name,
      rejectedBy: rejectorName,
      rejectedByRole: rejectorRole,
      reason: app.rejectionReason
    }, req);

    // Send rejection email
    try {
      if (app.user.email) {
        await sendEmail(
          app.user.email,
          'Application Rejected - IKIMINA WALLET',
          `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #dc2626;">Application Rejected</h1>
            <p>Dear ${app.user.name || 'Member'},</p>
            <p>We regret to inform you that your application to join the group has been rejected.</p>
            <p><strong>Rejected by:</strong> ${rejectorName} (${rejectorRole})</p>
            ${app.rejectionReason ? `<p><strong>Reason:</strong> ${app.rejectionReason}</p>` : ''}
            <p>If you have any questions, please contact your Group Admin or Secretary.</p>
            <p>Best regards,<br>IKIMINA WALLET Team</p>
          </div>`,
          app.user.id,
          'rejection'
        ).catch(err => {
          console.error('[rejectMemberApplication] Email error:', err);
        });
      }
    } catch (emailError) {
      console.error('[rejectMemberApplication] Error sending rejection email:', emailError);
    }

    res.json({
      success: true,
      message: 'Application rejected successfully',
      data: {
        application: app,
        rejectedBy: rejectorName,
        rejectedByRole: rejectorRole
      }
    });
  } catch (error) {
    console.error('Reject member application error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject member application',
      error: error.message
    });
  }
};

/**
 * Get all loans for secretary's group (pending, approved, rejected, etc.)
 * GET /api/secretary/support/loans
 */
const getLoanDecisions = async (req, res) => {
  try {
    const user = req.user;
    const { status } = req.query;

    if (!user.groupId) {
      return res.json({
        success: true,
        data: []
      });
    }

    let whereClause = {
      groupId: user.groupId
    };

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const loans = await Loan.findAll({
      where: whereClause,
      include: [
        {
          association: 'member',
          attributes: ['id', 'name', 'phone', 'email']
        },
        {
          association: 'group',
          attributes: ['id', 'name', 'code']
        },
        {
          association: 'approver',
          attributes: ['id', 'name', 'role'],
          required: false
        },
        {
          association: 'guarantor',
          attributes: ['id', 'name', 'phone'],
          required: false
        }
      ],
      order: [['requestDate', 'DESC'], ['createdAt', 'DESC']]
    });

    const formattedLoans = loans.map(loan => ({
      id: loan.id,
      member: loan.member ? loan.member.name : 'Unknown',
      memberId: loan.memberId,
      memberPhone: loan.member ? loan.member.phone : null,
      amount: parseFloat(loan.amount || 0),
      purpose: loan.purpose || 'N/A',
      status: loan.status,
      requestDate: loan.requestDate || loan.createdAt,
      approvalDate: loan.approvalDate,
      approvedBy: loan.approver ? loan.approver.name : null,
      approvedByRole: loan.approver ? loan.approver.role : null,
      rejectionReason: loan.rejectionReason,
      duration: loan.duration,
      interestRate: loan.interestRate,
      monthlyPayment: parseFloat(loan.monthlyPayment || 0),
      totalAmount: parseFloat(loan.totalAmount || 0),
      guarantor: loan.guarantor ? loan.guarantor.name : null,
      disbursementDate: loan.disbursementDate,
      paidAmount: parseFloat(loan.paidAmount || 0),
      remainingAmount: parseFloat(loan.remainingAmount || 0)
    }));

    res.json({
      success: true,
      data: formattedLoans
    });
  } catch (error) {
    console.error('Get loan decisions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loans',
      error: error.message
    });
  }
};

/**
 * Get scheduled meetings for secretary's group
 * GET /api/secretary/support/schedules
 */
const getScheduledMeetings = async (req, res) => {
  try {
    const user = req.user;
    const { status } = req.query;

    console.log('[getScheduledMeetings] Request received from user:', user.id, 'groupId:', user.groupId, 'status:', status);

    if (!user.groupId) {
      console.log('[getScheduledMeetings] No groupId, returning empty array');
      return res.json({
        success: true,
        data: []
      });
    }

    let whereClause = {
      groupId: user.groupId
    };

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    console.log('[getScheduledMeetings] Query whereClause:', whereClause);

    const meetings = await Meeting.findAll({
      where: whereClause,
      include: [
        {
          model: Group,
          as: 'group',
          attributes: ['id', 'name', 'code'],
          required: false
        },
        {
          model: User,
          as: 'creator',
          attributes: ['id', 'name', 'role'],
          required: false
        }
      ],
      order: [['scheduledDate', 'ASC'], ['scheduledTime', 'ASC']]
    });

    console.log('[getScheduledMeetings] Found', meetings.length, 'meetings');

    const formattedMeetings = meetings.map(meeting => {
      const attendance = meeting.attendance && Array.isArray(meeting.attendance) ? meeting.attendance : [];
      return {
        id: meeting.id,
        title: meeting.title || 'Untitled Meeting',
        agenda: meeting.agenda || 'No agenda',
        scheduledDate: meeting.scheduledDate,
        scheduledTime: meeting.scheduledTime,
        location: meeting.location || 'Not specified',
        status: meeting.status || 'scheduled',
        minutes: meeting.minutes || null,
        attendanceCount: attendance.length,
        attendance: attendance,
        createdBy: meeting.createdBy,
        creator: meeting.creator ? meeting.creator.name : 'Unknown',
        creatorRole: meeting.creator ? meeting.creator.role : null,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt
      };
    });

    res.json({
      success: true,
      data: formattedMeetings
    });
  } catch (error) {
    console.error('Get scheduled meetings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scheduled meetings',
      error: error.message
    });
  }
};

/**
 * Get financial report summaries for secretary's group
 * GET /api/secretary/support/reports
 */
const getFinancialReports = async (req, res) => {
  try {
    const user = req.user;
    const { startDate, endDate } = req.query;

    if (!user.groupId) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalContributions: 0,
            totalLoanPayments: 0,
            totalFines: 0,
            totalLoansDisbursed: 0,
            netCashFlow: 0
          },
          transactions: [],
          contributions: [],
          loans: []
        }
      });
    }

    // Get all group members first
    const groupMembers = await User.findAll({
      where: {
        groupId: user.groupId,
        status: 'active'
      },
      attributes: ['id']
    });

    const memberIds = groupMembers.map(m => m.id);

    if (memberIds.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: {
            totalContributions: 0,
            totalLoanPayments: 0,
            totalFines: 0,
            totalLoansDisbursed: 0,
            netCashFlow: 0
          },
          transactions: [],
          contributions: [],
          loans: []
        }
      });
    }

    // Build date filter
    let contributionDateFilter = {};
    let transactionDateFilter = {};
    let loanDateFilter = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      contributionDateFilter = {
        createdAt: {
          [Op.between]: [start, end]
        }
      };

      transactionDateFilter = {
        transactionDate: {
          [Op.between]: [start, end]
        }
      };

      loanDateFilter = {
        createdAt: {
          [Op.between]: [start, end]
        }
      };
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      contributionDateFilter = {
        createdAt: {
          [Op.gte]: thirtyDaysAgo
        }
      };

      transactionDateFilter = {
        transactionDate: {
          [Op.gte]: thirtyDaysAgo
        }
      };

      loanDateFilter = {
        createdAt: {
          [Op.gte]: thirtyDaysAgo
        }
      };
    }

    // Get total contributions (approved only)
    let totalContributions = 0;
    try {
      const contributionsResult = await Contribution.findAll({
        where: {
          groupId: user.groupId,
          status: 'approved',
          ...contributionDateFilter
        },
        attributes: ['amount']
      });
      totalContributions = contributionsResult.reduce((sum, contrib) => {
        return sum + parseFloat(contrib.amount || 0);
      }, 0);
    } catch (error) {
      console.error('[getFinancialReports] Error calculating contributions:', error);
    }

    // Get total loan payments from transactions
    let totalLoanPayments = 0;
    try {
      const loanPaymentTransactions = await Transaction.findAll({
        where: {
          userId: { [Op.in]: memberIds },
          type: 'loan_payment',
          status: 'completed',
          ...transactionDateFilter
        },
        attributes: ['amount']
      });
      totalLoanPayments = loanPaymentTransactions.reduce((sum, trans) => {
        return sum + parseFloat(trans.amount || 0);
      }, 0);
    } catch (error) {
      console.error('[getFinancialReports] Error calculating loan payments:', error);
    }

    // Get total fines from transactions
    let totalFines = 0;
    try {
      const fineTransactions = await Transaction.findAll({
        where: {
          userId: { [Op.in]: memberIds },
          type: 'fine_payment',
          status: 'completed',
          ...transactionDateFilter
        },
        attributes: ['amount']
      });
      totalFines = fineTransactions.reduce((sum, trans) => {
        return sum + parseFloat(trans.amount || 0);
      }, 0);
    } catch (error) {
      console.error('[getFinancialReports] Error calculating fines:', error);
    }

    // Get total loans disbursed
    let totalLoansDisbursed = 0;
    try {
      const disbursedLoans = await Loan.findAll({
        where: {
          groupId: user.groupId,
          status: { [Op.in]: ['approved', 'disbursed', 'active'] },
          ...loanDateFilter
        },
        attributes: ['amount']
      });
      totalLoansDisbursed = disbursedLoans.reduce((sum, loan) => {
        return sum + parseFloat(loan.amount || 0);
      }, 0);
    } catch (error) {
      console.error('[getFinancialReports] Error calculating loans disbursed:', error);
    }

    // Get recent transactions
    let recentTransactions = [];
    try {
      recentTransactions = await Transaction.findAll({
        where: {
          userId: { [Op.in]: memberIds },
          ...transactionDateFilter
        },
        include: [{
          association: 'user',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['transactionDate', 'DESC'], ['createdAt', 'DESC']],
        limit: 20
      });
    } catch (error) {
      console.error('[getFinancialReports] Error fetching transactions:', error);
    }

    // Get recent contributions
    let recentContributions = [];
    try {
      recentContributions = await Contribution.findAll({
        where: {
          groupId: user.groupId,
          status: 'approved',
          ...contributionDateFilter
        },
        include: [{
          association: 'member',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['createdAt', 'DESC']],
        limit: 20
      });
    } catch (error) {
      console.error('[getFinancialReports] Error fetching contributions:', error);
    }

    // Get recent loans
    let recentLoans = [];
    try {
      recentLoans = await Loan.findAll({
        where: {
          groupId: user.groupId,
          ...loanDateFilter
        },
        include: [{
          association: 'member',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['createdAt', 'DESC']],
        limit: 20
      });
    } catch (error) {
      console.error('[getFinancialReports] Error fetching loans:', error);
    }

    // Calculate net cash flow
    const netCashFlow = totalContributions + totalLoanPayments + totalFines - totalLoansDisbursed;

    res.json({
      success: true,
      data: {
        summary: {
          totalContributions: parseFloat(totalContributions.toFixed(2)),
          totalLoanPayments: parseFloat(totalLoanPayments.toFixed(2)),
          totalFines: parseFloat(totalFines.toFixed(2)),
          totalLoansDisbursed: parseFloat(totalLoansDisbursed.toFixed(2)),
          netCashFlow: parseFloat(netCashFlow.toFixed(2))
        },
        transactions: recentTransactions,
        contributions: recentContributions,
        loans: recentLoans
      }
    });
  } catch (error) {
    console.error('Get financial reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch financial reports',
      error: error.message
    });
  }
};

/**
 * Export financial reports to Excel
 * GET /api/secretary/support/reports/export
 */
const exportFinancialReports = async (req, res) => {
  try {
    const user = req.user;
    const { startDate, endDate } = req.query;

    if (!user.groupId) {
      return res.status(400).json({
        success: false,
        message: 'User must belong to a group'
      });
    }

    // Get all group members first
    const groupMembers = await User.findAll({
      where: {
        groupId: user.groupId,
        status: 'active'
      },
      attributes: ['id']
    });

    const memberIds = groupMembers.map(m => m.id);

    if (memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No members found in group'
      });
    }

    // Build date filter
    let contributionDateFilter = {};
    let transactionDateFilter = {};
    let loanDateFilter = {};

    if (startDate && endDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      contributionDateFilter = {
        createdAt: {
          [Op.between]: [start, end]
        }
      };

      transactionDateFilter = {
        transactionDate: {
          [Op.between]: [start, end]
        }
      };

      loanDateFilter = {
        createdAt: {
          [Op.between]: [start, end]
        }
      };
    } else {
      // Default to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      thirtyDaysAgo.setHours(0, 0, 0, 0);

      contributionDateFilter = {
        createdAt: {
          [Op.gte]: thirtyDaysAgo
        }
      };

      transactionDateFilter = {
        transactionDate: {
          [Op.gte]: thirtyDaysAgo
        }
      };

      loanDateFilter = {
        createdAt: {
          [Op.gte]: thirtyDaysAgo
        }
      };
    }

    // Fetch all data
    const [contributions, transactions, loans] = await Promise.all([
      Contribution.findAll({
        where: {
          groupId: user.groupId,
          status: 'approved',
          ...contributionDateFilter
        },
        include: [{
          association: 'member',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['createdAt', 'DESC']]
      }),
      Transaction.findAll({
        where: {
          userId: { [Op.in]: memberIds },
          ...transactionDateFilter
        },
        include: [{
          association: 'user',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['transactionDate', 'DESC'], ['createdAt', 'DESC']]
      }),
      Loan.findAll({
        where: {
          groupId: user.groupId,
          ...loanDateFilter
        },
        include: [{
          association: 'member',
          attributes: ['id', 'name', 'phone'],
          required: true
        }],
        order: [['createdAt', 'DESC']]
      })
    ]);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const dateRange = startDate && endDate 
      ? `${new Date(startDate).toLocaleDateString()} - ${new Date(endDate).toLocaleDateString()}`
      : 'Last 30 Days';

    // Summary Sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Amount (RWF)', key: 'amount', width: 20 }
    ];

    const totalContributions = contributions.reduce((sum, c) => sum + parseFloat(c.amount || 0), 0);
    const totalLoanPayments = transactions
      .filter(t => t.type === 'loan_payment' && t.status === 'completed')
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalFines = transactions
      .filter(t => t.type === 'fine_payment' && t.status === 'completed')
      .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalLoansDisbursed = loans
      .filter(l => ['approved', 'disbursed', 'active'].includes(l.status))
      .reduce((sum, l) => sum + parseFloat(l.amount || 0), 0);

    summarySheet.addRow({ metric: 'Period', amount: dateRange });
    summarySheet.addRow({ metric: 'Total Contributions', amount: totalContributions.toFixed(2) });
    summarySheet.addRow({ metric: 'Total Loan Payments', amount: totalLoanPayments.toFixed(2) });
    summarySheet.addRow({ metric: 'Total Fines Collected', amount: totalFines.toFixed(2) });
    summarySheet.addRow({ metric: 'Total Loans Disbursed', amount: totalLoansDisbursed.toFixed(2) });
    summarySheet.addRow({ 
      metric: 'Net Cash Flow', 
      amount: (totalContributions + totalLoanPayments + totalFines - totalLoansDisbursed).toFixed(2) 
    });

    // Contributions Sheet
    const contributionsSheet = workbook.addWorksheet('Contributions');
    contributionsSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member', key: 'member', width: 25 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Receipt Number', key: 'receipt', width: 20 },
      { header: 'Payment Method', key: 'method', width: 15 }
    ];

    contributions.forEach(contrib => {
      contributionsSheet.addRow({
        date: contrib.createdAt ? new Date(contrib.createdAt).toLocaleDateString() : 'N/A',
        member: contrib.member ? contrib.member.name : 'Unknown',
        phone: contrib.member ? contrib.member.phone : 'N/A',
        amount: parseFloat(contrib.amount || 0).toFixed(2),
        receipt: contrib.receiptNumber || 'N/A',
        method: contrib.paymentMethod || 'N/A'
      });
    });

    // Transactions Sheet
    const transactionsSheet = workbook.addWorksheet('Transactions');
    transactionsSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member', key: 'member', width: 25 },
      { header: 'Type', key: 'type', width: 20 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Description', key: 'description', width: 30 }
    ];

    transactions.forEach(trans => {
      transactionsSheet.addRow({
        date: trans.transactionDate ? new Date(trans.transactionDate).toLocaleDateString() : 
              trans.createdAt ? new Date(trans.createdAt).toLocaleDateString() : 'N/A',
        member: trans.user ? trans.user.name : 'Unknown',
        type: trans.type || 'N/A',
        amount: parseFloat(trans.amount || 0).toFixed(2),
        status: trans.status || 'N/A',
        description: trans.description || 'N/A'
      });
    });

    // Loans Sheet
    const loansSheet = workbook.addWorksheet('Loans');
    loansSheet.columns = [
      { header: 'Date', key: 'date', width: 15 },
      { header: 'Member', key: 'member', width: 25 },
      { header: 'Amount (RWF)', key: 'amount', width: 15 },
      { header: 'Purpose', key: 'purpose', width: 25 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Duration (Months)', key: 'duration', width: 15 },
      { header: 'Interest Rate (%)', key: 'interest', width: 15 },
      { header: 'Monthly Payment (RWF)', key: 'monthly', width: 20 }
    ];

    loans.forEach(loan => {
      loansSheet.addRow({
        date: loan.createdAt ? new Date(loan.createdAt).toLocaleDateString() : 'N/A',
        member: loan.member ? loan.member.name : 'Unknown',
        amount: parseFloat(loan.amount || 0).toFixed(2),
        purpose: loan.purpose || 'N/A',
        status: loan.status || 'N/A',
        duration: loan.duration || 'N/A',
        interest: loan.interestRate ? parseFloat(loan.interestRate).toFixed(2) : 'N/A',
        monthly: loan.monthlyPayment ? parseFloat(loan.monthlyPayment).toFixed(2) : 'N/A'
      });
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=financial-report-${dateRange.replace(/\s+/g, '-')}.xlsx`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Export financial reports error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export financial reports',
      error: error.message
    });
  }
};

module.exports = {
  getPendingVerifications,
  verifyMemberApplication,
  rejectMemberApplication,
  getLoanDecisions,
  getScheduledMeetings,
  getFinancialReports,
  exportFinancialReports
};

