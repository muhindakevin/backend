const { Fine, User, Group, Transaction } = require('../models');
const { sendFineNotification } = require('../notifications/smsService');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');

/**
 * Issue a fine
 * POST /api/fines
 */
const issueFine = async (req, res) => {
  try {
    const { memberId, amount, reason, dueDate } = req.body;
    const issuerId = req.user.id;

    if (!memberId || !amount || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Member ID, amount, and reason are required'
      });
    }

    const member = await User.findByPk(memberId);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: 'Member not found'
      });
    }

    if (!member.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Member must belong to a group'
      });
    }

    const fine = await Fine.create({
      memberId,
      groupId: member.groupId,
      amount: parseFloat(amount),
      reason,
      dueDate: dueDate ? new Date(dueDate) : null,
      issuedBy: issuerId,
      status: 'pending'
    });

    // Send in-app notification and SMS
    try {
      const { Notification } = require('../models');
      
      // Create in-app notification
      await Notification.create({
        userId: memberId,
        type: 'fine_issued',
        channel: 'in_app',
        title: 'Fine Issued',
        content: `You have been issued a fine of ${fine.amount.toLocaleString()} RWF. Reason: ${reason}`,
        status: 'sent'
      });
      
      console.log(`[issueFine] Created in-app notification for member ${memberId}`);
      
      // Send SMS notification
      if (member.phone) {
        await sendFineNotification(member.phone, member.name, fine.amount, reason).catch(err => {
          console.error(`[issueFine] Failed to send SMS to ${member.phone}:`, err.message);
        });
      }
    } catch (notifError) {
      console.error('[issueFine] Notification error:', notifError);
    }

    logAction(issuerId, 'FINE_ISSUED', 'Fine', fine.id, { memberId, amount, reason }, req);

    res.status(201).json({
      success: true,
      message: 'Fine issued successfully',
      data: fine
    });
  } catch (error) {
    console.error('Issue fine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to issue fine',
      error: error.message
    });
  }
};

/**
 * Get member fines
 * GET /api/fines/member
 */
const getMemberFines = async (req, res) => {
  try {
    const memberId = req.user.id;
    const { status } = req.query;

    let whereClause = { memberId };
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const fines = await Fine.findAll({
      where: whereClause,
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'] },
        { association: 'member', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['issuedDate', 'DESC']]
    });

    res.json({
      success: true,
      data: fines
    });
  } catch (error) {
    console.error('Get member fines error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fines',
      error: error.message
    });
  }
};

/**
 * Get all fines (Group Admin)
 * GET /api/fines
 */
const getAllFines = async (req, res) => {
  try {
    const { status, groupId } = req.query;
    const user = req.user;

    let whereClause = {};
    
    if ((user.role === 'Group Admin' || user.role === 'Cashier') && user.groupId) {
      whereClause.groupId = user.groupId;
    } else if (groupId) {
      whereClause.groupId = groupId;
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const fines = await Fine.findAll({
      where: whereClause,
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone'] },
        { association: 'group', attributes: ['id', 'name', 'code'] }
      ],
      order: [['issuedDate', 'DESC']]
    });

    res.json({
      success: true,
      data: fines
    });
  } catch (error) {
    console.error('Get all fines error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch fines',
      error: error.message
    });
  }
};

/**
 * Approve fine
 * PUT /api/fines/:id/approve
 */
const approveFine = async (req, res) => {
  try {
    const { id } = req.params;
    const approverId = req.user.id;

    const fine = await Fine.findByPk(id, {
      include: [{ association: 'member' }]
    });

    if (!fine) {
      return res.status(404).json({
        success: false,
        message: 'Fine not found'
      });
    }

    fine.status = 'approved';
    fine.approvedBy = approverId;
    await fine.save();

    logAction(approverId, 'FINE_APPROVED', 'Fine', fine.id, {}, req);

    res.json({
      success: true,
      message: 'Fine approved',
      data: fine
    });
  } catch (error) {
    console.error('Approve fine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve fine',
      error: error.message
    });
  }
};

/**
 * Pay fine
 * PUT /api/fines/:id/pay
 */
