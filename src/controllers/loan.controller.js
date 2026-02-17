const { Loan, User, Group, Transaction, Notification, Document, LoanProduct } = require('../models');
const { getAIRecommendation, calculateCreditScore } = require('../utils/creditScoreCalculator');
const { sendLoanApproval, sendLoanRejection, sendSMS } = require('../notifications/smsService');
const { sendLoanApprovalEmail, sendLoanRejectionEmail, sendLoanRequestEmail } = require('../notifications/emailService');
const { logAction } = require('../utils/auditLogger');
const { createAutomaticVote } = require('./voting.controller');
const { Op } = require('sequelize');

/**
 * Request a loan
 * POST /api/loans/request
 */
const requestLoan = async (req, res) => {
  try {
    const { amount, purpose, duration, guarantorId, guarantorName, guarantorPhone, guarantorNationalId, guarantorRelationship } = req.body;
    const memberId = req.user.id;

    if (!amount || !purpose || !duration) {
      return res.status(400).json({
        success: false,
        message: 'Amount, purpose, and duration are required'
      });
    }

    // Validate guarantor information
    if (!guarantorId || !guarantorName || !guarantorPhone || !guarantorNationalId) {
      return res.status(400).json({
        success: false,
        message: 'Guarantor information is required. Please provide guarantor ID, name, phone, and national ID.'
      });
    }

    const member = await User.findByPk(memberId, { include: ['group'] });
    if (!member || !member.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Member must belong to a group'
      });
    }

    // Validate that guarantor is a member of the same group
    const guarantor = await User.findByPk(guarantorId);
    if (!guarantor) {
      return res.status(400).json({
        success: false,
        message: 'Guarantor not found'
      });
    }

    if (guarantor.groupId !== member.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Guarantor must be a member of the same group'
      });
    }

    if (guarantor.role !== 'Member') {
      return res.status(400).json({
        success: false,
        message: 'Guarantor must be a member of the group'
      });
    }

    if (guarantorId === memberId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot be your own guarantor'
      });
    }

    // Verify guarantor information matches the user record
    if (guarantor.name !== guarantorName || guarantor.phone !== guarantorPhone || guarantor.nationalId !== guarantorNationalId) {
      return res.status(400).json({
        success: false,
        message: 'Guarantor information does not match our records. Please verify the details.'
      });
    }

    // Check for active loans (only loans that are disbursed/active AND have remaining balance > 0)
    // Exclude: pending (not yet approved), rejected, completed, defaulted
    const activeLoan = await Loan.findOne({
      where: {
        memberId,
        status: { [Op.in]: ['disbursed', 'active'] },
        remainingAmount: { [Op.gt]: 0 } // Must have outstanding balance
      }
    });

    if (activeLoan) {
      const remainingBalance = parseFloat(activeLoan.remainingAmount || 0);
      return res.status(400).json({
        success: false,
        message: `You have an active loan with an outstanding balance of ${remainingBalance.toLocaleString()} RWF. Please complete it before requesting a new one.`
      });
    }

    // Get AI recommendation
    const aiRec = await getAIRecommendation(memberId, parseFloat(amount));

    // Calculate loan details
    const principal = parseFloat(amount);
    const interestRate = aiRec.interestRate;
    const months = parseInt(duration);
    const totalAmount = principal * (1 + (interestRate / 100));
    const monthlyPayment = totalAmount / months;

    // Check if loan requires voting
    const memberSavings = parseFloat(member.totalSavings) || 0;
    const aiMaxAmount = aiRec.maxRecommendedAmount || 0;
    const requiresVoting = principal > memberSavings || principal > aiMaxAmount;

    // Create loan request
    const loan = await Loan.create({
      memberId,
      groupId: member.groupId,
      amount: principal,
      purpose,
      interestRate,
      duration: months,
      monthlyPayment: Math.round(monthlyPayment),
      totalAmount: Math.round(totalAmount),
      remainingAmount: Math.round(totalAmount),
      status: 'pending', // Status remains pending until voting completes
      aiRecommendation: aiRec.recommendation,
      guarantorId,
      guarantorName,
      guarantorPhone,
      guarantorNationalId,
      guarantorRelationship: guarantorRelationship || null
    });

    logAction(memberId, 'LOAN_REQUESTED', 'Loan', loan.id, { amount, purpose, duration, guarantorId, requiresVoting }, req);

    // Auto-create document for loan request
    setImmediate(async () => {
      try {
        const { autoCreateDocumentFromLoan } = require('./documentation.controller');
        const fileUrl = `/loans/${loan.id}`;
        const fileName = `loan-request-${loan.id}-${purpose?.replace(/[^a-z0-9]/gi, '_') || loan.id}.txt`;
        await autoCreateDocumentFromLoan(loan.id, fileUrl, fileName);
        console.log(`[requestLoan] Auto-created document for loan request ${loan.id}`);
      } catch (docError) {
        console.error('[requestLoan] Error creating document:', docError);
        // Don't fail the request if document creation fails
      }
    });

    // Create automatic vote if loan exceeds limits
    if (requiresVoting) {
      try {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 7); // 7 days voting period

        const voteTitle = `Loan Approval Vote: ${member.name} - ${principal.toLocaleString()} RWF`;
        let voteDescription = `A loan request has been submitted that requires group approval:\n\n`;
        voteDescription += `Member: ${member.name} (${member.phone})\n`;
        voteDescription += `Loan Amount: ${principal.toLocaleString()} RWF\n`;
        voteDescription += `Purpose: ${purpose}\n`;
        voteDescription += `Duration: ${months} months\n`;
        voteDescription += `Monthly Payment: ${Math.round(monthlyPayment).toLocaleString()} RWF\n`;
        voteDescription += `Guarantor: ${guarantorName} (${guarantorPhone})\n\n`;
        
        if (principal > memberSavings) {
          voteDescription += `⚠️ This loan exceeds the member's savings (${memberSavings.toLocaleString()} RWF).\n`;
        }
        if (principal > aiMaxAmount) {
          voteDescription += `⚠️ This loan exceeds the AI credit scoring recommendation (${aiMaxAmount.toLocaleString()} RWF).\n`;
        }
        voteDescription += `\nPlease vote to approve or reject this loan request.`;

        await createAutomaticVote({
          groupId: member.groupId,
          title: voteTitle,
          description: voteDescription,
          type: 'loan_approval_override',
          endDate: endDate.toISOString(),
          options: ['Approve Loan', 'Reject Loan'],
          createdBy: memberId
        });

        console.log(`[requestLoan] Created automatic vote for loan ${loan.id} that exceeds limits`);
      } catch (voteError) {
        console.error('[requestLoan] Failed to create automatic vote:', voteError);
        console.error('[requestLoan] Vote error details:', {
          message: voteError.message,
          stack: voteError.stack,
          loanId: loan.id,
          memberId: memberId
        });
        // Don't fail the loan request if vote creation fails
        // The loan will still be created but without a vote
      }
    }

    // Send notifications to Group Admin, Secretary, and Cashier asynchronously
    setImmediate(async () => {
      try {
        // Fetch Group Admin, Secretary, and Cashier
        const admins = await User.findAll({
          where: {
            groupId: member.groupId,
            role: { [Op.in]: ['Group Admin', 'Secretary', 'Cashier'] },
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'role']
        });

        console.log(`[requestLoan] Found ${admins.length} admins to notify (Group Admin, Secretary, Cashier)`);

        // Create detailed plain text notification message
        const notificationMessage = `New loan request from ${member.name} (${member.phone}):\n\n` +
          `• Loan Amount: ${principal.toLocaleString()} RWF\n` +
          `• Purpose: ${purpose}\n` +
          `• Duration: ${months} months\n` +
          `• Monthly Payment: ${Math.round(monthlyPayment).toLocaleString()} RWF\n` +
          `• Interest Rate: ${interestRate}%\n` +
          `• Guarantor: ${guarantorName} (${guarantorPhone})${guarantorRelationship ? ` - ${guarantorRelationship}` : ''}\n` +
          `• Loan ID: ${loan.id}\n` +
          `• AI Recommendation: ${aiRec.recommendation} (${aiRec.confidence} confidence)\n` +
          `• Credit Score: ${aiRec.creditScore}/1000\n\n` +
          `Please review this loan request in your dashboard.`;

        // Create in-app notifications for each admin (Group Admin, Secretary, Cashier)
        const notificationPromises = admins.map(admin =>
          Notification.create({
            userId: admin.id,
            type: 'loan_request',
            channel: 'in_app',
            title: 'New Loan Request - Requires Review',
            content: notificationMessage,
            status: 'sent'
          })
        );
        await Promise.all(notificationPromises);
        console.log(`[requestLoan] Created in-app notifications for ${admins.length} admins (Group Admin, Secretary, Cashier)`);

        // Send SMS notifications to admins (fire-and-forget)
        for (const admin of admins) {
          if (admin.phone) {
            const smsMessage = `New loan request: ${member.name} requests ${principal.toLocaleString()} RWF. Guarantor: ${guarantorName}. Loan ID: ${loan.id}. Review in dashboard.`;
            sendSMS(admin.phone, smsMessage, admin.id, 'loan_request').catch(err => {
              console.error(`[requestLoan] Failed to send SMS to ${admin.role} ${admin.name}:`, err);
            });
          }
        }

        // Send Email notifications to admins (fire-and-forget)
        for (const admin of admins) {
          if (admin.email) {
            const emailSubject = 'New Loan Request - Requires Review';
            const emailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #1e40af;">New Loan Request</h1>
                <p>Dear ${admin.name},</p>
                <p>A new loan request has been submitted and requires your review:</p>
                <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <p><strong>Member:</strong> ${member.name} (${member.phone})</p>
                  <p><strong>Loan Amount:</strong> RWF ${principal.toLocaleString()}</p>
                  <p><strong>Purpose:</strong> ${purpose}</p>
                  <p><strong>Duration:</strong> ${months} months</p>
                  <p><strong>Monthly Payment:</strong> RWF ${Math.round(monthlyPayment).toLocaleString()}</p>
                  <p><strong>Interest Rate:</strong> ${interestRate}%</p>
                  <p><strong>Guarantor:</strong> ${guarantorName} (${guarantorPhone})</p>
                  ${guarantorRelationship ? `<p><strong>Relationship:</strong> ${guarantorRelationship}</p>` : ''}
                  <p><strong>Loan ID:</strong> ${loan.id}</p>
                  <p><strong>AI Recommendation:</strong> ${aiRec.recommendation} (${aiRec.confidence} confidence)</p>
                  <p><strong>Credit Score:</strong> ${aiRec.creditScore}/1000</p>
                </div>
                <p>Please log in to your dashboard to review and approve or reject this loan request.</p>
                <p>Best regards,<br>IKIMINA WALLET System</p>
              </div>
            `;
            sendLoanRequestEmail(admin.email, emailSubject, emailHtml, admin.id).catch(err => {
              console.error(`[requestLoan] Failed to send email to ${admin.role} ${admin.name}:`, err);
            });
          }
        }

        // Notify all group members about the loan request
        try {
          const allGroupMembers = await User.findAll({
            where: {
              groupId: member.groupId,
              status: 'active',
              id: { [Op.ne]: memberId } // Exclude the requester
            },
            attributes: ['id', 'name', 'phone', 'email']
          });

          console.log(`[requestLoan] Notifying ${allGroupMembers.length} group members about the loan request`);

          const memberNotificationMessage = `${member.name} has requested a loan of ${principal.toLocaleString()} RWF for ${purpose}. The request is pending approval from Group Admin, Secretary, and Cashier.`;

          // Create in-app notifications for all group members
          const memberNotificationPromises = allGroupMembers.map(groupMember =>
            Notification.create({
              userId: groupMember.id,
              type: 'announcement',
              channel: 'in_app',
              title: 'New Loan Request in Your Group',
              content: memberNotificationMessage,
              status: 'sent'
            })
          );
          await Promise.all(memberNotificationPromises);
          console.log(`[requestLoan] Created in-app notifications for ${allGroupMembers.length} group members`);

          // Send SMS to group members (fire-and-forget, optional)
          for (const groupMember of allGroupMembers) {
            if (groupMember.phone) {
              const smsMessage = `Group Update: ${member.name} requested ${principal.toLocaleString()} RWF loan. Awaiting approval.`;
              sendSMS(groupMember.phone, smsMessage, groupMember.id, 'announcement').catch(err => {
                console.warn(`[requestLoan] Failed to send SMS to group member ${groupMember.name}:`, err.message);
              });
            }
          }
        } catch (memberNotifError) {
          console.error('[requestLoan] Error notifying group members:', memberNotifError);
          // Don't fail the loan request if member notifications fail
        }

      } catch (notifError) {
        console.error('[requestLoan] Error sending notifications:', notifError);
        // Don't fail the loan request if notifications fail
      }
    });

    res.status(201).json({
      success: true,
      message: 'Loan request submitted successfully. Group Admin, Secretary, and Cashier have been notified. All group members have been informed.',
      data: {
        loan,
        aiRecommendation: aiRec
      }
    });
  } catch (error) {
    console.error('Request loan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit loan request',
      error: error.message
    });
  }
};

/**
 * Get all loans for a member
 * GET /api/loans/member
 */
const getMemberLoans = async (req, res) => {
  try {
    const memberId = req.user.id;

    const loans = await Loan.findAll({
      where: { memberId },
      order: [['createdAt', 'DESC']],
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'] },
        { association: 'guarantor', attributes: ['id', 'name', 'phone', 'nationalId'] }
      ]
    });

    res.json({
      success: true,
      data: loans
    });
  } catch (error) {
    console.error('Get member loans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loans',
      error: error.message
    });
  }
};

/**
 * Get all loan requests (Group Admin)
 * GET /api/loans/requests
 */
const getLoanRequests = async (req, res) => {
  try {
    console.log('[getLoanRequests] ========== FUNCTION CALLED ==========');
    const { status } = req.query;
    const user = req.user;

    console.log(`[getLoanRequests] Request received from user ${user?.id} (role: ${user?.role}, groupId: ${user?.groupId})`);
    console.log(`[getLoanRequests] Query params: status=${status}`);
    console.log(`[getLoanRequests] Request URL: ${req.originalUrl}`);
    console.log(`[getLoanRequests] Request path: ${req.path}`);

    let whereClause = {};
    
    // Group Admin only sees their group's loans
    // Agents and System Admins see all loans
    if (user.role === 'Group Admin' && user.groupId) {
      whereClause.groupId = user.groupId;
      console.log(`[getLoanRequests] Filtering by groupId: ${user.groupId}`);
    } else if (user.role === 'Agent' || user.role === 'System Admin') {
      // Agents and System Admins see all loans - no groupId filter
      console.log(`[getLoanRequests] User is ${user.role} - returning all loans`);
    }

    if (status && status !== 'all') {
      whereClause.status = status;
      console.log(`[getLoanRequests] Filtering by status: ${status}`);
    }

    const loans = await Loan.findAll({
      where: whereClause,
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone', 'totalSavings', 'creditScore'], required: false },
        { association: 'group', attributes: ['id', 'name', 'code'], required: false },
        { association: 'guarantor', attributes: ['id', 'name', 'phone', 'nationalId'], required: false }
      ],
      order: [['requestDate', 'DESC']]
    });

    console.log(`[getLoanRequests] Found ${loans.length} loans`);

    res.json({
      success: true,
      data: loans
    });
  } catch (error) {
    console.error('[getLoanRequests] Error:', error);
    console.error('[getLoanRequests] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan requests',
      error: error.message
    });
  }
};

/**
 * Approve loan request
 * PUT /api/loans/:id/approve
 */
const approveLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { disbursementDate } = req.body;
    const approverId = req.user.id;

    const loan = await Loan.findByPk(id, {
      include: [{ association: 'member' }, { association: 'group' }]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    if (loan.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Loan is not pending approval'
      });
    }

    // Update loan status
    loan.status = 'approved';
    loan.approvedBy = approverId;
    loan.approvalDate = new Date();
    if (disbursementDate) {
      loan.disbursementDate = new Date(disbursementDate);
      loan.status = 'disbursed';
    } else {
      loan.nextPaymentDate = new Date();
      loan.nextPaymentDate.setMonth(loan.nextPaymentDate.getMonth() + 1);
    }
    await loan.save();

    // Create transaction record
    await Transaction.create({
      userId: loan.memberId,
      type: 'loan_disbursement',
      amount: loan.amount,
      balance: loan.member.totalSavings,
      status: 'completed',
      referenceId: loan.id.toString(),
      referenceType: 'Loan',
      description: `Loan disbursement: ${loan.purpose}`
    });

    // Send notifications asynchronously (non-blocking)
    setImmediate(async () => {
      try {
        const groupId = loan.groupId || loan.member?.groupId;
        if (!groupId) {
          console.error('[approveLoan] No groupId found for loan');
          return;
        }

        // Fetch all group members
        const allGroupMembers = await User.findAll({
          where: {
            groupId: groupId,
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'role']
        });

        console.log(`[approveLoan] Found ${allGroupMembers.length} group members to notify`);

        // Notify the loan requester
    try {
      // Create in-app notification for the requester
      await Notification.create({
        userId: loan.memberId,
        type: 'loan_approval',
        channel: 'in_app',
        title: 'Loan Approved!',
        content: `Congratulations! Your loan request of ${loan.amount.toLocaleString()} RWF has been approved. Monthly payment: ${loan.monthlyPayment.toLocaleString()} RWF. Loan ID: ${loan.id}.`,
        status: 'sent'
      });
      console.log(`[approveLoan] Created in-app notification for loan requester (member ${loan.memberId})`);

          // Send SMS notification to requester
      if (loan.member.phone) {
            sendLoanApproval(loan.member.phone, loan.member.name, loan.amount)
              .catch(err => console.error(`[approveLoan] Failed to send SMS to requester:`, err));
      }

          // Send Email notification to requester
      if (loan.member.email) {
            sendLoanApprovalEmail(
          loan.member.email,
          loan.member.name,
          loan.amount,
          loan.monthlyPayment,
          loan.duration
            ).catch(err => console.error(`[approveLoan] Failed to send email to requester:`, err));
          }
        } catch (requesterNotifError) {
          console.error('[approveLoan] Error notifying requester:', requesterNotifError);
        }

        // Notify all group members (excluding the requester)
        const otherMembers = allGroupMembers.filter(m => m.id !== loan.memberId);
        const memberNotificationMessage = `New loan approved: ${loan.member.name} received a loan of ${loan.amount.toLocaleString()} RWF. Loan ID: ${loan.id}.`;
        
        for (const member of otherMembers) {
          try {
            await Notification.create({
              userId: member.id,
              type: 'loan_approval',
              channel: 'in_app',
              title: 'Loan Approved in Your Group',
              content: memberNotificationMessage,
              status: 'sent'
            });
          } catch (memberNotifError) {
            console.error(`[approveLoan] Failed to create notification for member ${member.id}:`, memberNotifError);
          }
        }
        console.log(`[approveLoan] Created in-app notifications for ${otherMembers.length} group members`);

        // Notify Cashier specifically
        const cashiers = allGroupMembers.filter(m => m.role === 'Cashier');
        for (const cashier of cashiers) {
          try {
            await Notification.create({
              userId: cashier.id,
              type: 'loan_approval',
              channel: 'in_app',
              title: 'Loan Approved - Record Required',
              content: `Loan approved: ${loan.member.name} - ${loan.amount.toLocaleString()} RWF. Loan ID: ${loan.id}. Please update your records.`,
              status: 'sent'
            });
            console.log(`[approveLoan] Created notification for Cashier ${cashier.name}`);

            // Send email to cashier if available
            if (cashier.email) {
              sendLoanRequestEmail(
                cashier.email,
                'Loan Approved - Update Records',
                `<p>Dear ${cashier.name},</p>
                <p>A loan has been approved in your group:</p>
                <ul>
                  <li><strong>Member:</strong> ${loan.member.name}</li>
                  <li><strong>Amount:</strong> ${loan.amount.toLocaleString()} RWF</li>
                  <li><strong>Purpose:</strong> ${loan.purpose}</li>
                  <li><strong>Duration:</strong> ${loan.duration} months</li>
                  <li><strong>Monthly Payment:</strong> ${loan.monthlyPayment.toLocaleString()} RWF</li>
                  <li><strong>Loan ID:</strong> ${loan.id}</li>
                </ul>
                <p>Please update your records accordingly.</p>`,
                cashier.id
              ).catch(err => console.error(`[approveLoan] Failed to send email to Cashier:`, err));
            }
          } catch (cashierNotifError) {
            console.error(`[approveLoan] Failed to notify Cashier ${cashier.id}:`, cashierNotifError);
          }
        }

        // Notify Secretary
        const secretaries = allGroupMembers.filter(m => m.role === 'Secretary');
        for (const secretary of secretaries) {
          try {
            await Notification.create({
              userId: secretary.id,
              type: 'loan_approval',
              channel: 'in_app',
              title: 'Loan Approved',
              content: `Loan approved: ${loan.member.name} - ${loan.amount.toLocaleString()} RWF. Loan ID: ${loan.id}.`,
              status: 'sent'
            });
          } catch (secretaryNotifError) {
            console.error(`[approveLoan] Failed to notify Secretary ${secretary.id}:`, secretaryNotifError);
          }
      }
    } catch (notifError) {
      console.error('[approveLoan] Notification error:', notifError);
    }
    });

    logAction(approverId, 'LOAN_APPROVED', 'Loan', loan.id, { memberId: loan.memberId, amount: loan.amount }, req);

    // Auto-create document for approved loan
    setImmediate(async () => {
      try {
        const { autoCreateDocumentFromLoan } = require('./documentation.controller');
        const fileUrl = `/loans/${loan.id}`;
        const fileName = `loan-${loan.id}-${loan.purpose?.replace(/[^a-z0-9]/gi, '_') || loan.id}.txt`;
        await autoCreateDocumentFromLoan(loan.id, fileUrl, fileName);
        console.log(`[approveLoan] Auto-created document for loan ${loan.id}`);
      } catch (docError) {
        console.error('[approveLoan] Error creating document:', docError);
        // Don't fail the request if document creation fails
      }
    });

    res.json({
      success: true,
      message: 'Loan approved successfully',
      data: loan
    });
  } catch (error) {
    console.error('Approve loan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve loan',
      error: error.message
    });
  }
};

/**
 * Reject loan request
 * PUT /api/loans/:id/reject
 */
const rejectLoan = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approverId = req.user.id;

    const loan = await Loan.findByPk(id, {
      include: [{ association: 'member' }]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    if (loan.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Loan is not pending approval'
      });
    }

    loan.status = 'rejected';
    loan.approvedBy = approverId;
    loan.approvalDate = new Date();
    loan.rejectionReason = reason || 'Not specified';
    await loan.save();

    // Send notifications to loan requester
    try {
      // Create in-app notification for the requester
      await Notification.create({
        userId: loan.memberId,
        type: 'loan_rejection',
        channel: 'in_app',
        title: 'Loan Request Rejected',
        content: `Your loan request of ${loan.amount.toLocaleString()} RWF has been rejected. Reason: ${loan.rejectionReason || 'Not specified'}. Loan ID: ${loan.id}.`,
        status: 'sent'
      });
      console.log(`[rejectLoan] Created in-app notification for loan requester (member ${loan.memberId})`);

      // Send SMS notification
      if (loan.member.phone) {
        await sendLoanRejection(loan.member.phone, loan.member.name, loan.rejectionReason);
      }

      // Send Email notification
      if (loan.member.email) {
        await sendLoanRejectionEmail(loan.member.email, loan.member.name, loan.rejectionReason);
      }
    } catch (notifError) {
      console.error('[rejectLoan] Notification error:', notifError);
    }

    logAction(approverId, 'LOAN_REJECTED', 'Loan', loan.id, { 
      memberId: loan.memberId, 
      memberName: loan.member?.name || 'Member',
      reason: reason || 'Not specified'
    }, req);

    res.json({
      success: true,
      message: 'Loan rejected',
      data: loan
    });
  } catch (error) {
    console.error('Reject loan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject loan',
      error: error.message
    });
  }
};

/**
 * Get single loan details
 * GET /api/loans/:id
 */
const getLoanById = async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`[getLoanById] ========== FUNCTION CALLED ==========`);
    console.log(`[getLoanById] Request received for loan ID: ${id}`);
    console.log(`[getLoanById] Request URL: ${req.originalUrl}`);
    console.log(`[getLoanById] Request path: ${req.path}`);
    
    // If the ID is "requests", this is a routing error - should have matched /requests route
    if (id === 'requests' || id === 'member' || id === 'request') {
      console.error(`[getLoanById] ❌❌❌ ROUTE CONFLICT DETECTED! ❌❌❌`);
      console.error(`[getLoanById] ID "${id}" should have matched a specific route above.`);
      console.error(`[getLoanById] This means the route order is wrong or server wasn't restarted!`);
      return res.status(404).json({
        success: false,
        message: `Route not found. The endpoint "/loans/${id}" is not valid. Please restart the backend server.`
      });
    }

    const loan = await Loan.findByPk(id, {
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone', 'totalSavings', 'creditScore'] },
        { association: 'group', attributes: ['id', 'name', 'code'] },
        { association: 'guarantor', attributes: ['id', 'name', 'phone', 'nationalId'] }
      ]
    });

    if (!loan) {
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    res.json({
      success: true,
      data: loan
    });
  } catch (error) {
    console.error('Get loan error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan',
      error: error.message
    });
  }
};

/**
 * Make loan payment
 * POST /api/loans/:id/pay
 */
const makeLoanPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod } = req.body;
    const memberId = req.user.id;

    console.log('[makeLoanPayment] Request received:', {
      loanId: id,
      amount,
      paymentMethod,
      memberId,
      body: req.body
    });

    const loan = await Loan.findByPk(id, {
      include: [
        { association: 'member' },
        { association: 'group' }
      ]
    });

    if (!loan) {
      console.log('[makeLoanPayment] Loan not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Loan not found'
      });
    }

    console.log('[makeLoanPayment] Loan found:', {
      id: loan.id,
      memberId: loan.memberId,
      status: loan.status,
      remainingAmount: loan.remainingAmount
    });

    if (loan.memberId !== memberId) {
      console.log('[makeLoanPayment] Member mismatch:', { loanMemberId: loan.memberId, requestMemberId: memberId });
      return res.status(403).json({
        success: false,
        message: 'You can only pay your own loans'
      });
    }

    // Check if loan status allows payments
    const rawStatus = loan.status;
    if (!rawStatus) {
      console.error('[makeLoanPayment] Loan status is missing');
      return res.status(400).json({
        success: false,
        message: 'Loan status is missing. Cannot process payment.'
      });
    }
    
    const loanStatus = String(rawStatus).trim().toLowerCase();
    const allowedStatuses = ['active', 'disbursed', 'approved'];
    const isStatusAllowed = allowedStatuses.includes(loanStatus);
    
    console.log('[makeLoanPayment] Status check:', {
      rawStatus: rawStatus,
      loanStatus: loanStatus,
      statusType: typeof rawStatus,
      allowedStatuses,
      isAllowed: isStatusAllowed
    });
    
    if (!isStatusAllowed) {
      console.error('[makeLoanPayment] Loan status invalid - rejecting payment:', {
        rawStatus: rawStatus,
        normalizedStatus: loanStatus,
        statusType: typeof rawStatus,
        allowedStatuses
      });
      return res.status(400).json({
        success: false,
        message: `Loan is not active. Current status: "${rawStatus}". Only loans with status 'active', 'disbursed', or 'approved' can be paid.`
      });
    }
    
    console.log('[makeLoanPayment] Status check passed, proceeding with payment');

    // Validate and parse payment amount
    console.log('[makeLoanPayment] Validating amount:', {
      amount,
      amountType: typeof amount,
      isNull: amount === null,
      isUndefined: amount === undefined,
      isEmpty: amount === ''
    });
    
    if (amount === null || amount === undefined || amount === '' || (typeof amount === 'string' && amount.trim() === '')) {
      console.error('[makeLoanPayment] Amount validation failed - amount is missing');
      return res.status(400).json({
        success: false,
        message: 'Payment amount is required'
      });
    }

    const paymentAmount = parseFloat(amount);
    console.log('[makeLoanPayment] Parsed amount:', {
      original: amount,
      parsed: paymentAmount,
      isNaN: isNaN(paymentAmount),
      isFinite: isFinite(paymentAmount)
    });
    
    if (isNaN(paymentAmount) || !isFinite(paymentAmount)) {
      console.error('[makeLoanPayment] Amount validation failed - invalid number');
      return res.status(400).json({
        success: false,
        message: 'Invalid payment amount. Please provide a valid number.'
      });
    }

    if (paymentAmount <= 0) {
      console.error('[makeLoanPayment] Amount validation failed - amount is zero or negative');
      return res.status(400).json({
        success: false,
        message: 'Payment amount must be greater than zero'
      });
    }

    // Get remaining amount - check both remainingAmount and remainingBalance fields
    const remainingBefore = parseFloat(loan.remainingAmount || loan.remainingBalance || 0);
    
    console.log('[makeLoanPayment] Amount validation:', {
      paymentAmount,
      remainingAmount: loan.remainingAmount,
      remainingBalance: loan.remainingBalance,
      remainingBefore,
      totalAmount: loan.totalAmount,
      paidAmount: loan.paidAmount
    });
    
    if (remainingBefore <= 0) {
      return res.status(400).json({
        success: false,
        message: 'This loan has no remaining balance to pay'
      });
    }
    
    if (paymentAmount > remainingBefore) {
      return res.status(400).json({
        success: false,
        message: `Payment amount (${paymentAmount.toLocaleString()} RWF) cannot exceed remaining balance of ${remainingBefore.toLocaleString()} RWF`
      });
    }

    // Update loan
    loan.paidAmount = parseFloat(loan.paidAmount || 0) + paymentAmount;
    loan.remainingAmount = Math.max(0, remainingBefore - paymentAmount);

    const isFullyPaid = loan.remainingAmount <= 0;
    if (isFullyPaid) {
      loan.status = 'completed';
      loan.nextPaymentDate = null;
    } else {
      // Update next payment date (default to monthly)
      loan.nextPaymentDate = new Date();
      loan.nextPaymentDate.setMonth(loan.nextPaymentDate.getMonth() + 1);
    }

    await loan.save();

    // Create transaction
    await Transaction.create({
      userId: memberId,
      type: 'loan_payment',
      amount: paymentAmount,
      balance: loan.member.totalSavings,
      status: 'completed',
      referenceId: loan.id.toString(),
      referenceType: 'Loan',
      paymentMethod: paymentMethod || 'cash',
      description: `Loan payment: ${loan.purpose}`
    });

    logAction(memberId, 'LOAN_PAYMENT', 'Loan', loan.id, { amount: paymentAmount, remainingAmount: loan.remainingAmount }, req);

    // Send notifications to Group Admin, Secretary, and Cashier asynchronously
    setImmediate(async () => {
      try {
        const admins = await User.findAll({
          where: {
            groupId: loan.groupId,
            role: { [Op.in]: ['Group Admin', 'Secretary', 'Cashier'] },
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'role']
        });

        const paymentStatus = isFullyPaid ? 'fully paid' : 'partially paid';
        const notificationMessage = `Loan payment received: ${loan.member.name} paid ${paymentAmount.toLocaleString()} RWF for loan #${loan.id} (${loan.purpose}). Status: ${paymentStatus}. Remaining balance: ${loan.remainingAmount.toLocaleString()} RWF.`;

        // Create in-app notifications
        const notificationPromises = admins.map(admin =>
          Notification.create({
            userId: admin.id,
            type: 'loan_payment',
            channel: 'in_app',
            title: `Loan Payment - ${paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1)}`,
            content: notificationMessage,
            status: 'sent'
          })
        );
        await Promise.all(notificationPromises);

        // Send SMS notifications (fire-and-forget)
        const { sendSMS } = require('../notifications/smsService');
        admins.forEach(admin => {
          if (admin.phone) {
            sendSMS(admin.phone, notificationMessage, admin.id, 'loan_payment')
              .catch(smsError => console.error(`Failed to send SMS to ${admin.name}:`, smsError));
          }
        });

        console.log(`[makeLoanPayment] Notified ${admins.length} admins about loan payment`);
      } catch (notifError) {
        console.error('[makeLoanPayment] Error sending notifications:', notifError);
        // Don't fail the payment if notifications fail
      }
    });

    res.json({
      success: true,
      message: isFullyPaid ? 'Payment processed successfully! Loan is now fully paid.' : 'Payment processed successfully',
      data: {
        ...loan.toJSON(),
        remainingAmount: loan.remainingAmount,
        paidAmount: loan.paidAmount,
        status: loan.status
      },
      memberName: loan.member.name,
      groupName: loan.group?.name || 'Group'
    });
  } catch (error) {
    console.error('Loan payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: error.message
    });
  }
};

