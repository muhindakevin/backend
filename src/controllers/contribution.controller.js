const { Contribution, User, Group, Transaction, Notification, Document, sequelize } = require('../models');
const { sendContributionConfirmation, sendSMS } = require('../notifications/smsService');
const { sendContributionSummary, sendEmail } = require('../notifications/emailService');
const { logAction } = require('../utils/auditLogger');
const { Op } = require('sequelize');

/**
 * Make a contribution
 * POST /api/contributions
 * 
 * IMPORTANT: Contributions are automatically approved and immediately added to member's totalSavings.
 * No approval workflow is required - contributions are instantly reflected in the database.
 */
const makeContribution = async (req, res) => {
  try {
    const { amount, paymentMethod, transactionId, notes } = req.body;
    const memberId = req.user.id;

    if (!amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Amount and payment method are required'
      });
    }

    // Validate amount
    const contributionAmount = parseFloat(amount);
    if (isNaN(contributionAmount) || contributionAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive number'
      });
    }

    // Validate payment method
    const validPaymentMethods = ['cash', 'mtn_mobile_money', 'airtel_money', 'bank_transfer'];
    if (!validPaymentMethods.includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: `Invalid payment method. Must be one of: ${validPaymentMethods.join(', ')}`
      });
    }

    const member = await User.findByPk(memberId, { include: [{ association: 'group' }] });
    if (!member || !member.groupId) {
      return res.status(400).json({
        success: false,
        message: 'Member must belong to a group'
      });
    }

    // Get group contribution settings and validate amount
    const group = await Group.findByPk(member.groupId);
    if (group) {
      const minimumAmount = parseFloat(group.contributionAmount || 0);
      if (minimumAmount > 0 && contributionAmount < minimumAmount) {
        return res.status(400).json({
          success: false,
          message: `Contribution amount must be at least ${minimumAmount.toLocaleString()} RWF. The minimum contribution for this group is ${minimumAmount.toLocaleString()} RWF.`
        });
      }
      // Note: Maximum amount validation can be added if maximumAmount field is added to Group model
    }

    // Generate receipt number with better uniqueness
    const receiptNumber = `REC-${Date.now()}-${memberId}-${Math.random().toString(36).slice(2, 7)}`;

    console.log(`[makeContribution] Starting contribution creation for member ${memberId}, amount: ${contributionAmount} RWF`);

    // Use database transaction to ensure atomicity
    const dbTransaction = await sequelize.transaction();

    try {
      // Get group within transaction
      const group = await Group.findByPk(member.groupId, { transaction: dbTransaction });
      if (!group) {
        await dbTransaction.rollback();
        return res.status(400).json({
          success: false,
          message: 'Group not found'
        });
      }

      // Create contribution with approved status (AUTO-APPROVED - no approval needed)
      // Contribution is immediately added to member's totalSavings within the same transaction
      let contribution;
      let attempts = 0;
      let currentReceiptNumber = receiptNumber;
      
      while (attempts < 3) {
        try {
          contribution = await Contribution.create({
            memberId,
            groupId: member.groupId,
            amount: contributionAmount,
            paymentMethod,
            transactionId: transactionId || null,
            notes: notes || null,
            receiptNumber: currentReceiptNumber,
            status: 'approved',
            approvedBy: memberId,
            approvalDate: new Date()
          }, { transaction: dbTransaction });
          
          console.log(`[makeContribution] Contribution created successfully with ID: ${contribution.id}, Receipt: ${currentReceiptNumber}`);
          break; // Success, exit loop
        } catch (createError) {
          if (createError.name === 'SequelizeUniqueConstraintError' && attempts < 2) {
            // Receipt number collision, generate new one
            currentReceiptNumber = `REC-${Date.now()}-${memberId}-${Math.random().toString(36).slice(2, 7)}`;
            attempts++;
            continue;
          }
          throw createError; // Re-throw if not a uniqueness error or max attempts reached
        }
      }

      // Update member savings within transaction - USE DIRECT SQL TO ENSURE DATABASE UPDATE
      const currentTotalSavings = parseFloat(member.totalSavings || 0);
      const newTotalSavings = currentTotalSavings + contributionAmount;
      
      // Method 1: Update using Sequelize (for ORM consistency)
      member.totalSavings = newTotalSavings;
      await member.save({ transaction: dbTransaction });
      
      // Method 2: Also update using DIRECT SQL to ensure database is definitely updated
      await sequelize.query(`
        UPDATE Users 
        SET totalSavings = :newTotalSavings, updatedAt = :updatedAt
        WHERE id = :memberId
      `, {
        replacements: {
          newTotalSavings: newTotalSavings,
          updatedAt: new Date(),
          memberId: memberId
        },
        type: sequelize.QueryTypes.UPDATE,
        transaction: dbTransaction
      });
      
      console.log(`[makeContribution] Updated member totalSavings in database: ${currentTotalSavings} -> ${newTotalSavings} (Member ID: ${memberId})`);
      
      // Verify the update by reloading member
      await member.reload({ transaction: dbTransaction });
      const verifiedTotalSavings = parseFloat(member.totalSavings || 0);
      if (Math.abs(verifiedTotalSavings - newTotalSavings) > 0.01) {
        console.error(`[makeContribution] WARNING: totalSavings mismatch! Expected: ${newTotalSavings}, Got: ${verifiedTotalSavings}`);
      } else {
        console.log(`[makeContribution] Verified: Member totalSavings is correctly set to ${verifiedTotalSavings} in database`);
      }

      // Update group savings within transaction - USE DIRECT SQL TO ENSURE DATABASE UPDATE
      const currentGroupSavings = parseFloat(group.totalSavings || 0);
      const newGroupSavings = currentGroupSavings + contributionAmount;
      
      // Method 1: Update using Sequelize
      group.totalSavings = newGroupSavings;
      await group.save({ transaction: dbTransaction });
      
      // Method 2: Also update using DIRECT SQL to ensure database is definitely updated
      await sequelize.query(`
        UPDATE Groups 
        SET totalSavings = :newGroupSavings, updatedAt = :updatedAt
        WHERE id = :groupId
      `, {
        replacements: {
          newGroupSavings: newGroupSavings,
          updatedAt: new Date(),
          groupId: member.groupId
        },
        type: sequelize.QueryTypes.UPDATE,
        transaction: dbTransaction
      });
      
      console.log(`[makeContribution] Updated group totalSavings in database: ${currentGroupSavings} -> ${newGroupSavings} (Group ID: ${member.groupId})`);

      // Create transaction record within transaction
      await Transaction.create({
        userId: memberId,
        type: 'contribution',
        amount: contributionAmount,
        balance: newTotalSavings,
        status: 'completed',
        referenceId: contribution.id.toString(),
        referenceType: 'Contribution',
        paymentMethod: contribution.paymentMethod,
        description: `Contribution: ${currentReceiptNumber}`
      }, { transaction: dbTransaction });

      // Commit transaction - all changes are now persisted
      await dbTransaction.commit();
      console.log(`[makeContribution] Transaction committed successfully. Contribution ID: ${contribution.id}`);

      // Reload contribution from database to ensure it's fully persisted
      await contribution.reload();
      console.log(`[makeContribution] Contribution reloaded. Status: ${contribution.status}, Amount: ${contribution.amount}`);

      // Log action (outside transaction)
      logAction(memberId, 'CONTRIBUTION_SUBMITTED', 'Contribution', contribution.id, { amount: contributionAmount, paymentMethod, status: 'approved' }, req);

      // Auto-create document for contribution
      setImmediate(async () => {
        try {
          const { autoCreateDocumentFromContribution } = require('./documentation.controller');
          const fileUrl = `/contributions/${contribution.id}`;
          const fileName = `contribution-${contribution.id}-${currentReceiptNumber}.txt`;
          await autoCreateDocumentFromContribution(contribution.id, fileUrl, fileName);
          console.log(`[makeContribution] Auto-created document for contribution ${contribution.id}`);
        } catch (docError) {
          console.error('[makeContribution] Error creating document:', docError);
          // Don't fail the request if document creation fails
        }
      });

      // Create in-app notifications for Group Admin, Secretary, and Cashier
      let admins = [];
      try {
        admins = await User.findAll({
          where: {
            groupId: member.groupId,
            role: { [Op.in]: ['Secretary', 'Cashier', 'Group Admin'] },
            status: 'active'
          },
          attributes: ['id', 'name', 'phone', 'email', 'role']
        });

        console.log(`[makeContribution] Found ${admins.length} admins to notify:`, admins.map(a => `${a.name} (${a.role})`));

        const notificationMessage = `New contribution recorded: ${member.name} contributed ${contributionAmount.toLocaleString()} RWF via ${paymentMethod}. Receipt: ${currentReceiptNumber}. Total savings: ${newTotalSavings.toLocaleString()} RWF`;

        // Create in-app notifications for each admin (Group Admin, Secretary, Cashier)
        const notificationPromises = admins.map(admin => 
          Notification.create({
            userId: admin.id,
            type: 'contribution_confirmation',
            channel: 'in_app',
            title: 'New Contribution Recorded',
            content: notificationMessage,
            status: 'sent'
          })
        );
        await Promise.all(notificationPromises);
        console.log(`[makeContribution] Created in-app notifications for ${admins.length} admins (Group Admin, Secretary, Cashier)`);
      } catch (notifError) {
        console.error('[makeContribution] Error creating in-app notifications:', notifError);
        // Don't fail the contribution submission if notifications fail
      }

      // Verify contribution exists in database before sending response
      const verifyContribution = await Contribution.findByPk(contribution.id);
      if (!verifyContribution) {
        console.error(`[makeContribution] ERROR: Contribution ${contribution.id} not found after commit!`);
        return res.status(500).json({
          success: false,
          message: 'Contribution was created but could not be verified. Please refresh and check your savings.',
          error: 'Verification failed'
        });
      }

      console.log(`[makeContribution] Verification successful. Contribution ${contribution.id} exists in database with status: ${verifyContribution.status}`);

      // Reload member and group from database to get the latest totalSavings values (after SQL update)
      await member.reload();
      const finalMemberTotalSavings = parseFloat(member.totalSavings || 0);
      
      await group.reload();
      const finalGroupTotalSavings = parseFloat(group.totalSavings || 0);
      
      console.log(`[makeContribution] Final values from database - Member: ${finalMemberTotalSavings} RWF, Group: ${finalGroupTotalSavings} RWF`);
      
      // Verify that the contribution is reflected in totalSavings
      // If there's a mismatch, recalculate from contributions and fix it
      const verificationCheck = Math.abs(finalMemberTotalSavings - newTotalSavings);
      if (verificationCheck > 0.01) {
        console.warn(`[makeContribution] WARNING: Mismatch detected after commit! Expected: ${newTotalSavings}, Got: ${finalMemberTotalSavings}`);
        console.log(`[makeContribution] Recalculating from approved contributions to fix...`);
        
        // Recalculate from all approved contributions
        const allApprovedContributions = await Contribution.findAll({
          where: {
            memberId: memberId,
            status: 'approved'
          },
          attributes: ['amount']
        });
        
        const recalculatedTotalSavings = allApprovedContributions.reduce((sum, c) => {
          const amount = parseFloat(c.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
        
        if (Math.abs(recalculatedTotalSavings - finalMemberTotalSavings) > 0.01) {
          console.log(`[makeContribution] Fixing totalSavings: ${finalMemberTotalSavings} -> ${recalculatedTotalSavings}`);
          
          // Fix using direct SQL
          await sequelize.query(`
            UPDATE Users 
            SET totalSavings = :recalculatedTotalSavings, updatedAt = :updatedAt
            WHERE id = :memberId
          `, {
            replacements: {
              recalculatedTotalSavings: recalculatedTotalSavings,
              updatedAt: new Date(),
              memberId: memberId
            },
            type: sequelize.QueryTypes.UPDATE
          });
          
          await member.reload();
          const fixedTotalSavings = parseFloat(member.totalSavings || 0);
          console.log(`[makeContribution] Fixed totalSavings to: ${fixedTotalSavings} RWF`);
        }
      }

      // Emit Socket.io event for real-time savings updates (use final reloaded values from database)
      try {
        const io = req.app.get('io');
        if (io) {
          // Emit to all users in the group
          io.to(`savings:${member.groupId}`).emit('savings_updated', {
            groupId: member.groupId,
            totalSavings: finalGroupTotalSavings,
            memberId: memberId,
            memberTotalSavings: finalMemberTotalSavings,
            contributionAmount: contributionAmount
          });
          console.log(`[makeContribution] Emitted savings_updated event for group ${member.groupId} with final values`);
        }
      } catch (socketError) {
        console.warn('[makeContribution] Failed to emit Socket.io event:', socketError);
        // Don't fail the contribution if Socket.io fails
      }
      
      // Send response with fully persisted contribution data and updated savings from database
      res.status(201).json({
        success: true,
        message: 'Contribution recorded successfully!',
        data: {
          ...contribution.toJSON(),
          memberTotalSavings: finalMemberTotalSavings, // Final value from database after SQL update
          groupTotalSavings: finalGroupTotalSavings,   // Final value from database after SQL update
          contributionAmount: contributionAmount
        }
      });

      console.log(`[makeContribution] Response sent successfully for contribution ${contribution.id}`);

      // Send SMS and Email notifications asynchronously (fire-and-forget)
      // This runs after the response is sent, so it doesn't block the user
      setImmediate(async () => {
        try {
          // Send confirmation to member
          if (member.phone) {
            sendContributionConfirmation(member.phone, member.name, contributionAmount).catch(err => {
              console.error('[makeContribution] Failed to send SMS confirmation to member:', err);
            });
          }
          if (member.email) {
            sendContributionSummary(member.email, member.name, contributionAmount, newTotalSavings).catch(err => {
              console.error('[makeContribution] Failed to send email confirmation to member:', err);
            });
          }

          // Send SMS and Email to admins (Group Admin, Secretary, Cashier)
          if (admins.length > 0) {
            for (const admin of admins) {
              // Send SMS if phone is available
              if (admin.phone) {
                const smsMessage = `New contribution: ${member.name} contributed ${contributionAmount.toLocaleString()} RWF. Receipt: ${currentReceiptNumber}. Please review in dashboard.`;
                sendSMS(admin.phone, smsMessage, admin.id, 'contribution_confirmation').catch(err => {
                  console.error(`[makeContribution] Failed to send SMS to ${admin.name}:`, err);
                });
              }

              // Send email if available
              if (admin.email) {
                sendEmail(
                  admin.email,
                  'New Contribution Recorded - For Review',
                  `<p>Dear ${admin.name},</p>
                  <p>A new contribution has been recorded:</p>
                  <ul>
                    <li><strong>Member:</strong> ${member.name}</li>
                    <li><strong>Amount:</strong> ${contributionAmount.toLocaleString()} RWF</li>
                    <li><strong>Payment Method:</strong> ${paymentMethod}</li>
                    <li><strong>Receipt Number:</strong> ${currentReceiptNumber}</li>
                    <li><strong>Group:</strong> ${group.name}</li>
                    <li><strong>Member's Total Savings:</strong> ${newTotalSavings.toLocaleString()} RWF</li>
                    <li><strong>Group's Total Savings:</strong> ${newGroupSavings.toLocaleString()} RWF</li>
                  </ul>
                  <p>Please review this contribution in your dashboard.</p>`,
                  admin.id,
                  'contribution_confirmation'
                ).catch(err => {
                  console.error(`[makeContribution] Failed to send email to ${admin.name}:`, err);
                });
              }
            }
          }
        } catch (error) {
          console.error('[makeContribution] Error in async notification sending:', error);
        }
      });
    } catch (transactionError) {
      // Rollback transaction on error
      await dbTransaction.rollback();
      console.error('[makeContribution] Transaction error, rolling back:', transactionError);
      throw transactionError;
    }
  } catch (error) {
    console.error('[makeContribution] Make contribution error:', error);
    console.error('[makeContribution] Error stack:', error.stack);
    
    // Handle validation errors
    if (error.name === 'SequelizeValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.errors.map(e => e.message).join(', ')
      });
    }
    
    // Handle database constraint errors
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Invalid reference. Please check your group membership.',
        error: error.message
      });
    }
    
    // Handle other database errors
    if (error.name === 'SequelizeDatabaseError') {
      return res.status(500).json({
        success: false,
        message: 'Database error occurred',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to submit contribution',
      error: error.message
    });
  }
};