const payFine = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body;
    const memberId = req.user.id;

    const fine = await Fine.findByPk(id, {
      include: [{ association: 'member' }]
    });

    if (!fine) {
      return res.status(404).json({
        success: false,
        message: 'Fine not found'
      });
    }

    if (fine.memberId !== memberId) {
      return res.status(403).json({
        success: false,
        message: 'You can only pay your own fines'
      });
    }

    if (fine.status !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'Fine must be approved before payment'
      });
    }

    fine.status = 'paid';
    fine.paidDate = new Date();
    await fine.save();

    // Create transaction
    await Transaction.create({
      userId: memberId,
      type: 'fine_payment',
      amount: fine.amount,
      balance: fine.member.totalSavings,
      status: 'completed',
      referenceId: fine.id.toString(),
      referenceType: 'Fine',
      paymentMethod: paymentMethod || 'cash',
      description: `Fine payment: ${fine.reason}`
    });

    logAction(memberId, 'FINE_PAID', 'Fine', fine.id, { amount: fine.amount }, req);

    res.json({
      success: true,
      message: 'Fine paid successfully',
      data: fine
    });
  } catch (error) {
    console.error('Pay fine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pay fine',
      error: error.message
    });
  }
};

/**
 * Verify fine payment (Cashier/Admin)
 * PUT /api/fines/:id/verify-payment
 * Allows cashiers to verify and mark fine as paid
 */
const verifyFinePayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body;
    const verifierId = req.user.id;
    const userRole = req.user.role;

    // Only Cashier, Group Admin, or System Admin can verify payments
    if (!['Cashier', 'Group Admin', 'System Admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only cashiers and admins can verify fine payments'
      });
    }

    const fine = await Fine.findByPk(id, {
      include: [{ association: 'member' }, { association: 'group' }]
    });

    if (!fine) {
      return res.status(404).json({
        success: false,
        message: 'Fine not found'
      });
    }

    // Check if user has access to this group's fines
    if ((userRole === 'Cashier' || userRole === 'Group Admin') && req.user.groupId !== fine.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only verify fines from your own group'
      });
    }

    // Approve fine if pending
    if (fine.status === 'pending') {
      fine.status = 'approved';
      fine.approvedBy = verifierId;
      await fine.save();
    }

    // Mark as paid
    if (fine.status !== 'paid') {
      fine.status = 'paid';
      fine.paidDate = new Date();
      fine.verifiedBy = verifierId;
      await fine.save();

      // Create transaction
      await Transaction.create({
        userId: fine.memberId,
        type: 'fine_payment',
        amount: fine.amount,
        balance: fine.member.totalSavings || 0,
        status: 'completed',
        referenceId: fine.id.toString(),
        referenceType: 'Fine',
        paymentMethod: paymentMethod || 'cash',
        description: `Fine payment verified: ${fine.reason}`
      });

      logAction(verifierId, 'FINE_PAYMENT_VERIFIED', 'Fine', fine.id, { 
        amount: fine.amount, 
        memberId: fine.memberId,
        verifiedBy: verifierId 
      }, req);

      // Send notifications to Group Admin, Secretary, all members, and email to fined person
      try {
        const { Notification } = require('../models');
        const { sendEmail } = require('../notifications/emailService');

        // Get all group members
        const groupMembers = await User.findAll({
          where: {
            groupId: fine.groupId,
            status: 'active'
          },
          attributes: ['id', 'name', 'email', 'role']
        });

        // Get Group Admin and Secretary
        const admins = groupMembers.filter(m => ['Group Admin', 'Secretary'].includes(m.role));

        // Notify all group members (including Group Admin and Secretary)
        const notificationPromises = groupMembers.map(member =>
          Notification.create({
            userId: member.id,
            type: 'fine_paid',
            channel: 'in_app',
            title: 'Fine Payment Confirmed',
            content: `${fine.member.name} has paid a fine of ${fine.amount.toLocaleString()} RWF. Reason: ${fine.reason}. ${fine.waiverReason ? `Notes: ${fine.waiverReason}` : ''}`,
            status: 'sent'
          }).catch(err => {
            console.error(`Failed to create notification for member ${member.id}:`, err);
            return null;
          })
        );

        await Promise.all(notificationPromises);

        // Send email to the fined person
        if (fine.member.email) {
          sendEmail(
            fine.member.email,
            'Fine Payment Confirmed - IKIMINA WALLET',
            `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                <div style="background-color: #1e40af; padding: 25px; text-align: center; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px;">
                  <h1 style="color: #ffffff; font-size: 28px; margin: 0;">Fine Payment Confirmed</h1>
                </div>
                <p style="font-size: 16px; color: #333333; margin-bottom: 15px;">Dear ${fine.member.name},</p>
                <p style="font-size: 16px; color: #333333; margin-bottom: 25px;">Your fine payment has been confirmed and processed successfully.</p>
                
                <div style="background: #e0f2fe; border-left: 4px solid #3b82f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h2 style="color: #1e40af; font-size: 20px; margin-top: 0; margin-bottom: 15px;">Payment Details:</h2>
                  <p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Fine ID:</strong> #${fine.id}</p>
                  <p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Amount Paid:</strong> ${fine.amount.toLocaleString()} RWF</p>
                  <p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Reason:</strong> ${fine.reason}</p>
                  ${fine.waiverReason ? `<p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Notes:</strong> ${fine.waiverReason}</p>` : ''}
                  <p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Payment Date:</strong> ${new Date().toLocaleDateString()}</p>
                  <p style="margin: 5px 0; font-size: 16px; color: #000;"><strong>Verified By:</strong> ${req.user.name}</p>
                </div>
                
                <p style="font-size: 16px; color: #333333; margin-top: 30px;">Your fine has been cleared. Thank you for your payment.</p>
                <p style="font-size: 16px; color: #333333; margin-top: 30px;">Best regards,<br><strong style="color: #1e40af;">IKIMINA WALLET Team</strong></p>
              </div>
            `,
            null,
            'fine_paid'
          ).catch(err => console.error(`Failed to send email to fined person:`, err));
        }

        console.log(`[verifyFinePayment] Notified ${groupMembers.length} members, ${admins.length} admins, and sent email to fined person`);
      } catch (notifError) {
        console.error('Error sending notifications:', notifError);
        // Don't fail the verification if notifications fail
      }
    }

    res.json({
      success: true,
      message: 'Fine payment verified successfully. All members have been notified.',
      data: fine
    });
  } catch (error) {
    console.error('Verify fine payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify fine payment',
      error: error.message
    });
  }
};

