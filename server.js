require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('./config/db');

const app = express();
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

// Middleware
// Configure Helmet to allow cross-origin images
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "http://localhost:4000", "http://localhost:3000", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type']
}));
app.use(morgan('dev'));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files with CORS headers
const uploadPath = process.env.FILE_UPLOAD_PATH || 'uploads/';
app.use('/uploads', (req, res, next) => {
  // Set CORS headers for static files
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || 'http://localhost:3000');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
}, express.static(path.join(__dirname, uploadPath)));

// Ensure learn-grow upload directory exists
const learnGrowDir = path.join(__dirname, 'uploads/learn-grow');
if (!fs.existsSync(learnGrowDir)) {
  fs.mkdirSync(learnGrowDir, { recursive: true });
}

// Rate limiting - More lenient limits to prevent 429 errors
// Create separate limiters for authenticated and public routes

// Very lenient limiter for authenticated routes (500 requests per 15 minutes)
const authenticatedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes for authenticated users
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please try again later.',
  keyGenerator: (req) => {
    // Use IP + user ID if authenticated for better tracking
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(token);
        if (decoded?.userId) {
          return `${req.ip}-user-${decoded.userId}`;
        }
      } catch (e) {
        // If token decode fails, fall back to IP
      }
    }
    return req.ip;
  },
  skip: (req) => {
    // Only apply to authenticated requests
    const hasAuth = !!req.header('Authorization');
    // Skip if not authenticated, health check, or member-applications POST
    return !hasAuth || req.path === '/health' || (req.path === '/member-applications' && req.method === 'POST');
  }
});

// Public route limiter (200 requests per 15 minutes)
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per 15 minutes for public routes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => {
    // Skip if authenticated (will use authenticated limiter), health check, or member-applications POST
    const hasAuth = !!req.header('Authorization');
    return hasAuth || req.path === '/health' || (req.path === '/member-applications' && req.method === 'POST');
  }
});

// Apply both limiters - they will skip appropriately based on authentication
app.use('/api/', authenticatedLimiter);
app.use('/api/', publicLimiter);

// Routes
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/members', require('./src/routes/member.routes'));
app.use('/api/groups', require('./src/routes/group.routes'));
app.use('/api/loans', require('./src/routes/loan.routes'));
app.use('/api/contributions', require('./src/routes/contribution.routes'));
app.use('/api/transactions', require('./src/routes/transaction.routes'));
app.use('/api/fines', require('./src/routes/fine.routes'));
app.use('/api/fine-rules', require('./src/routes/fineRules.routes'));
app.use('/api/announcements', require('./src/routes/announcement.routes'));
app.use('/api/compliance', require('./src/routes/compliance.routes'));
app.use('/api/meetings', require('./src/routes/meeting.routes'));
app.use('/api/voting', require('./src/routes/voting.routes'));
app.use('/api/learn-grow', require('./src/routes/learngrow.routes'));
app.use('/api/secretary/documentation', require('./src/routes/documentation.routes'));
app.use('/api/chat', require('./src/routes/chat.routes'));
app.use('/api/notifications', require('./src/routes/notification.routes'));
app.use('/api/message-templates', require('./src/routes/messageTemplate.routes'));
app.use('/api/analytics', require('./src/routes/analytics.routes'));
app.use('/api/reports', require('./src/routes/reports.routes'));
app.use('/api/system', require('./src/routes/system.routes'));
app.use('/api/upload', require('./src/routes/upload.routes'));
app.use('/api/system-admin', require('./src/routes/systemadmin.routes'));
app.use('/api/system-admin/maintenance', require('./src/routes/maintenance.routes'));
app.use('/api/branches', require('./src/routes/branch.routes'));
app.use('/api/audit-logs', require('./src/routes/audit.routes'));
app.use('/api/support', require('./src/routes/support.routes'));
app.use('/api/agent', require('./src/routes/agent.routes'));
app.use('/api/cashier', require('./src/routes/cashier.routes'));
app.use('/api/secretary', require('./src/routes/secretary.routes'));
app.use('/api/secretary/members', require('./src/routes/secretaryMember.routes'));
app.use('/api/secretary/support', require('./src/routes/secretarySupport.routes'));
app.use('/api/secretary/reports', require('./src/routes/secretaryReports.routes'));
app.use('/api/public', require('./src/routes/public.routes'));
app.use('/api/member-applications', require('./src/routes/memberApplication.routes'));

// Health check with database status
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await db.sequelize.authenticate();
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'disconnected';
  }
  
  res.json({ 
    status: 'ok', 
    message: 'Ikumina Wallet API is running',
    database: dbStatus
  });
});