/**
 * Get all loan products
 * GET /api/loans/products
 */
const getLoanProducts = async (req, res) => {
  try {
    const products = await LoanProduct.findAll({
      order: [['createdAt', 'DESC']]
    });

    // Get statistics for each product
    const productsWithStats = await Promise.all(products.map(async (product) => {
      const loans = await Loan.findAll({
        where: {
          // Match loans that fall within this product's amount range
          amount: {
            [Op.gte]: product.minAmount,
            [Op.lte]: product.maxAmount
          }
        }
      });

      const applications = loans.length;
      const approved = loans.filter(l => l.status === 'approved' || l.status === 'disbursed' || l.status === 'active' || l.status === 'completed').length;
      const rejected = loans.filter(l => l.status === 'rejected').length;

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        type: product.name.split(' ')[0] || 'General', // Extract type from name
        minAmount: parseFloat(product.minAmount),
        maxAmount: parseFloat(product.maxAmount),
        interestRate: parseFloat(product.interestRate),
        termMonths: product.termMonths,
        status: 'Active', // Default status
        applications,
        approved,
        rejected,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt
      };
    }));

    res.json({
      success: true,
      data: productsWithStats
    });
  } catch (error) {
    console.error('Get loan products error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan products',
      error: error.message
    });
  }
};