/**
 * Waive fine
 * PUT /api/fines/:id/waive
 */
const waiveFine = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approverId = req.user.id;

    const fine = await Fine.findByPk(id);

    if (!fine) {
      return res.status(404).json({
        success: false,
        message: 'Fine not found'
      });
    }

    fine.status = 'waived';
    fine.approvedBy = approverId;
    fine.waiverReason = reason || 'Administrative waiver';
    await fine.save();

    logAction(approverId, 'FINE_WAIVED', 'Fine', fine.id, { reason }, req);

    res.json({
      success: true,
      message: 'Fine waived',
      data: fine
    });
  } catch (error) {
    console.error('Waive fine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to waive fine',
      error: error.message
    });
  }
};

/**
 * Adjust/Update fine
 * PUT /api/fines/:id
 */
const adjustFine = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason, dueDate, notes } = req.body;
    const adjusterId = req.user.id;
    const userRole = req.user.role;

    // Only Cashier, Group Admin, or System Admin can adjust fines
    if (!['Cashier', 'Group Admin', 'System Admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only cashiers and admins can adjust fines'
      });
    }

    const fine = await Fine.findByPk(id, {
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone', 'email'] },
        { association: 'group', attributes: ['id', 'name'] }
      ]
    });

    if (!fine) {
      return res.status(404).json({
        success: false,
        message: 'Fine not found'
      });
    }

    // Check if user has access to this group's fines
    if ((userRole === 'Cashier' || userRole === 'Group Admin') && req.user.groupId !== fine.groupId) {
      return res.status(403).json({
        success: false,
        message: 'You can only adjust fines from your own group'
      });
    }

    // Store old values for notification
    const oldAmount = fine.amount;
    const oldReason = fine.reason;
    const issuerId = fine.issuedBy;

    // Update fine
    if (amount !== undefined) fine.amount = parseFloat(amount);
    if (reason !== undefined) fine.reason = reason.trim();
    if (dueDate !== undefined) fine.dueDate = dueDate ? new Date(dueDate) : null;
    // Store notes in waiverReason field if provided (Fine model doesn't have a notes field)
    if (notes !== undefined && notes) {
      fine.waiverReason = notes.trim();
    }

    await fine.save();

    logAction(adjusterId, 'FINE_ADJUSTED', 'Fine', fine.id, { 
      oldAmount, 
      newAmount: fine.amount, 
      oldReason, 
      newReason: fine.reason,
      adjustedBy: req.user.name 
    }, req);

    // Send notifications asynchronously
    setImmediate(async () => {
      try {
        const { Notification } = require('../models');
        const { sendEmail } = require('../notifications/emailService');

        // Get person who originally charged the fine (issuer)
        let issuer = null;
        if (issuerId) {
          issuer = await User.findByPk(issuerId, { attributes: ['id', 'name', 'email', 'phone'] });
        }

        // Get Group Admin and Secretary
        const admins = await User.findAll({
          where: {
            groupId: fine.groupId,
            role: { [Op.in]: ['Group Admin', 'Secretary'] },
            status: 'active'
          },
          attributes: ['id', 'name', 'email', 'phone']
        });

        // Notify issuer (person who charged the fine)
        if (issuer && issuer.id !== adjusterId) {
          await Notification.create({
            userId: issuer.id,
            type: 'fine_adjusted',
            channel: 'in_app',
            title: 'Fine Adjusted',
            content: `Fine #${fine.id} that you charged has been adjusted by ${req.user.name}. Amount: ${oldAmount.toLocaleString()} RWF → ${fine.amount.toLocaleString()} RWF. Reason: ${oldReason} → ${fine.reason}`,
            status: 'sent'
          }).catch(err => console.error(`Failed to notify issuer:`, err));

          if (issuer.email) {
            sendEmail(
              issuer.email,
              'Fine Adjusted - IKIMINA WALLET',
              `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <h2 style="color: #1e40af;">Fine Adjusted</h2>
                  <p>Dear ${issuer.name},</p>
                  <p>A fine that you charged has been adjusted:</p>
                  <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0;">
                    <p><strong>Fine ID:</strong> #${fine.id}</p>
                    <p><strong>Member:</strong> ${fine.member.name}</p>
                    <p><strong>Old Amount:</strong> ${oldAmount.toLocaleString()} RWF</p>
                    <p><strong>New Amount:</strong> ${fine.amount.toLocaleString()} RWF</p>
                    <p><strong>Old Reason:</strong> ${oldReason}</p>
                    <p><strong>New Reason:</strong> ${fine.reason}</p>
                    <p><strong>Adjusted By:</strong> ${req.user.name}</p>
                  </div>
                  <p>Best regards,<br>IKIMINA WALLET Team</p>
                </div>
              `,
              null,
              'fine_adjusted'
            ).catch(err => console.error(`Failed to send email to issuer:`, err));
          }
        }

        // Notify Group Admin and Secretary
        for (const admin of admins) {
          if (admin.id !== adjusterId) {
            await Notification.create({
              userId: admin.id,
              type: 'fine_adjusted',
              channel: 'in_app',
              title: 'Fine Adjusted',
              content: `Fine #${fine.id} for ${fine.member.name} has been adjusted by ${req.user.name}. Amount: ${oldAmount.toLocaleString()} RWF → ${fine.amount.toLocaleString()} RWF.`,
              status: 'sent'
            }).catch(err => console.error(`Failed to notify admin ${admin.id}:`, err));
          }
        }

        console.log(`[adjustFine] Notifications sent for fine adjustment`);
      } catch (notifError) {
        console.error('[adjustFine] Error sending notifications:', notifError);
        // Don't fail the adjustment if notifications fail
      }
    });

    res.json({
      success: true,
      message: 'Fine adjusted successfully. Notifications have been sent.',
      data: fine
    });
  } catch (error) {
    console.error('Adjust fine error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to adjust fine',
      error: error.message
    });
  }
};

module.exports = {
  issueFine,
  getMemberFines,
  getAllFines,
  approveFine,
  payFine,
  waiveFine,
  verifyFinePayment,
  adjustFine
};