// Database connection check middleware (optional - can be used in routes)
app.use((req, res, next) => {
  const dbConnected = app.get('dbConnected');
  if (!dbConnected && req.path !== '/api/health' && !req.path.startsWith('/api/auth/login') && !req.path.startsWith('/api/public')) {
    // Allow health check and public routes even without DB
    // For other routes, check if DB is available now
    db.sequelize.authenticate()
      .then(() => {
        app.set('dbConnected', true);
        next();
      })
      .catch(() => {
        return res.status(503).json({
          success: false,
          message: 'Database connection unavailable. Please ensure MySQL is running.',
          error: 'DATABASE_UNAVAILABLE'
        });
      });
  } else {
    next();
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 4000;

// Check critical environment variables
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET not set in .env. Using default (change in production!)');
}

// Start server with graceful database connection handling
const startServer = async () => {
  let dbConnected = false;
  
  // Try to connect to database, but don't fail if it's unavailable
  try {
    await db.sequelize.authenticate();
    console.log('✅ Database connection established');
    dbConnected = true;
  } catch (error) {
    if (error.name === 'SequelizeConnectionRefusedError' || error.name === 'SequelizeConnectionError') {
      console.warn('⚠️  Database connection unavailable. Server will start in limited mode.');
      console.warn('   Please ensure MySQL is running and check your .env database configuration.');
      console.warn('   Database operations will fail until connection is restored.');
      dbConnected = false;
    } else {
      console.error('❌ Database connection error:', error.message);
      dbConnected = false;
    }
  }
  
  // Store database connection status in app for use in routes
  app.set('dbConnected', dbConnected);
  
  // Do not auto-sync at runtime; use migrations instead to avoid accidental alters/index churn
  if (dbConnected) {
    console.log('ℹ️  Skipping runtime sync. Use migrations to manage schema.');
  }
  
  try {
    const server = http.createServer(app);
    
    // Initialize Socket.io
    const io = new Server(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // Socket.io authentication and connection handling
    const jwt = require('jsonwebtoken');
    const { User, ChatMessage, Group, Contribution, Notification } = require('./src/models');
    const { Op } = require('sequelize');

    // Store user socket connections: { userId: socketId }
    const userSockets = new Map();
    // Store socket to user mapping: { socketId: userId }
    const socketUsers = new Map();

    io.use(async (socket, next) => {
      try {
        // Check if database is available
        if (!dbConnected) {
          return next(new Error('Database unavailable. Please try again later.'));
        }

        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        
        try {
          const user = await User.findByPk(decoded.userId);
          
          if (!user) {
            return next(new Error('Authentication error: User not found'));
          }

          socket.userId = user.id;
          socket.user = user;
          next();
        } catch (dbError) {
          if (dbError.name === 'SequelizeConnectionRefusedError' || dbError.name === 'SequelizeConnectionError') {
            console.error('[Socket.io] Database connection error during authentication');
            return next(new Error('Database unavailable. Please try again later.'));
          }
          throw dbError;
        }
      } catch (error) {
        console.error('[Socket.io] Authentication error:', error.message);
        next(new Error('Authentication error'));
      }
    });

    io.on('connection', (socket) => {
      const userId = socket.userId;
      const user = socket.user;
      
      console.log(`[Socket.io] User ${user.name} (${userId}) connected: ${socket.id}`);
      
      // Store socket connection
      userSockets.set(userId, socket.id);
      socketUsers.set(socket.id, userId);

      // Join user's group room for group chat
      if (user.groupId) {
        socket.join(`group:${user.groupId}`);
        console.log(`[Socket.io] User ${userId} joined group room: group:${user.groupId}`);
      }

      // Join user's personal room for private messages
      socket.join(`user:${userId}`);

      // Handle sending messages via Socket.io (alternative to HTTP API)
      socket.on('send_message', async (data) => {
        try {
          const { groupId, receiverId, message, type = 'text', fileUrl } = data;
          
          if (!message && !fileUrl) {
            socket.emit('error', { message: 'Message or file is required' });
            return;
          }

          // Validate: group message should not have receiverId, private message should not have groupId
          if (groupId && receiverId) {
            socket.emit('error', { message: 'Message cannot be both group and private. Use groupId OR receiverId, not both.' });
            return;
          }

          if (!groupId && !receiverId) {
            socket.emit('error', { message: 'Either groupId or receiverId must be provided' });
            return;
          }

          // Create message in database
          const chatMessage = await ChatMessage.create({
            groupId: groupId || null,
            senderId: userId,
            receiverId: receiverId || null,
            message: message || '',
            type,
            fileUrl: fileUrl || null,
            isRead: false
          });

          // Fetch message with sender info
          const messageWithSender = await ChatMessage.findByPk(chatMessage.id, {
            include: [
              { association: 'sender', attributes: ['id', 'name', 'phone', 'profileImage'] }
            ]
          });

          // Determine where to emit the message
          if (groupId) {
            // Group message - broadcast to all members in the group
            io.to(`group:${groupId}`).emit('new_message', {
              message: messageWithSender,
              groupId: groupId
            });
            
            // Play notification sound for all group members except sender
            socket.to(`group:${groupId}`).emit('play_notification_sound');
            
            // Create notifications for offline group members
            const groupMembers = await User.findAll({
              where: { groupId, status: 'active', id: { [Op.ne]: userId } },
              attributes: ['id', 'name']
            });
            
            groupMembers.forEach(member => {
              if (!userSockets.has(member.id)) {
                // User is offline, create notification
                Notification.create({
                  userId: member.id,
                  type: 'chat_message',
                  channel: 'in_app',
                  title: `New message in group chat`,
                  content: `${user.name}: ${message || 'You have a new message'}`,
                  status: 'sent'
                }).catch(err => console.error('Failed to create notification:', err));
              }
            });
          } else if (receiverId) {
            // Private message - emit to specific receiver and sender
            const receiverSocketId = userSockets.get(receiverId);
            
            // Send to receiver if online
            if (receiverSocketId) {
              io.to(receiverSocketId).emit('new_message', {
                message: messageWithSender,
                receiverId: receiverId
              });
              io.to(receiverSocketId).emit('play_notification_sound');
            }
            
            // Also send to sender so they see their own message immediately
            socket.emit('new_message', {
              message: messageWithSender,
              receiverId: receiverId
            });

            // Create notification if receiver is offline
            if (!receiverSocketId) {
              Notification.create({
                userId: receiverId,
                type: 'chat_message',
                channel: 'in_app',
                title: `New message from ${user.name}`,
                content: message || 'You have a new private message',
                status: 'sent'
              }).catch(err => console.error('Failed to create notification:', err));
            }
          }
        } catch (error) {
          console.error('[Socket.io] Error sending message:', error);
          socket.emit('error', { message: 'Failed to send message: ' + error.message });
        }
      });

      // Handle marking messages as read
      socket.on('mark_messages_read', async (data) => {
        try {
          const { groupId, senderId } = data;
          
          const whereClause = { isRead: false };
          if (groupId) {
            whereClause.groupId = groupId;
            whereClause.senderId = { [Op.ne]: userId };
          } else if (senderId) {
            whereClause.senderId = senderId;
            whereClause.receiverId = userId;
          }

          await ChatMessage.update(
            { isRead: true },
            { where: whereClause }
          );

          socket.emit('messages_read', { groupId, senderId });
        } catch (error) {
          console.error('[Socket.io] Error marking messages as read:', error);
        }
      });

      // Handle WebRTC signaling for voice/video calls
      socket.on('call_user', (data) => {
        const { userToCall, signalData, from, name, callType } = data;
        const receiverSocketId = userSockets.get(userToCall);
        
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('incoming_call', {
            signal: signalData,
            from,
            name,
            callType // 'voice' or 'video'
          });
        } else {
          socket.emit('call_failed', { message: 'User is offline' });
        }
      });

      socket.on('accept_call', (data) => {
        const { signal, to } = data;
        const receiverSocketId = userSockets.get(to);
        
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('call_accepted', { signal });
        }
      });

      socket.on('end_call', (data) => {
        const { to } = data;
        const receiverSocketId = userSockets.get(to);
        
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('call_ended');
        }
      });

      // Handle real-time savings updates
      socket.on('subscribe_savings_updates', (data) => {
        const { groupId } = data;
        if (groupId) {
          socket.join(`savings:${groupId}`);
          console.log(`[Socket.io] User ${userId} subscribed to savings updates for group ${groupId}`);
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`[Socket.io] User ${user.name} (${userId}) disconnected: ${socket.id}`);
        userSockets.delete(userId);
        socketUsers.delete(socket.id);
      });
    });

    // Make io available globally for use in routes
    app.set('io', io);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 API available at http://localhost:${PORT}/api`);
      console.log(`🔌 Socket.io server ready for real-time connections`);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Please:`);
        console.error(`   1. Stop the existing server, or`);
        console.error(`   2. Change PORT in .env file to use a different port`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', err);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;