/**
 * Create loan product
 * POST /api/loans/products
 */
const createLoanProduct = async (req, res) => {
  try {
    const { name, description, minAmount, maxAmount, interestRate, termMonths } = req.body;

    if (!name || !minAmount || !maxAmount || !interestRate || !termMonths) {
      return res.status(400).json({
        success: false,
        message: 'Name, min amount, max amount, interest rate, and term are required'
      });
    }

    const product = await LoanProduct.create({
      name,
      description: description || null,
      minAmount: parseFloat(minAmount),
      maxAmount: parseFloat(maxAmount),
      interestRate: parseFloat(interestRate),
      termMonths: parseInt(termMonths)
    });

    res.status(201).json({
      success: true,
      message: 'Loan product created successfully',
      data: product
    });
  } catch (error) {
    console.error('Create loan product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create loan product',
      error: error.message
    });
  }
};

/**
 * Update loan product
 * PUT /api/loans/products/:id
 */
const updateLoanProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, minAmount, maxAmount, interestRate, termMonths } = req.body;

    const product = await LoanProduct.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Loan product not found'
      });
    }

    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (minAmount) product.minAmount = parseFloat(minAmount);
    if (maxAmount) product.maxAmount = parseFloat(maxAmount);
    if (interestRate) product.interestRate = parseFloat(interestRate);
    if (termMonths) product.termMonths = parseInt(termMonths);

    await product.save();

    res.json({
      success: true,
      message: 'Loan product updated successfully',
      data: product
    });
  } catch (error) {
    console.error('Update loan product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update loan product',
      error: error.message
    });
  }
};