/**
 * Get member contributions
 * GET /api/contributions/member
 */
const getMemberContributions = async (req, res) => {
  try {
    const memberId = req.user.id;
    const { status } = req.query;

    console.log(`[getMemberContributions] Fetching contributions for member ${memberId}, status filter: ${status || 'all'}`);

    let whereClause = { memberId };
    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const contributions = await Contribution.findAll({
      where: whereClause,
      include: [
        { association: 'group', attributes: ['id', 'name', 'code'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    console.log(`[getMemberContributions] Found ${contributions.length} contributions for member ${memberId}`);
    
    // Log status breakdown
    const statusCounts = contributions.reduce((acc, c) => {
      acc[c.status] = (acc[c.status] || 0) + 1;
      return acc;
    }, {});
    console.log(`[getMemberContributions] Status breakdown:`, statusCounts);

    res.json({
      success: true,
      data: contributions
    });
  } catch (error) {
    console.error('[getMemberContributions] Get member contributions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contributions',
      error: error.message
    });
  }
};

/**
 * Get all contributions (Group Admin/Cashier)
 * GET /api/contributions
 */
const getAllContributions = async (req, res) => {
  try {
    const { status, groupId } = req.query;
    const user = req.user;

    let whereClause = {};
    
    // Group Admin and Cashier can see contributions for their group
    if ((user.role === 'Group Admin' || user.role === 'Cashier') && user.groupId) {
      whereClause.groupId = user.groupId;
    } else if (groupId) {
      whereClause.groupId = groupId;
    }

    if (status && status !== 'all') {
      whereClause.status = status;
    }

    const contributions = await Contribution.findAll({
      where: whereClause,
      include: [
        { association: 'member', attributes: ['id', 'name', 'phone'] },
        { association: 'group', attributes: ['id', 'name', 'code'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      data: contributions
    });
  } catch (error) {
    console.error('Get all contributions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contributions',
      error: error.message
    });
  }
};

/**
 * Approve contribution
 * PUT /api/contributions/:id/approve
 */
const approveContribution = async (req, res) => {
  try {
    const { id } = req.params;
    const approverId = req.user.id;

    const contribution = await Contribution.findByPk(id, {
      include: [{ association: 'member' }, { association: 'group' }]
    });

    if (!contribution) {
      return res.status(404).json({
        success: false,
        message: 'Contribution not found'
      });
    }

    if (contribution.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Contribution is not pending approval'
      });
    }

    // Update contribution
    contribution.status = 'approved';
    contribution.approvedBy = approverId;
    contribution.approvalDate = new Date();
    await contribution.save();

    // Update member savings - USE DIRECT SQL TO ENSURE DATABASE UPDATE
    const member = await User.findByPk(contribution.memberId);
    const currentMemberSavings = parseFloat(member.totalSavings || 0);
    const newMemberSavings = currentMemberSavings + parseFloat(contribution.amount);
    
    // Method 1: Update using Sequelize
    member.totalSavings = newMemberSavings;
    await member.save();
    
    // Method 2: Also update using DIRECT SQL to ensure database is definitely updated
    await sequelize.query(`
      UPDATE Users 
      SET totalSavings = :newTotalSavings, updatedAt = :updatedAt
      WHERE id = :memberId
    `, {
      replacements: {
        newTotalSavings: newMemberSavings,
        updatedAt: new Date(),
        memberId: contribution.memberId
      },
      type: sequelize.QueryTypes.UPDATE
    });
    
    console.log(`[approveContribution] Updated member totalSavings in database: ${currentMemberSavings} -> ${newMemberSavings} (Member ID: ${contribution.memberId})`);

    // Update group savings - USE DIRECT SQL TO ENSURE DATABASE UPDATE
    const group = await Group.findByPk(contribution.groupId);
    const currentGroupSavings = parseFloat(group.totalSavings || 0);
    const newGroupSavings = currentGroupSavings + parseFloat(contribution.amount);
    
    // Method 1: Update using Sequelize
    group.totalSavings = newGroupSavings;
    await group.save();
    
    // Method 2: Also update using DIRECT SQL to ensure database is definitely updated
    await sequelize.query(`
      UPDATE Groups 
      SET totalSavings = :newGroupSavings, updatedAt = :updatedAt
      WHERE id = :groupId
    `, {
      replacements: {
        newGroupSavings: newGroupSavings,
        updatedAt: new Date(),
        groupId: contribution.groupId
      },
      type: sequelize.QueryTypes.UPDATE
    });
    
    console.log(`[approveContribution] Updated group totalSavings in database: ${currentGroupSavings} -> ${newGroupSavings} (Group ID: ${contribution.groupId})`);

    // Reload member and group from database to get the latest totalSavings values (after SQL update)
    await member.reload();
    const finalMemberTotalSavings = parseFloat(member.totalSavings || 0);
    
    await group.reload();
    const finalGroupTotalSavings = parseFloat(group.totalSavings || 0);
    
    console.log(`[approveContribution] Final values from database - Member: ${finalMemberTotalSavings} RWF, Group: ${finalGroupTotalSavings} RWF`);

    // Create transaction record (use final reloaded value)
    await Transaction.create({
      userId: contribution.memberId,
      type: 'contribution',
      amount: contribution.amount,
      balance: finalMemberTotalSavings,
      status: 'completed',
      referenceId: contribution.id.toString(),
      referenceType: 'Contribution',
      paymentMethod: contribution.paymentMethod,
      description: `Contribution: ${contribution.receiptNumber}`
    });

    // Send notifications (use final reloaded value)
    try {
      await sendContributionConfirmation(member.phone, member.name, contribution.amount);
      if (member.email) {
        await sendContributionSummary(member.email, member.name, contribution.amount, finalMemberTotalSavings);
      }
    } catch (notifError) {
      console.error('Notification error:', notifError);
    }

    logAction(approverId, 'CONTRIBUTION_APPROVED', 'Contribution', contribution.id, { memberId: contribution.memberId, amount: contribution.amount }, req);

    // Return response with updated savings values from database
    res.json({
      success: true,
      message: 'Contribution approved successfully',
      data: {
        ...contribution.toJSON(),
        memberTotalSavings: finalMemberTotalSavings,
        groupTotalSavings: finalGroupTotalSavings
      }
    });

    // Auto-create document for approved contribution
    setImmediate(async () => {
      try {
        const { autoCreateDocumentFromContribution } = require('./documentation.controller');
        const fileUrl = `/contributions/${contribution.id}`;
        const fileName = `contribution-${contribution.id}-${contribution.receiptNumber || contribution.id}.txt`;
        await autoCreateDocumentFromContribution(contribution.id, fileUrl, fileName);
        console.log(`[approveContribution] Auto-created document for contribution ${contribution.id}`);
      } catch (docError) {
        console.error('[approveContribution] Error creating document:', docError);
        // Don't fail the request if document creation fails
      }
    });
  } catch (error) {
    console.error('Approve contribution error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve contribution',
      error: error.message
    });
  }
};

/**
 * Reject contribution
 * PUT /api/contributions/:id/reject
 */
const rejectContribution = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approverId = req.user.id;

    const contribution = await Contribution.findByPk(id);

    if (!contribution) {
      return res.status(404).json({
        success: false,
        message: 'Contribution not found'
      });
    }

    if (contribution.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Contribution is not pending approval'
      });
    }

    contribution.status = 'rejected';
    contribution.approvedBy = approverId;
    contribution.approvalDate = new Date();
    contribution.rejectionReason = reason || 'Not specified';
    await contribution.save();

    logAction(approverId, 'CONTRIBUTION_REJECTED', 'Contribution', contribution.id, { reason }, req);

    res.json({
      success: true,
      message: 'Contribution rejected',
      data: contribution
    });
  } catch (error) {
    console.error('Reject contribution error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject contribution',
      error: error.message
    });
  }
};

