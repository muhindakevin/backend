'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Get a system admin user to own default templates
    const [users] = await queryInterface.sequelize.query(
      "SELECT id FROM Users WHERE role = 'System Admin' LIMIT 1"
    );
    
    const systemAdminId = users.length > 0 ? users[0].id : 1;

    // Insert default templates
    await queryInterface.bulkInsert('MessageTemplates', [
      {
        userId: systemAdminId,
        groupId: null,
        name: 'Contribution Reminder',
        subject: 'Contribution Reminder',
        content: 'Dear [Member Name], this is a reminder that your contribution of [Amount] RWF is due on [Date]. Please make your payment to avoid any penalties.',
        type: 'contribution_reminder',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        userId: systemAdminId,
        groupId: null,
        name: 'Loan Payment Reminder',
        subject: 'Loan Payment Reminder',
        content: 'Dear [Member Name], your loan payment of [Amount] RWF was due on [Date]. Please make your payment as soon as possible to avoid additional charges.',
        type: 'loan_payment_reminder',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        userId: systemAdminId,
        groupId: null,
        name: 'Fine Notification',
        subject: 'Fine Notification',
        content: 'Dear [Member Name], a fine of [Amount] RWF has been applied to your account due to [Reason]. Please settle this amount by [Due Date].',
        type: 'fine_notification',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        userId: systemAdminId,
        groupId: null,
        name: 'General Announcement',
        subject: 'General Announcement',
        content: 'Dear Members, [Announcement Text]. Please take note of this important information. Thank you for your attention.',
        type: 'general_announcement',
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('MessageTemplates', {
      isDefault: true
    });
  }
};