/**
 * Delete loan product
 * DELETE /api/loans/products/:id
 */
const deleteLoanProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const product = await LoanProduct.findByPk(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Loan product not found'
      });
    }

    await product.destroy();

    res.json({
      success: true,
      message: 'Loan product deleted successfully'
    });
  } catch (error) {
    console.error('Delete loan product error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete loan product',
      error: error.message
    });
  }
};

/**
 * Get credit scoring configuration
 * GET /api/loans/scoring/config
 */
const getCreditScoringConfig = async (req, res) => {
  try {
    const { Setting } = require('../models');
    
    // Default configuration
    const defaultConfig = {
      scoringParameters: {
        contributionConsistency: 40, // 40% = 400 points
        loanPaymentHistory: 30,      // 30% = 300 points
        savingsAmount: 20,           // 20% = 200 points
        accountAge: 10               // 10% = 100 points
      },
      riskThresholds: {
        lowRisk: { min: 800, max: 1000 },
        mediumRisk: { min: 500, max: 799 },
        highRisk: { min: 0, max: 499 }
      },
      aiRecommendationThresholds: {
        approve: { min: 650, max: 1000 },
        review: { min: 300, max: 649 },
        reject: { min: 0, max: 299 }
      },
      mlModelEnabled: true
    };

    // Try to get saved configuration
    const scoringConfig = await Setting.findOne({ where: { key: 'credit_scoring_config' } });
    
    if (scoringConfig && scoringConfig.value) {
      try {
        const savedConfig = JSON.parse(scoringConfig.value);
        // Merge with defaults to ensure all fields exist
        const mergedConfig = {
          scoringParameters: { ...defaultConfig.scoringParameters, ...(savedConfig.scoringParameters || {}) },
          riskThresholds: { ...defaultConfig.riskThresholds, ...(savedConfig.riskThresholds || {}) },
          aiRecommendationThresholds: { ...defaultConfig.aiRecommendationThresholds, ...(savedConfig.aiRecommendationThresholds || {}) },
          mlModelEnabled: savedConfig.mlModelEnabled !== undefined ? savedConfig.mlModelEnabled : defaultConfig.mlModelEnabled
        };
        return res.json({ success: true, data: mergedConfig });
      } catch (parseError) {
        console.error('Error parsing credit scoring config:', parseError);
      }
    }

    // Return default configuration
    res.json({ success: true, data: defaultConfig });
  } catch (error) {
    console.error('Get credit scoring config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch credit scoring configuration',
      error: error.message
    });
  }
};

