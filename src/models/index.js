const { sequelize, Sequelize } = require('../../config/db');

// Import all models
const User = require('./User')(sequelize, Sequelize);
const Group = require('./Group')(sequelize, Sequelize);
const Loan = require('./Loan')(sequelize, Sequelize);
const Contribution = require('./Contribution')(sequelize, Sequelize);
const Transaction = require('./Transaction')(sequelize, Sequelize);
const Fine = require('./Fine')(sequelize, Sequelize);
const Announcement = require('./Announcement')(sequelize, Sequelize);
const Meeting = require('./Meeting')(sequelize, Sequelize);
const Vote = require('./Vote')(sequelize, Sequelize);
const VoteOption = require('./VoteOption')(sequelize, Sequelize);
const VoteResponse = require('./VoteResponse')(sequelize, Sequelize);
const LearnGrowContent = require('./LearnGrowContent')(sequelize, Sequelize);
const ChatMessage = require('./ChatMessage')(sequelize, Sequelize);
const Notification = require('./Notification')(sequelize, Sequelize);
const Branch = require('./Branch')(sequelize, Sequelize);
const MemberApplication = require('./MemberApplication')(sequelize, Sequelize);
const AuditLog = require('./AuditLog')(sequelize, Sequelize);
const SupportTicket = require('./SupportTicket')(sequelize, Sequelize);
const Setting = require('./Setting')(sequelize, Sequelize);
const LoanProduct = require('./LoanProduct')(sequelize, Sequelize);
const MessageTemplate = require('./MessageTemplate')(sequelize, Sequelize);
const ComplianceRule = require('./ComplianceRule')(sequelize, Sequelize);
const ComplianceViolation = require('./ComplianceViolation')(sequelize, Sequelize);
const Document = require('./Document')(sequelize, Sequelize);
const TrainingProgress = require('./TrainingProgress')(sequelize, Sequelize);
const ScheduledAudit = require('./ScheduledAudit')(sequelize, Sequelize);

sequelize.sync({ alter: true });


// Define relationships
User.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(User, { foreignKey: 'groupId', as: 'members' });

User.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Branch.hasMany(User, { foreignKey: 'branchId', as: 'users' });

Branch.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });
User.hasMany(Branch, { foreignKey: 'managerId', as: 'managedBranches' });

Group.belongsTo(Branch, { foreignKey: 'branchId', as: 'branch' });
Branch.hasMany(Group, { foreignKey: 'branchId', as: 'groups' });

Group.belongsTo(User, { foreignKey: 'agentId', as: 'agent' });
User.hasMany(Group, { foreignKey: 'agentId', as: 'registeredGroups' });

Loan.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
User.hasMany(Loan, { foreignKey: 'memberId', as: 'loans' });

Loan.belongsTo(User, { foreignKey: 'guarantorId', as: 'guarantor' });
User.hasMany(Loan, { foreignKey: 'guarantorId', as: 'guaranteedLoans' });

Loan.belongsTo(User, { foreignKey: 'approvedBy', as: 'approver' });

Loan.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Loan, { foreignKey: 'groupId', as: 'loans' });

Contribution.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
User.hasMany(Contribution, { foreignKey: 'memberId', as: 'contributions' });

Contribution.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Contribution, { foreignKey: 'groupId', as: 'contributions' });

Transaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Transaction, { foreignKey: 'userId', as: 'transactions' });

Fine.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
User.hasMany(Fine, { foreignKey: 'memberId', as: 'fines' });

Fine.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Fine, { foreignKey: 'groupId', as: 'fines' });

Announcement.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Announcement, { foreignKey: 'groupId', as: 'announcements' });

Announcement.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

Meeting.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Meeting, { foreignKey: 'groupId', as: 'meetings' });

Meeting.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(Meeting, { foreignKey: 'createdBy', as: 'createdMeetings' });

Vote.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Vote, { foreignKey: 'groupId', as: 'votes' });

Vote.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

VoteOption.belongsTo(Vote, { foreignKey: 'voteId', as: 'vote' });
Vote.hasMany(VoteOption, { foreignKey: 'voteId', as: 'options' });

VoteResponse.belongsTo(Vote, { foreignKey: 'voteId', as: 'vote' });
Vote.hasMany(VoteResponse, { foreignKey: 'voteId', as: 'responses' });