/**
 * Sync member totalSavings with approved contributions
 * This function recalculates totalSavings for a member based on their approved contributions
 * and updates the database if there's a mismatch
 * POST /api/contributions/sync/:memberId (optional memberId, if not provided syncs all members)
 */
const syncMemberTotalSavings = async (req, res) => {
  try {
    const { memberId } = req.params;
    const { syncAll } = req.query;
    
    console.log('[syncMemberTotalSavings] Starting sync process...');
    
    let membersToSync = [];
    
    if (memberId) {
      // Sync specific member
      const member = await User.findByPk(memberId);
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }
      membersToSync = [member];
    } else if (syncAll === 'true' || req.user?.role === 'System Admin') {
      // Sync all active members
      membersToSync = await User.findAll({
        where: {
          status: 'active',
          role: { [Op.in]: ['Member', 'Secretary', 'Cashier', 'Group Admin'] }
        }
      });
      console.log(`[syncMemberTotalSavings] Syncing all ${membersToSync.length} members`);
    } else {
      // Sync current user only
      const member = await User.findByPk(req.user.id);
      if (member) {
        membersToSync = [member];
      }
    }
    
    const results = [];
    let fixedCount = 0;
    let correctCount = 0;
    
    for (const member of membersToSync) {
      try {
        // Calculate totalSavings from approved contributions
        const approvedContributions = await Contribution.findAll({
          where: {
            memberId: member.id,
            status: 'approved'
          },
          attributes: ['amount']
        });
        
        const calculatedTotalSavings = approvedContributions.reduce((sum, c) => {
          const amount = parseFloat(c.amount || 0);
          return sum + (isNaN(amount) ? 0 : amount);
        }, 0);
        
        const storedTotalSavings = parseFloat(member.totalSavings || 0);
        const difference = Math.abs(calculatedTotalSavings - storedTotalSavings);
        
        if (difference > 0.01) {
          // There's a mismatch, fix it
          console.log(`[syncMemberTotalSavings] Member ${member.id} (${member.name}): Stored=${storedTotalSavings}, Calculated=${calculatedTotalSavings}, Difference=${difference}`);
          
          // Update using both methods
          member.totalSavings = calculatedTotalSavings;
          await member.save();
          
          await sequelize.query(`
            UPDATE Users 
            SET totalSavings = :newTotalSavings, updatedAt = :updatedAt
            WHERE id = :memberId
          `, {
            replacements: {
              newTotalSavings: calculatedTotalSavings,
              updatedAt: new Date(),
              memberId: member.id
            },
            type: sequelize.QueryTypes.UPDATE
          });
          
          // Update group totalSavings if member belongs to a group
          if (member.groupId) {
            const group = await Group.findByPk(member.groupId);
            if (group) {
              // Recalculate group totalSavings from all members
              const groupMembers = await User.findAll({
                where: {
                  groupId: member.groupId,
                  status: 'active'
                },
                attributes: ['totalSavings']
              });
              
              const groupTotalSavings = groupMembers.reduce((sum, m) => {
                return sum + parseFloat(m.totalSavings || 0);
              }, 0);
              
              group.totalSavings = groupTotalSavings;
              await group.save();
              
              await sequelize.query(`
                UPDATE Groups 
                SET totalSavings = :newGroupSavings, updatedAt = :updatedAt
                WHERE id = :groupId
              `, {
                replacements: {
                  newGroupSavings: groupTotalSavings,
                  updatedAt: new Date(),
                  groupId: member.groupId
                },
                type: sequelize.QueryTypes.UPDATE
              });
            }
          }
          
          results.push({
            memberId: member.id,
            memberName: member.name,
            storedTotalSavings,
            calculatedTotalSavings,
            fixed: true
          });
          fixedCount++;
        } else {
          results.push({
            memberId: member.id,
            memberName: member.name,
            storedTotalSavings,
            calculatedTotalSavings,
            fixed: false
          });
          correctCount++;
        }
      } catch (memberError) {
        console.error(`[syncMemberTotalSavings] Error syncing member ${member.id}:`, memberError);
        results.push({
          memberId: member.id,
          memberName: member.name,
          error: memberError.message
        });
      }
    }
    
    console.log(`[syncMemberTotalSavings] Sync complete. Fixed: ${fixedCount}, Correct: ${correctCount}`);
    
    res.json({
      success: true,
      message: `Sync complete. Fixed ${fixedCount} member(s), ${correctCount} already correct.`,
      data: {
        fixedCount,
        correctCount,
        totalChecked: membersToSync.length,
        results
      }
    });
  } catch (error) {
    console.error('[syncMemberTotalSavings] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync member totalSavings',
      error: error.message
    });
  }
};

module.exports = {
  makeContribution,
  getMemberContributions,
  getAllContributions,
  approveContribution,
  rejectContribution,
  syncMemberTotalSavings
};