/**
 * Update credit scoring configuration
 * PUT /api/loans/scoring/config
 */
const updateCreditScoringConfig = async (req, res) => {
  try {
    const { Setting } = require('../models');
    const { scoringParameters, riskThresholds, aiRecommendationThresholds, mlModelEnabled } = req.body;

    // Validate scoring parameters sum to 100%
    if (scoringParameters) {
      const total = Object.values(scoringParameters).reduce((sum, val) => sum + parseFloat(val || 0), 0);
      if (Math.abs(total - 100) > 0.01) {
        return res.status(400).json({
          success: false,
          message: 'Scoring parameters must sum to 100%'
        });
      }
    }

    // Validate risk thresholds don't overlap
    if (riskThresholds) {
      const { lowRisk, mediumRisk, highRisk } = riskThresholds;
      if (lowRisk && mediumRisk && highRisk) {
        if (lowRisk.min <= mediumRisk.max || mediumRisk.min <= highRisk.max) {
          return res.status(400).json({
            success: false,
            message: 'Risk thresholds must not overlap'
          });
        }
      }
    }

    const config = {
      scoringParameters: scoringParameters || undefined,
      riskThresholds: riskThresholds || undefined,
      aiRecommendationThresholds: aiRecommendationThresholds || undefined,
      mlModelEnabled: mlModelEnabled !== undefined ? mlModelEnabled : undefined
    };

    // Remove undefined values
    Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);

    // Get existing config and merge
    const existing = await Setting.findOne({ where: { key: 'credit_scoring_config' } });
    let finalConfig = {};
    
    if (existing && existing.value) {
      try {
        finalConfig = JSON.parse(existing.value);
      } catch (e) {
        // If parse fails, start fresh
      }
    }

    // Merge new config with existing
    finalConfig = {
      ...finalConfig,
      ...config,
      scoringParameters: { ...finalConfig.scoringParameters, ...(config.scoringParameters || {}) },
      riskThresholds: { ...finalConfig.riskThresholds, ...(config.riskThresholds || {}) },
      aiRecommendationThresholds: { ...finalConfig.aiRecommendationThresholds, ...(config.aiRecommendationThresholds || {}) }
    };

    // Save to database
    await Setting.upsert({
      key: 'credit_scoring_config',
      value: JSON.stringify(finalConfig)
    });

    logAction(req.user.id, 'UPDATE_CREDIT_SCORING_CONFIG', 'Setting', null, finalConfig, req);

    res.json({
      success: true,
      message: 'Credit scoring configuration updated successfully',
      data: finalConfig
    });
  } catch (error) {
    console.error('Update credit scoring config error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update credit scoring configuration',
      error: error.message
    });
  }
};