VoteResponse.belongsTo(VoteOption, { foreignKey: 'optionId', as: 'option' });
VoteOption.hasMany(VoteResponse, { foreignKey: 'optionId', as: 'responses' });

VoteResponse.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
User.hasMany(VoteResponse, { foreignKey: 'memberId', as: 'voteResponses' });

LearnGrowContent.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
User.hasMany(LearnGrowContent, { foreignKey: 'createdBy', as: 'learnGrowContent' });

TrainingProgress.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(TrainingProgress, { foreignKey: 'userId', as: 'trainingProgress' });

TrainingProgress.belongsTo(LearnGrowContent, { foreignKey: 'contentId', as: 'content' });
LearnGrowContent.hasMany(TrainingProgress, { foreignKey: 'contentId', as: 'progress' });

ScheduledAudit.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(ScheduledAudit, { foreignKey: 'groupId', as: 'scheduledAudits' });

ScheduledAudit.belongsTo(User, { foreignKey: 'scheduledBy', as: 'scheduler' });
User.hasMany(ScheduledAudit, { foreignKey: 'scheduledBy', as: 'scheduledAudits' });

ScheduledAudit.belongsTo(User, { foreignKey: 'completedBy', as: 'completer' });
User.hasMany(ScheduledAudit, { foreignKey: 'completedBy', as: 'completedAudits' });

ChatMessage.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
ChatMessage.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' });
User.hasMany(ChatMessage, { foreignKey: 'senderId', as: 'messages' });
User.hasMany(ChatMessage, { foreignKey: 'receiverId', as: 'receivedMessages' });

ChatMessage.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(ChatMessage, { foreignKey: 'groupId', as: 'messages' });

Notification.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(Notification, { foreignKey: 'userId', as: 'notifications' });

MemberApplication.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(MemberApplication, { foreignKey: 'groupId', as: 'applications' });

MemberApplication.belongsTo(User, { foreignKey: 'userId', as: 'user' });
MemberApplication.belongsTo(User, { foreignKey: 'reviewedBy', as: 'reviewer' });

AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'auditLogs' });

SupportTicket.belongsTo(User, { foreignKey: 'userId', as: 'user' });
SupportTicket.belongsTo(User, { foreignKey: 'assignedTo', as: 'assignedAgent' });
User.hasMany(SupportTicket, { foreignKey: 'userId', as: 'supportTickets' });

ComplianceRule.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(ComplianceRule, { foreignKey: 'groupId', as: 'complianceRules' });

ComplianceRule.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });
ComplianceRule.belongsTo(User, { foreignKey: 'updatedBy', as: 'updater' });

ComplianceViolation.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(ComplianceViolation, { foreignKey: 'groupId', as: 'violations' });

ComplianceViolation.belongsTo(ComplianceRule, { foreignKey: 'ruleId', as: 'rule' });
ComplianceRule.hasMany(ComplianceViolation, { foreignKey: 'ruleId', as: 'violations' });

ComplianceViolation.belongsTo(User, { foreignKey: 'memberId', as: 'member' });
User.hasMany(ComplianceViolation, { foreignKey: 'memberId', as: 'violations' });

ComplianceViolation.belongsTo(User, { foreignKey: 'reportedBy', as: 'reporter' });
ComplianceViolation.belongsTo(User, { foreignKey: 'resolvedBy', as: 'resolver' });

Document.belongsTo(Group, { foreignKey: 'groupId', as: 'group' });
Group.hasMany(Document, { foreignKey: 'groupId', as: 'documents' });

Document.belongsTo(User, { foreignKey: 'uploadedBy', as: 'uploader' });
User.hasMany(Document, { foreignKey: 'uploadedBy', as: 'uploadedDocuments' });

module.exports = {
  sequelize,
  Sequelize,
  User,
  Group,
  Loan,
  Contribution,
  Transaction,
  Fine,
  Announcement,
  Meeting,
  Vote,
  VoteOption,
  VoteResponse,
  LearnGrowContent,
  ChatMessage,
  Notification,
  Branch,
  MemberApplication,
  AuditLog,
  SupportTicket,
  Setting,
  LoanProduct,
  MessageTemplate,
  ComplianceRule,
  ComplianceViolation,
  Document,
  TrainingProgress,
  ScheduledAudit
};