/**
 * Get loan statistics for System Admin
 * GET /api/loans/stats
 */
const getLoanStats = async (req, res) => {
  try {
    // Get all loans (System Admin sees all)
    const allLoans = await Loan.findAll({
      include: [
        { association: 'member', attributes: ['id', 'name'], required: false },
        { association: 'group', attributes: ['id', 'name'], required: false }
      ]
    });

    const activeProducts = await LoanProduct.count();
    const pendingRequests = allLoans.filter(l => l.status === 'pending').length;
    const totalApproved = allLoans.filter(l => l.status === 'approved' || l.status === 'disbursed' || l.status === 'active' || l.status === 'completed').length;
    const totalValue = allLoans
      .filter(l => ['approved', 'disbursed', 'active', 'completed'].includes(l.status))
      .reduce((sum, loan) => sum + parseFloat(loan.amount || 0), 0);

    res.json({
      success: true,
      data: {
        activeProducts,
        pendingRequests,
        totalApproved,
        totalValue: totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })
      }
    });
  } catch (error) {
    console.error('Get loan stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loan statistics',
      error: error.message
    });
  }
};

module.exports = {
  requestLoan,
  getMemberLoans,
  getLoanRequests,
  approveLoan,
  rejectLoan,
  getLoanById,
  makeLoanPayment,
  getLoanProducts,
  createLoanProduct,
  updateLoanProduct,
  deleteLoanProduct,
  getLoanStats,
  getCreditScoringConfig,
  updateCreditScoringConfig
};

