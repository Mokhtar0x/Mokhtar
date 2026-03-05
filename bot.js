const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const config = require('./config');
const keyboards = require('./keyboards');

// Create bot with improved connection settings
const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 1000, // More conservative polling interval
        autoStart: false, // Don't auto-start, we'll start manually
        params: {
            timeout: 60, // Longer timeout for better stability
            limit: 10, // Fewer updates per request for stability
            allowed_updates: ['message', 'callback_query']
        }
    },
    request: {
        agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 60000, // Longer keep-alive
            maxSockets: 10, // Fewer concurrent connections
            maxFreeSockets: 5,
            timeout: 60000 // 60 second timeout
        },
        timeout: 60000, // 60 second timeout for requests
        forever: true // Keep connection alive
    }
});
const db = new Database();

// Advanced error handling and logging
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
if (!fs.existsSync('logs')) {
    fs.mkdirSync('logs');
}

function logError(error, context = '') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR ${context}: ${error.message}\n${error.stack}\n\n`;

    // Log to file (async to not block)
    fs.appendFile('logs/errors.log', logMessage, (err) => {
        if (err) console.error('Failed to write to error log:', err);
    });

    console.error(`[${timestamp}] ERROR ${context}:`, error);
}

function logActivity(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    // Log to file (async)
    fs.appendFile('logs/activity.log', logMessage, (err) => {
        if (err) console.error('Failed to write to activity log:', err);
    });
}

// Bot error handlers
bot.on('error', (error) => {
    logError(error, 'BOT_ERROR');
});

bot.on('polling_error', (error) => {
    logError(error, 'POLLING_ERROR');

    // Handle specific error types
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
        console.log('⚠️ Bot conflict detected (409). Another instance might be running.');
        console.log('🔧 Attempting to resolve conflict...');

        // Stop current polling
        bot.stopPolling();

        // Wait and try to restart
        setTimeout(async () => {
            try {
                console.log('🔄 Clearing webhook and restarting...');
                await bot.deleteWebHook();
                await new Promise(resolve => setTimeout(resolve, 3000));
                bot.startPolling();
                console.log('✅ Bot restarted successfully');
            } catch (restartError) {
                console.error('❌ Failed to restart bot:', restartError.message);
                console.log('💡 Please manually restart the bot');
            }
        }, 5000);
    } else if (error.code === 'EFATAL' || error.code === 'ESOCKETTIMEOUT' || error.code === 'ECONNRESET') {
        console.log(`⚠️ Connection error (${error.code}), attempting to reconnect...`);

        // Stop current polling
        bot.stopPolling();

        // Wait longer for timeout errors
        const delay = error.code === 'ESOCKETTIMEOUT' ? 15000 : 5000;

        setTimeout(async () => {
            try {
                console.log('🔄 Restarting bot polling...');
                await bot.startPolling();
                console.log('✅ Bot polling restarted successfully');
            } catch (restartError) {
                console.error('❌ Failed to restart polling:', restartError.message);
                // Try again after longer delay
                setTimeout(() => {
                    console.log('🔄 Attempting final restart...');
                    bot.startPolling();
                }, 30000);
            }
        }, delay);
    }
});

// Process error handlers
process.on('uncaughtException', (error) => {
    logError(error, 'UNCAUGHT_EXCEPTION');
    // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
    // Check if it's a Telegram "user blocked bot" error
    if (reason && reason.toString().includes('403 Forbidden: bot was blocked by the user')) {
        console.log('User blocked bot - this is normal behavior');
        return;
    }
    
    // Check if it's other common Telegram errors that are not critical
    if (reason && reason.toString().includes('ETELEGRAM')) {
        console.log('Telegram API error (non-critical):', reason.toString());
        return;
    }
    
    // Log other unhandled rejections
    logError(new Error(reason), 'UNHANDLED_REJECTION');
});

// Graceful shutdown handlers
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
    gracefulShutdown();
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
    gracefulShutdown();
});

async function gracefulShutdown() {
    try {
        console.log('🔒 Stopping bot polling...');
        bot.stopPolling();

        console.log('📡 Clearing webhook...');
        await bot.deleteWebHook();

        console.log('💾 Saving any pending data...');
        // Add any cleanup code here

        console.log('✅ Bot shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error.message);
        process.exit(1);
    }
}

// High-performance state management for millions of users
const userStates = new Map();
const activeTasks = new Map();

// Memory optimization - Clean up old states every 5 minutes
setInterval(() => {
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);

    // Clean up old user states
    for (const [userId, state] of userStates.entries()) {
        if (state.timestamp && state.timestamp < fiveMinutesAgo) {
            userStates.delete(userId);
        }
    }

    // Clean up old task states
    for (const [userId, task] of activeTasks.entries()) {
        if (task.timestamp && task.timestamp < fiveMinutesAgo) {
            activeTasks.delete(userId);
        }
    }

    // Force garbage collection if available
    if (global.gc) {
        global.gc();
    }
}, 5 * 60 * 1000);

// Rate limiting for users
const userRateLimit = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 30;

function checkRateLimit(userId) {
    const now = Date.now();
    const userRequests = userRateLimit.get(userId) || [];

    // Remove old requests outside the window
    const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);

    if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        return false; // Rate limited
    }

    recentRequests.push(now);
    userRateLimit.set(userId, recentRequests);
    return true;
}

// Helper functions
function isAdmin(userId) {
    return userId.toString() === config.ADMIN_ID;
}

// Safe message sending with error handling
async function safeSendMessage(userId, message, options = {}) {
    try {
        return await bot.sendMessage(userId, message, options);
    } catch (error) {
        // Handle specific Telegram errors
        if (error.code === 'ETELEGRAM') {
            const errorCode = error.response?.body?.error_code;
            const description = error.response?.body?.description || error.message;
            
            if (errorCode === 403) {
                // User blocked the bot or deleted account
                console.log(`User ${userId} blocked the bot or deleted account`);
                return null;
            } else if (errorCode === 400 && description.includes('chat not found')) {
                // Chat not found
                console.log(`Chat ${userId} not found`);
                return null;
            } else {
                // Other Telegram errors
                console.error(`Telegram error ${errorCode} for user ${userId}:`, description);
                return null;
            }
        } else {
            // Other errors
            console.error(`Error sending message to user ${userId}:`, error.message);
            return null;
        }
    }
}

function formatBalance(amount, currency = 'EGP') {
    const numAmount = parseFloat(amount) || 0;
    if (currency === 'USD') {
        return `$${numAmount.toFixed(2)}`;
    } else {
        return `${numAmount.toFixed(2)} جنيه`;
    }
}

// Cache for user languages to reduce database calls
const userLanguageCache = new Map();
const CACHE_EXPIRY = 10 * 60 * 1000; // 10 minutes

// Always return Arabic language
async function getUserLanguage(userId) {
    return 'ar';
}

function getMessage(key, language = 'ar') {
    return config.MESSAGES.ar[key] || key;
}

async function convertEGPToUSD(egpAmount) {
    const rate = await db.getSetting('usd_to_egp_rate') || config.USD_TO_EGP_RATE;
    return egpAmount / parseFloat(rate);
}

async function convertUSDToEGP(usdAmount) {
    const rate = await db.getSetting('usd_to_egp_rate') || config.USD_TO_EGP_RATE;
    return usdAmount * parseFloat(rate);
}

// Referral system functions
async function handleReferralCode(userId, referralCode) {
    try {
        // Find the referrer by referral code
        const referrer = await db.getUserByReferralCode(referralCode);
        
        if (referrer && referrer.id !== userId) {
            // Set the referral relationship
            await db.setUserReferredBy(userId, referrer.id);
            await db.addReferral(referrer.id, userId, referralCode);
            
            console.log(`User ${userId} referred by ${referrer.id} with code ${referralCode}`);
        }
    } catch (error) {
        console.error('Error handling referral code:', error);
    }
}

async function processReferralReward(userId) {
    try {
        // Check if this user was referred by someone
        const referral = await db.getReferralByReferredId(userId);
        
        if (referral && referral.status === 'pending') {
            const referrer = await db.getUser(referral.referrer_id);
            
            if (referrer) {
                // Determine reward amount based on referrer's currency
                let rewardAmount;
                let currency = referrer.preferred_currency || 'EGP';
                
                if (currency === 'USD') {
                    rewardAmount = parseFloat(await db.getSetting('referral_reward_usd') || config.REFERRAL_REWARD_USD);
                    // Update referrer's USD balance
                    const newBalance = (parseFloat(referrer.balance_usd) || 0) + rewardAmount;
                    await db.setUserUSDBalance(referrer.id, newBalance);
                } else {
                    rewardAmount = parseFloat(await db.getSetting('referral_reward_egp') || config.REFERRAL_REWARD_EGP);
                    // Update referrer's EGP balance
                    const newBalance = (parseFloat(referrer.balance) || 0) + rewardAmount;
                    await db.setUserBalance(referrer.id, newBalance);
                }
                
                // Update referral record
                await db.updateReferralReward(referral.id, rewardAmount, currency);
                
                // Send notification to referrer
                const language = await getUserLanguage(referrer.id);
                const formattedAmount = formatBalance(rewardAmount, currency);
                const message = getMessage('REFERRAL_REWARD_EARNED', language)
                    .replace('{amount}', formattedAmount);
                
                await safeSendMessage(referrer.id, message);
                
                console.log(`Referral reward of ${rewardAmount} ${currency} sent to user ${referrer.id}`);
            }
        }
    } catch (error) {
        console.error('Error processing referral reward:', error);
    }
}

async function showReferralMenu(chatId, userId, language) {
    try {
        const keyboard = keyboards.getKeyboard('referralMenu', language);
        const message = language === 'en' ?
            '🔗 Referral System\n\nInvite friends and earn rewards!' :
            '🔗 نظام الإحالة\n\nادع أصدقائك واحصل على مكافآت!';
        
        bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error showing referral menu:', error);
    }
}

async function showReferralCode(chatId, userId, language) {
    try {
        let user = await db.getUser(userId);
        
        // If user doesn't exist, create them first
        if (!user) {
            await db.addUser(userId, null);
            user = await db.getUser(userId);
        }
        
        let referralCode = user.referral_code;
        
        // Generate code if doesn't exist
        if (!referralCode) {
            referralCode = await db.generateReferralCode(userId);
        }
        
        // Use bot username from config for creating the link
        const botUsername = config.BOT_USERNAME;
        
        // Create clickable Telegram link
        const telegramLink = `https://t.me/${botUsername}?start=${referralCode}`;
        
        // Determine reward amount based on user's currency
        const currency = user.preferred_currency || 'EGP';
        const rewardAmount = currency === 'USD' ? 
            formatBalance(parseFloat(await db.getSetting('referral_reward_usd') || config.REFERRAL_REWARD_USD), 'USD') : 
            formatBalance(parseFloat(await db.getSetting('referral_reward_egp') || config.REFERRAL_REWARD_EGP), 'EGP');
        
        // Create message with clickable link
        const message = language === 'en' ? 
            `🔗 *Your Referral Link:*\n\n\`${telegramLink}\`\n\n📋 Copy this link and share it with your friends\n💰 You will earn ${rewardAmount} when your friend completes one task and gets admin approval\n\n🎯 *Your Referral Code:* \`${referralCode}\`\n\n👆 Click the link above to test it!` :
            `🔗 *رابط الإحالة الخاص بك:*\n\n\`${telegramLink}\`\n\n📋 انسخ هذا الرابط وشاركه مع أصدقائك\n💰 ستحصل على ${rewardAmount} عندما يكمل صديقك مهمة واحدة ويحصل على موافقة الأدمن\n\n🎯 *كود الإحالة:* \`${referralCode}\`\n\n👆 اضغط على الرابط أعلاه لتجربته!`;
        
        // Create inline keyboard with share button
        const shareText = language === 'en' ? 
            `🎉 Join me on this amazing earning bot! Use my referral link to start earning money: ${telegramLink}` :
            `🎉 انضم إلي في هذا البوت الرائع للربح! استخدم رابط الإحالة الخاص بي لتبدأ ربح المال: ${telegramLink}`;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '📤 Share Link' : '📤 مشاركة الرابط',
                            url: `https://t.me/share/url?url=${encodeURIComponent(telegramLink)}&text=${encodeURIComponent(shareText)}`
                        }
                    ]
                ]
            }
        };

        bot.sendMessage(chatId, message, { 
            parse_mode: 'Markdown',
            disable_web_page_preview: false,
            ...keyboard
        });
    } catch (error) {
        console.error('Error showing referral code:', error);
        const errorMessage = language === 'en' ? 
            '❌ Error generating referral code' : 
            '❌ خطأ في إنشاء كود الإحالة';
        bot.sendMessage(chatId, errorMessage);
    }
}

async function showReferralStats(chatId, userId, language) {
    try {
        let user = await db.getUser(userId);
        
        // If user doesn't exist, create them first
        if (!user) {
            await db.addUser(userId, null);
            user = await db.getUser(userId);
        }
        
        const stats = await db.getReferralStats(userId);
        const referralCode = user.referral_code || 'غير متوفر';
        
        // Escape underscores in referral code for Markdown
        const currency = user.preferred_currency || 'EGP';
        const totalEarned = formatBalance(stats.total_earned || 0, currency);
        
        const message = getMessage('REFERRAL_STATS', language)
            .replace('{total}', stats.total_referrals || 0)
            .replace('{completed}', stats.completed_referrals || 0)
            .replace('{earned}', totalEarned)
            .replace('{code}', referralCode);
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error showing referral stats:', error);
        const errorMessage = language === 'en' ? 
            '❌ Error loading referral statistics' : 
            '❌ خطأ في تحميل إحصائيات الإحالة';
        bot.sendMessage(chatId, errorMessage);
    }
}


// Start command with referral support
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const username = msg.from.username || msg.from.first_name;

    try {
        // Check if user already exists
        const existingUser = await db.getUser(userId);
        
        if (!existingUser) {
            // New user - add to database
            await db.addUser(userId, username);
        }

        if (isAdmin(userId)) {
            const language = 'ar';
            const keyboard = keyboards.getKeyboard('adminKeyboard', language);
            bot.sendMessage(chatId, getMessage('ADMIN_WELCOME', language), keyboard);
        } else {
            // Show main menu
            const language = 'ar';
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, getMessage('WELCOME', language), keyboard);
            bot.sendMessage(chatId, getMessage('CHOOSE_TASKS', language));
        }
    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ حدث خطأ، حاول مرة أخرى');
    }
});

// High-performance message handler for millions of users
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text;

    // Early returns for performance
    if (!text || text.startsWith('/')) return;

    // Rate limiting check
    if (!checkRateLimit(userId)) {
        return; // Silently ignore rate-limited requests
    }

    // Process message asynchronously to not block other messages
    setImmediate(async () => {
        try {
            // Get language (always Arabic)
            const language = 'ar';

            // Handle cancel commands
            if (text === '❌ إلغاء' || text === '/cancel') {
                userStates.delete(userId);
                const keyboard = isAdmin(userId) ?
                    keyboards.getKeyboard('adminKeyboard', language) :
                    keyboards.getKeyboard('userKeyboard', language);
                return bot.sendMessage(chatId, getMessage('OPERATION_CANCELLED', language), keyboard);
            }

            // Check if user is banned
            const user = await db.getUser(userId);
            if (user && user.is_banned) {
                return bot.sendMessage(chatId, getMessage('USER_BANNED', language));
            }

            // Handle conversation states
            const userState = userStates.get(userId);
            if (userState) {
                await handleUserState(chatId, userId, text, userState, language);
                return;
            }

            // Handle buttons
            if (isAdmin(userId)) {
                await handleAdminButtons(chatId, userId, text, language);
            } else {
                await handleUserButtons(chatId, userId, text, language);
            }
        } catch (error) {
            console.error('Error in message handler:', error);
            bot.sendMessage(chatId, '❌ حدث خطأ، حاول مرة أخرى / Error occurred, try again');
        }
    });
});

// Handle user buttons
async function handleUserButtons(chatId, userId, text, language) {
    let user = await db.getUser(userId);
    
    // If user doesn't exist, create them first
    if (!user) {
        await db.addUser(userId, null);
        user = await db.getUser(userId);
    }

    switch (text) {
        case '📋 المهام':
        case '📋 Tasks':
            await showTasksMenu(chatId, userId, language);
            break;

        default:
            // Handle Gmail task button
            if (text.startsWith('📱 مهمة إنشاء جيميل') || text.startsWith('📱 Gmail Creation Task')) {
                const gmailTasksEnabled = await db.getSetting('gmail_tasks_enabled') !== 'false';
                if (gmailTasksEnabled) {
                    await assignGmailTask(chatId, userId, language);
                } else {
                    const message = language === 'en' ?
                        '⏸️ Gmail tasks are currently disabled\n\n📞 Contact admin for more information' :
                        '⏸️ مهام الجيميل معطلة حالياً\n\n📞 تواصل مع الإدارة للمزيد من المعلومات';
                    bot.sendMessage(chatId, message);
                }
                break;
            }

            // Show main menu for unrecognized commands
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, getMessage('WELCOME', language), keyboard);
            break;

        case '💰 المحفظة':
        case '💰 Wallet':
            await showWallet(chatId, userId, language);
            break;

        case '💳 السحب':
        case '💳 Withdraw':
            await initiateWithdrawal(chatId, userId, language);
            break;

        case '🆔 عرض الآيدي':
        case '🆔 Show ID':
            const idMessage = language === 'en' ?
                `🆔 Your ID:\n\n\`${userId}\`` :
                `🆔 الآيدي الخاص بك:\n\n\`${userId}\``;
            
            bot.sendMessage(chatId, idMessage, { parse_mode: 'Markdown' });
            break;

        case '💬 الدعم':
        case '💬 Support':
            const supportMessage = await db.getSetting('support_message') || getMessage('SUPPORT', language);
            bot.sendMessage(chatId, supportMessage);
            break;

        case '🔙 العودة للقائمة الرئيسية':
        case '🔙 Back to Main Menu':
            const mainKeyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, getMessage('WELCOME', language), mainKeyboard);
            bot.sendMessage(chatId, getMessage('CHOOSE_TASKS', language));
            break;

        // Currency selection
        case '💵 الدولار الأمريكي':
        case '💵 US Dollar':
            // Get fresh language in case it was just updated
            const usdLanguage = await getUserLanguage(userId);
            await handleCurrencySelection(chatId, userId, 'USD', usdLanguage);
            break;

        case '💰 الجنيه المصري':
        case '💰 Egyptian Pound':
            // Get fresh language in case it was just updated
            const egpLanguage = await getUserLanguage(userId);
            await handleCurrencySelection(chatId, userId, 'EGP', egpLanguage);
            break;

        // Currency change
        case '💵 تغيير إلى الدولار':
        case '💵 Change to USD':
            await handleCurrencyChange(chatId, userId, 'USD', language);
            break;

        case '💰 تغيير إلى الجنيه':
        case '💰 Change to EGP':
            await handleCurrencyChange(chatId, userId, 'EGP', language);
            break;

        // Gmail task confirmation
        case '✅ متابعة':
        case '✅ Continue':
            await continueGmailTask(chatId, userId, language);
            break;

        case '❌ إلغاء المهمة':
        case '❌ Cancel Task':
            await cancelTask(chatId, userId, language);
            break;
    }
}

// Handle admin buttons (simplified version)
async function handleAdminButtons(chatId, userId, text, language) {
    switch (text) {
        // Main admin menu buttons
        case '👥 إدارة المستخدمين':
        case '👥 User Management':
            const userMgmtKeyboard = keyboards.getKeyboard('userManagement', language);
            const userMgmtMessage = language === 'en' ?
                '👥 User Management:' :
                '👥 إدارة المستخدمين:';
            bot.sendMessage(chatId, userMgmtMessage, userMgmtKeyboard);
            break;

        case '📊 الإحصائيات':
        case '📊 Statistics':
            await showStatistics(chatId, language);
            break;

        case '📱 مراجعة الجيميلات':
        case '📱 Review Gmail':
            await showPendingGmailAccounts(chatId, language);
            break;

        case '💳 طلبات السحب':
        case '💳 Withdrawal Requests':
            await showPendingWithdrawalRequests(chatId, language);
            break;

        case '📨 إرسال رسالة':
        case '📨 Send Message':
            const messageKeyboard = keyboards.getKeyboard('messageKeyboard', language);
            const messageMenuMessage = language === 'en' ?
                '📨 Message Options:' :
                '📨 خيارات الرسائل:';
            bot.sendMessage(chatId, messageMenuMessage, messageKeyboard);
            break;

        case '⚙️ إعدادات النظام':
        case '⚙️ System Settings':
            const settingsKeyboard = keyboards.getKeyboard('settingsKeyboard', language);
            const settingsMessage = language === 'en' ?
                '⚙️ System Settings:' :
                '⚙️ إعدادات النظام:';
            bot.sendMessage(chatId, settingsMessage, settingsKeyboard);
            break;

        case '🎮 التحكم في المهام':
        case '🎮 Task Control':
            const taskControlKeyboard = keyboards.getKeyboard('taskControl', language);
            const taskControlMessage = language === 'en' ?
                '🎮 Task Control:\n\nChoose the task you want to control:' :
                '🎮 التحكم في المهام:\n\nاختر المهمة التي تريد التحكم بها:';
            bot.sendMessage(chatId, taskControlMessage, taskControlKeyboard);
            break;

        case '📱 مهمة إنشاء الجيميل':
        case '📱 Gmail Creation Task':
            await toggleGmailTasks(chatId, language);
            break;

        case '📥 إدارة الإيميلات الجماعية':
        case '📥 Bulk Email Management':
            const bulkEmailKeyboard = keyboards.getKeyboard('bulkEmailManagement', language);
            const bulkEmailMessage = language === 'en' ?
                '📥 Bulk Email Management\n\nChoose an action:' :
                '📥 إدارة الإيميلات الجماعية\n\nاختر إجراء:';
            bot.sendMessage(chatId, bulkEmailMessage, bulkEmailKeyboard);
            break;

        case '📤 تصدير كل الإيميلات':
        case '📤 Export All Emails':
            await exportAllEmails(chatId, language);
            break;

        case '✅ إرسال المقبولة وقبولها':
        case '✅ Send Approved & Approve':
            await sendAndApproveEmails(chatId, userId, language);
            break;

        case '❌ إرسال المرفوضة ورفضها':
        case '❌ Send Rejected & Reject':
            await sendAndRejectEmails(chatId, userId, language);
            break;

        // User management buttons
        case '🔍 البحث عن مستخدم':
        case '🔍 Search User':
            userStates.set(userId, 'searching_user');
            const searchMessage = language === 'en' ?
                '🔍 Send user ID or username to search:\n\n💡 You can search by:\n• User ID (exact): 123456789\n• Username (partial): john (finds john123, johnny, etc.)\n• Arabic names work too!' :
                '🔍 أرسل الآيدي أو اليوزر نيم للبحث:\n\n💡 يمكنك البحث بـ:\n• الآيدي (دقيق): 123456789\n• اليوزر نيم (جزئي): أحمد (يجد أحمد123، أحمدي، إلخ)\n• الأسماء العربية تعمل أيضاً!';
            const cancelKeyboard2 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, searchMessage, cancelKeyboard2);
            break;

        case '📊 آخر 10 مستخدمين':
        case '📊 Last 10 Users':
            await showLastUsers(chatId, language);
            break;

        // Message buttons
        case '📢 رسالة جماعية':
        case '📢 Broadcast Message':
            userStates.set(userId, 'broadcast_message');
            const broadcastMessage = language === 'en' ?
                '📢 Write the broadcast message:' :
                '📢 اكتب الرسالة الجماعية:';
            const cancelKeyboard3 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, broadcastMessage, cancelKeyboard3);
            break;

        case '👤 رسالة لشخص معين':
        case '👤 Private Message':
            userStates.set(userId, 'private_message_id');
            const privateMessage = language === 'en' ?
                '👤 Send user ID:' :
                '👤 أرسل آيدي المستخدم:';
            const cancelKeyboard4 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, privateMessage, cancelKeyboard4);
            break;

        // Settings buttons
        case '💰 إعدادات المكافآت':
        case '💰 Reward Settings':
            const rewardsKeyboard = keyboards.getKeyboard('rewardsSettings', language);
            const rewardsMessage = language === 'en' ?
                '💰 Reward and Price Settings:' :
                '💰 إعدادات المكافآت والأسعار:';
            bot.sendMessage(chatId, rewardsMessage, rewardsKeyboard);
            break;

        case '💳 تغيير الحد الأدنى للسحب':
        case '💳 Change Min Withdrawal':
            userStates.set(userId, 'change_min_withdrawal');
            const currentMinWithdrawal = await db.getSetting('min_withdrawal') || config.MIN_WITHDRAWAL;
            const minWithdrawalMessage = language === 'en' ?
                `💳 Current minimum withdrawal: ${formatBalance(parseFloat(currentMinWithdrawal), 'EGP')}\nSend new minimum:` :
                `💳 الحد الأدنى الحالي: ${formatBalance(parseFloat(currentMinWithdrawal), 'EGP')}\nأرسل الحد الجديد:`;
            const cancelKeyboard5 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, minWithdrawalMessage, cancelKeyboard5);
            break;

        case '� تعديل رسالة الدعم':
        case '� Edit Support Message':
            userStates.set(userId, 'change_support_message');
            const currentSupportMessage = await db.getSetting('support_message') || getMessage('SUPPORT', language);
            const supportMessage = language === 'en' ?
                `� Curreent support message:\n\n${currentSupportMessage}\n\n💡 Send new support message:` :
                `💬 رسالة الدعم الحالية:\n\n${currentSupportMessage}\n\n💡 أرسل رسالة الدعم الجديدة:`;
            const cancelKeyboard7 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, supportMessage, cancelKeyboard7);
            break;

        // Reward settings buttons
        case '� مكافأة مهمة اليوزرات':
        case '� Email Task Reward':
            userStates.set(userId, 'change_email_reward');
            const currentEmailReward = await db.getSetting('task_reward') || config.TASK_REWARD;
            const emailRewardMessage = language === 'en' ?
                `💰 Current email task reward: ${formatBalance(parseFloat(currentEmailReward), 'EGP')}\nSend new reward:` :
                `💰 مكافأة مهمة اليوزرات الحالية: ${formatBalance(parseFloat(currentEmailReward), 'EGP')}\nأرسل المكافأة الجديدة:`;
            const cancelKeyboard8 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, emailRewardMessage, cancelKeyboard8);
            break;

        case '📱 مكافأة مهمة الجيميل':
        case '📱 Gmail Task Reward':
            userStates.set(userId, 'change_gmail_reward');
            const currentGmailReward = await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD;
            const gmailRewardMessage = language === 'en' ?
                `📱 Current Gmail task reward: ${formatBalance(parseFloat(currentGmailReward), 'EGP')}\nSend new reward:` :
                `📱 مكافأة مهمة الجيميل الحالية: ${formatBalance(parseFloat(currentGmailReward), 'EGP')}\nأرسل المكافأة الجديدة:`;
            const cancelKeyboard9 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, gmailRewardMessage, cancelKeyboard9);
            break;

        case '🔗 مكافأة الإحالة':
        case '🔗 Referral Reward':
            const referralKeyboard = keyboards.getKeyboard('referralRewardSettings', language);
            const referralMessage = language === 'en' ?
                '🔗 Referral Reward Settings:' :
                '🔗 إعدادات مكافأة الإحالة:';
            bot.sendMessage(chatId, referralMessage, referralKeyboard);
            break;

        case '🔑 كلمة مرور الجيميل الموحدة':
        case '🔑 Universal Gmail Password':
            userStates.set(userId, 'change_gmail_password');
            const currentPassword = await db.getSetting('gmail_password') || config.GMAIL_PASSWORD;
            const passwordMessage = language === 'en' ?
                `🔑 Current password: ${currentPassword}\nSend new password:` :
                `🔑 كلمة المرور الحالية: ${currentPassword}\nأرسل كلمة المرور الجديدة:`;
            const cancelKeyboard10 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, passwordMessage, cancelKeyboard10);
            break;

        case '📝 تعديل نص مهمة الجيميل':
        case '📝 Edit Gmail Task Text':
            userStates.set(userId, 'change_gmail_task_text');
            const currentText = await db.getSetting('gmail_task_text') || config.DEFAULT_GMAIL_TASK_TEXT;
            const editMessage = language === 'en' ?
                `📝 Current Gmail task text:\n\n${currentText.replace('{password}', 'PASSWORD')}\n\n💡 Send new text:\n\n⚠️ Use {password} as placeholder for password` :
                `📝 النص الحالي لمهمة الجيميل:\n\n${currentText.replace('{password}', 'كلمة_المرور')}\n\n💡 أرسل النص الجديد:\n\n⚠️ استخدم {password} مكان كلمة المرور`;
            const cancelKeyboard11 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, editMessage, cancelKeyboard11);
            break;

        case '💰 مكافأة الإحالة بالجنيه':
        case '💰 Referral Reward EGP':
            userStates.set(userId, 'change_referral_reward_egp');
            const currentReferralEGP = await db.getSetting('referral_reward_egp') || config.REFERRAL_REWARD_EGP;
            const referralEGPMessage = language === 'en' ?
                `💰 Current referral reward (EGP): ${formatBalance(parseFloat(currentReferralEGP), 'EGP')}\nSend new reward:` :
                `💰 مكافأة الإحالة الحالية (جنيه): ${formatBalance(parseFloat(currentReferralEGP), 'EGP')}\nأرسل المكافأة الجديدة:`;
            const cancelKeyboard12 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, referralEGPMessage, cancelKeyboard12);
            break;

        case '💵 مكافأة الإحالة بالدولار':
        case '💵 Referral Reward USD':
            userStates.set(userId, 'change_referral_reward_usd');
            const currentReferralUSD = await db.getSetting('referral_reward_usd') || config.REFERRAL_REWARD_USD;
            const referralUSDMessage = language === 'en' ?
                `💵 Current referral reward (USD): ${formatBalance(parseFloat(currentReferralUSD), 'USD')}\nSend new reward:` :
                `💵 مكافأة الإحالة الحالية (دولار): ${formatBalance(parseFloat(currentReferralUSD), 'USD')}\nأرسل المكافأة الجديدة:`;
            const cancelKeyboard13 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, referralUSDMessage, cancelKeyboard13);
            break;

        case '🔙 العودة لإعدادات المكافآت':
        case '🔙 Back to Reward Settings':
            const backRewardsKeyboard = keyboards.getKeyboard('rewardsSettings', language);
            const backRewardsMessage = language === 'en' ?
                '💰 Reward and Price Settings:' :
                '💰 إعدادات المكافآت والأسعار:';
            bot.sendMessage(chatId, backRewardsMessage, backRewardsKeyboard);
            break;

        // Navigation buttons
        case '🔙 العودة للإعدادات':
        case '🔙 Back to Settings':
            const backSettingsKeyboard = keyboards.getKeyboard('settingsKeyboard', language);
            const backSettingsMessage = language === 'en' ?
                '⚙️ System Settings:' :
                '⚙️ إعدادات النظام:';
            bot.sendMessage(chatId, backSettingsMessage, backSettingsKeyboard);
            break;

        case '🔙 العودة لقائمة الأدمن':
        case '🔙 Back to Admin Menu':
            const adminKeyboard = keyboards.getKeyboard('adminKeyboard', language);
            const adminMessage = language === 'en' ?
                '👑 Admin Panel:' :
                '👑 لوحة الأدمن:';
            bot.sendMessage(chatId, adminMessage, adminKeyboard);
            break;

        default:
            // For unhandled buttons, show main admin menu
            const defaultKeyboard = keyboards.getKeyboard('adminKeyboard', language);
            const defaultMessage = language === 'en' ?
                '👑 Admin Panel - Choose an option:' :
                '👑 لوحة الأدمن - اختر خياراً:';
            bot.sendMessage(chatId, defaultMessage, defaultKeyboard);
            break;
    }
}

// Show tasks menu - Gmail only
async function showTasksMenu(chatId, userId, language) {
    try {
        // Get current Gmail reward from database or config
        const gmailReward = await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD;

        // Get user's currency for display
        const user = await db.getUser(userId);
        const currency = user?.preferred_currency || 'EGP';

        // Calculate reward in user's currency
        let gmailRewardDisplay;

        if (currency === 'USD') {
            const gmailRewardUSD = await convertEGPToUSD(parseFloat(gmailReward));
            gmailRewardDisplay = `${gmailRewardUSD.toFixed(3)}`;
        } else {
            gmailRewardDisplay = formatBalance(parseFloat(gmailReward), 'EGP');
        }

        // Send warning message first
        const warningMessage = language === 'en' ?
            `⚠️ Important Notice:\n\nIf you face any problems or delays in payment, contact support immediately and don't hesitate!\n\n📞 Support is always ready to help you.` :
            `⚠️ تنبيه مهم:\n\nإذا واجهت أي مشكلة أو تأخير في الدفع، كلم الدعم فوراً ولا تتردد!\n\n📞 الدعم جاهز دائماً لمساعدتك.`;

        await bot.sendMessage(chatId, warningMessage);

        // Send tasks menu immediately
        const keyboard = keyboards.createTasksMenuWithRewards(language, '', gmailRewardDisplay);
        const message = language === 'en' ?
            `📋 Available Tasks:\n\n💰 Choose a task to start earning!\n\n✨ Rewards are updated automatically!` :
            `📋 المهام المتاحة:\n\n💰 اختر مهمة لتبدأ الربح!\n\n✨ المكافآت تتحدث تلقائياً!`;

        await bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error showing tasks menu:', error);
        // Fallback with warning message
        const warningMessage = language === 'en' ?
            `⚠️ Important Notice:\n\nIf you face any problems or delays in payment, contact support immediately and don't hesitate!\n\n📞 Support is always ready to help you.` :
            `⚠️ تنبيه مهم:\n\nإذا واجهت أي مشكلة أو تأخير في الدفع، كلم الدعم فوراً ولا تتردد!\n\n📞 الدعم جاهز دائماً لمساعدتك.`;

        await bot.sendMessage(chatId, warningMessage);

        // Send tasks menu immediately
        const keyboard = keyboards.getKeyboard('tasksMenu', language);
        const message = language === 'en' ?
            '📋 Available Tasks:\n\nChoose a task to start earning!' :
            '📋 المهام المتاحة:\n\nاختر مهمة لتبدأ الربح!';
        await bot.sendMessage(chatId, message, keyboard);
    }
}


// Assign Gmail creation task
async function assignGmailTask(chatId, userId, language) {
    try {
        // Remove any existing active tasks before creating new one
        const existingTask = await db.getActiveTask(userId);
        if (existingTask) {
            await db.removeActiveTask(userId);
        }

        const password = await db.getSetting('gmail_password') || config.GMAIL_PASSWORD;

        // Create Gmail task without expiration (no timeout)
        await db.addActiveTask(userId, 'gmail_task', password, null);

        // Get Gmail task text from database settings or use default
        let gmailTaskText = await db.getSetting('gmail_task_text');
        if (!gmailTaskText) {
            gmailTaskText = config.DEFAULT_GMAIL_TASK_TEXT;
            // Save default text to database for future admin editing
            await db.setSetting('gmail_task_text', gmailTaskText);
        }

        const message = gmailTaskText.replace('{password}', password);

        const keyboard = keyboards.getKeyboard('gmailTask', language);
        await bot.sendMessage(chatId, message, keyboard);

        // Send additional instruction message
        const instructionMessage = language === 'en' ?
            '📱 Steps to complete this task:\n\n1️⃣ Create Gmail account using the password above\n2️⃣ Press "Continue" button below\n3️⃣ Send your new Gmail address\n4️⃣ Wait for admin approval\n\n💰 You will receive your reward after approval!\n\n❌ If you are unable to complete the task, please cancel it' :
            '📱 خطوات إكمال هذه المهمة:\n\n1️⃣ أنشئ حساب جيميل باستخدام كلمة المرور أعلاه\n2️⃣ اضغط زر "متابعة" أدناه\n3️⃣ أرسل عنوان الجيميل الجديد\n4️⃣ انتظر موافقة الأدمن\n\n💰 ستحصل على مكافأتك بعد الموافقة!\n\n❌ إذا لم تتمكن من إكمال المهمة، يرجى إلغاؤها';
        
        setTimeout(() => {
            bot.sendMessage(chatId, instructionMessage);
        }, 2000);

        // No timeout for Gmail tasks - user can take as long as needed

    } catch (error) {
        console.error('Error assigning Gmail task:', error);
        const message = language === 'en' ?
            '❌ Error assigning Gmail task' :
            '❌ حدث خطأ في تعيين مهمة الجيميل';
        bot.sendMessage(chatId, message);
    }
}

// Handle location message

// Continue Gmail task
async function continueGmailTask(chatId, userId, language) {
    try {
        const task = await db.getActiveTask(userId);
        if (!task || task.email !== 'gmail_task') {
            const message = language === 'en' ?
                '❌ No active Gmail task found\n\n💡 Please start a new Gmail task from the Tasks menu' :
                '❌ لا توجد مهمة جيميل نشطة\n\n💡 يرجى بدء مهمة جيميل جديدة من قائمة المهام';
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Proceed to email input directly
        userStates.set(userId, 'gmail_waiting_email');
        const message = language === 'en' ?
            '� Perfect! Now send the Gmail address you created:\n\n💡 Example: yourname@gmail.com\n\n⚠️ Make sure to send only the email address!' :
            '� ممتاز! الآن أرسل عنوان الجيميل الذي أنشأته:\n\n💡 مثال: yourname@gmail.com\n\n⚠️ تأكد من إرسال عنوان الإيميل فقط!';

        const keyboard = keyboards.getKeyboard('cancelUser', language);
        await bot.sendMessage(chatId, message, keyboard);

    } catch (error) {
        console.error('Error in Gmail task continuation:', error);
        const message = language === 'en' ?
            '❌ Error in Gmail task' :
            '❌ حدث خطأ في مهمة الجيميل';
        bot.sendMessage(chatId, message);
    }
}

// Cancel task
async function cancelTask(chatId, userId, language) {
    try {
        await db.removeActiveTask(userId);

        const keyboard = keyboards.getKeyboard('userKeyboard', language);
        const message = language === 'en' ?
            '✅ Task cancelled' :
            '✅ تم إلغاء المهمة';
        bot.sendMessage(chatId, message, keyboard);

    } catch (error) {
        console.error('Error cancelling task:', error);
    }
}

// Handle currency selection
async function handleCurrencySelection(chatId, userId, currency, language) {
    try {
        await db.setUserPreferredCurrency(userId, currency);

        // Get current rewards from database or config
        const emailReward = await db.getSetting('task_reward') || config.TASK_REWARD;
        const gmailReward = await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD;

        let message = '';
        if (currency === 'USD') {
            const emailRewardUSD = await convertEGPToUSD(parseFloat(emailReward));
            const gmailRewardUSD = await convertEGPToUSD(parseFloat(gmailReward));
            message = language === 'en' ?
                `✅ US Dollar selected as preferred currency!\n\n💵 You will receive rewards in USD\n💳 Withdrawals via Payeer and Binance\n\n📊 Reward rates:\n📧 Email task: $${emailRewardUSD.toFixed(3)}\n📱 Gmail task: $${gmailRewardUSD.toFixed(3)}\n\n💡 You can change currency later from "💱 Change Currency"` :
                `✅ تم اختيار الدولار الأمريكي كعملة مفضلة!\n\n💵 ستحصل على مكافآتك بالدولار\n💳 السحب سيكون عبر Payeer و Binance\n\n📊 أسعار المكافآت:\n📧 مهمة اليوزرات: $${emailRewardUSD.toFixed(3)}\n📱 مهمة الجيميل: $${gmailRewardUSD.toFixed(3)}\n\n💡 يمكنك تغيير العملة لاحقاً من زر "💱 تغيير العملة"`;
        } else {
            message = language === 'en' ?
                `✅ Egyptian Pound selected as preferred currency!\n\n💰 You will receive rewards in EGP\n💳 Withdrawals via local wallets\n\n📊 Reward rates:\n📧 Email task: ${formatBalance(parseFloat(emailReward), 'EGP')}\n📱 Gmail task: ${formatBalance(parseFloat(gmailReward), 'EGP')}\n\n💡 You can change currency later from "💱 Change Currency"` :
                `✅ تم اختيار الجنيه المصري كعملة مفضلة!\n\n💰 ستحصل على مكافآتك بالجنيه المصري\n💳 السحب سيكون عبر المحافظ المحلية\n\n📊 أسعار المكافآت:\n📧 مهمة اليوزرات: ${formatBalance(parseFloat(emailReward), 'EGP')}\n📱 مهمة الجيميل: ${formatBalance(parseFloat(gmailReward), 'EGP')}\n\n💡 يمكنك تغيير العملة لاحقاً من زر "💱 تغيير العملة"`;
        }

        const keyboard = keyboards.getKeyboard('userKeyboard', language);
        bot.sendMessage(chatId, message, keyboard);

        setTimeout(() => {
            bot.sendMessage(chatId, getMessage('CHOOSE_TASKS', language));
        }, 1000);

    } catch (error) {
        console.error('Error selecting currency:', error);
        const message = language === 'en' ?
            '❌ Error selecting currency, try again' :
            '❌ حدث خطأ في اختيار العملة، حاول مرة أخرى';
        bot.sendMessage(chatId, message);
    }
}

// Show currency change menu
async function showCurrencyChangeMenu(chatId, userId, language) {
    try {
        const user = await db.getUser(userId);
        if (!user) {
            const message = language === 'en' ?
                '❌ User data not found' :
                '❌ لم يتم العثور على بياناتك';
            return bot.sendMessage(chatId, message);
        }

        const currentCurrency = user.preferred_currency || 'EGP';
        const currentCurrencyName = language === 'en' ?
            (currentCurrency === 'USD' ? 'US Dollar' : 'Egyptian Pound') :
            (currentCurrency === 'USD' ? 'الدولار الأمريكي' : 'الجنيه المصري');

        const currentMethod = language === 'en' ?
            (currentCurrency === 'USD' ? 'Payeer and Binance' : 'Local wallets') :
            (currentCurrency === 'USD' ? 'Payeer و Binance' : 'محافظ محلية');

        let balanceInfo = '';
        if (currentCurrency === 'USD') {
            const usdBalance = user.balance_usd || 0;
            const egpEquivalent = await convertUSDToEGP(usdBalance);
            balanceInfo = language === 'en' ?
                `💰 Current balance: $${usdBalance.toFixed(2)}\n💱 EGP equivalent: ${formatBalance(egpEquivalent, 'EGP')}` :
                `💰 رصيدك الحالي: $${usdBalance.toFixed(2)}\n💱 معادل بالجنيه: ${formatBalance(egpEquivalent, 'EGP')}`;
        } else {
            const egpBalance = user.balance || 0;
            const usdEquivalent = await convertEGPToUSD(egpBalance);
            balanceInfo = language === 'en' ?
                `💰 Current balance: ${formatBalance(egpBalance, 'EGP')}\n💱 USD equivalent: $${usdEquivalent.toFixed(3)}` :
                `💰 رصيدك الحالي: ${formatBalance(egpBalance, 'EGP')}\n💱 معادل بالدولار: $${usdEquivalent.toFixed(3)}`;
        }

        const currentRate = await db.getSetting('usd_to_egp_rate') || config.USD_TO_EGP_RATE;
        const message = language === 'en' ?
            `💱 Currency Settings\n\n📊 Current currency: ${currentCurrencyName}\n💳 Withdrawal method: ${currentMethod}\n\n${balanceInfo}\n\n⚠️ Currency conversion:\n• Your balance will be converted at current rate (1$ = ${currentRate} EGP)\n• You won't lose any balance\n• Withdrawal method will change based on new currency\n\n💡 Choose new currency:` :
            `💱 إعدادات العملة\n\n📊 العملة الحالية: ${currentCurrencyName}\n💳 طريقة السحب: ${currentMethod}\n\n${balanceInfo}\n\n⚠️ تحويل العملة:\n• سيتم تحويل رصيدك بسعر الصرف الحالي (1$ = ${currentRate} جنيه)\n• لن تفقد أي من رصيدك\n• ستتغير طريقة السحب حسب العملة الجديدة\n\n💡 اختر العملة الجديدة:`;

        const keyboard = keyboards.getKeyboard('currencyChange', language);
        bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error showing currency change menu:', error);
        const message = language === 'en' ?
            '❌ Error occurred, try again' :
            '❌ حدث خطأ، حاول مرة أخرى';
        bot.sendMessage(chatId, message);
    }
}

// Handle currency change
async function handleCurrencyChange(chatId, userId, newCurrency, language) {
    try {
        const user = await db.getUser(userId);
        if (!user) {
            const message = language === 'en' ?
                '❌ User data not found' :
                '❌ لم يتم العثور على بياناتك';
            return bot.sendMessage(chatId, message);
        }

        const currentCurrency = user.preferred_currency || 'EGP';

        if (currentCurrency === newCurrency) {
            const currencyName = language === 'en' ?
                (newCurrency === 'USD' ? 'US Dollar' : 'Egyptian Pound') :
                (newCurrency === 'USD' ? 'الدولار الأمريكي' : 'الجنيه المصري');
            const message = language === 'en' ?
                `💡 You are already using ${currencyName}!` :
                `💡 أنت تستخدم ${currencyName} بالفعل!`;
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Convert balance
        if (currentCurrency === 'EGP' && newCurrency === 'USD') {
            const egpBalance = user.balance || 0;
            const usdBalance = await convertEGPToUSD(egpBalance);

            await db.setUserPreferredCurrency(userId, 'USD');
            await db.setUserUSDBalance(userId, usdBalance);
            await db.setUserBalance(userId, 0);

            const message = language === 'en' ?
                `✅ Currency changed to US Dollar!\n\n💱 Balance converted:\n${formatBalance(egpBalance, 'EGP')} → $${usdBalance.toFixed(2)}\n\n💳 New withdrawal methods: Payeer and Binance\n📊 You will receive rewards in USD from now on` :
                `✅ تم تغيير العملة إلى الدولار الأمريكي!\n\n💱 تم تحويل رصيدك:\n${formatBalance(egpBalance, 'EGP')} ← $${usdBalance.toFixed(2)}\n\n💳 طرق السحب الجديدة: Payeer و Binance\n📊 ستحصل على المكافآت بالدولار من الآن`;

            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, message, keyboard);

        } else if (currentCurrency === 'USD' && newCurrency === 'EGP') {
            const usdBalance = user.balance_usd || 0;
            const egpBalance = await convertUSDToEGP(usdBalance);

            await db.setUserPreferredCurrency(userId, 'EGP');
            await db.setUserBalance(userId, egpBalance);
            await db.setUserUSDBalance(userId, 0);

            const message = language === 'en' ?
                `✅ Currency changed to Egyptian Pound!\n\n💱 Balance converted:\n$${usdBalance.toFixed(2)} → ${formatBalance(egpBalance, 'EGP')}\n\n💳 New withdrawal method: Local wallets\n📊 You will receive rewards in EGP from now on` :
                `✅ تم تغيير العملة إلى الجنيه المصري!\n\n💱 تم تحويل رصيدك:\n$${usdBalance.toFixed(2)} ← ${formatBalance(egpBalance, 'EGP')}\n\n💳 طريقة السحب الجديدة: محافظ محلية\n📊 ستحصل على المكافآت بالجنيه من الآن`;

            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, message, keyboard);
        }

        setTimeout(() => {
            bot.sendMessage(chatId, getMessage('CHOOSE_TASKS', language));
        }, 1000);

    } catch (error) {
        console.error('Error changing currency:', error);
        const message = language === 'en' ?
            '❌ Error changing currency, try again' :
            '❌ حدث خطأ في تغيير العملة، حاول مرة أخرى';
        bot.sendMessage(chatId, message);
    }
}

// Show wallet
// Show wallet - EGP only
async function showWallet(chatId, userId, language) {
    try {
        let user = await db.getUser(userId);

        // If user doesn't exist, create them first
        if (!user) {
            await db.addUser(userId, null);
            user = await db.getUser(userId);
        }

        if (!user) {
            const message = language === 'en' ?
                '❌ User data not found' :
                '❌ لم يتم العثور على بياناتك';
            return bot.sendMessage(chatId, message);
        }

        const egpBalance = user.balance || 0;
        const minWithdrawalEGP = await db.getSetting('min_withdrawal') || config.MIN_WITHDRAWAL;

        const message = language === 'en' ?
            `💰 Your Wallet:\n\n💵 Current balance: ${formatBalance(egpBalance, 'EGP')}\n📊 Minimum withdrawal: ${formatBalance(parseFloat(minWithdrawalEGP), 'EGP')}\n💳 Withdrawal method: Cash Wallet` :
            `💰 محفظتك:\n\n💵 الرصيد الحالي: ${formatBalance(egpBalance, 'EGP')}\n📊 الحد الأدنى للسحب: ${formatBalance(parseFloat(minWithdrawalEGP), 'EGP')}\n💳 طريقة السحب: محفظة كاش`;

        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error showing wallet:', error);
        const message = language === 'en' ?
            '❌ Error showing wallet' :
            '❌ حدث خطأ في عرض المحفظة';
        bot.sendMessage(chatId, message);
    }
}


// Initiate withdrawal - EGP only
async function initiateWithdrawal(chatId, userId, language) {
    try {
        let user = await db.getUser(userId);
        
        // If user doesn't exist, create them first
        if (!user) {
            await db.addUser(userId, null);
            user = await db.getUser(userId);
        }
        
        if (!user) {
            const message = '❌ لم يتم العثور على بياناتك';
            return bot.sendMessage(chatId, message);
        }

        const currentBalance = user.balance || 0;
        const minWithdrawalEGP = await db.getSetting('min_withdrawal') || config.MIN_WITHDRAWAL;
        const minWithdrawal = parseFloat(minWithdrawalEGP);

        if (currentBalance < minWithdrawal) {
            const message = `❌ رصيدك غير كافي للسحب\n\n💰 رصيدك الحالي: ${formatBalance(currentBalance, 'EGP')}\n📊 الحد الأدنى: ${formatBalance(minWithdrawal, 'EGP')}`;
            return bot.sendMessage(chatId, message);
        }

        userStates.set(userId, 'withdrawal_amount');
        const message = `💳 رصيدك الحالي: ${formatBalance(currentBalance, 'EGP')}\n\n📝 أرسل المبلغ المراد سحبه بالجنيه المصري:`;

        const keyboard = keyboards.getKeyboard('cancelUser', language);
        bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error initiating withdrawal:', error);
        const message = '❌ حدث خطأ في عملية السحب';
        bot.sendMessage(chatId, message);
    }
}

// Handle user states
async function handleUserState(chatId, userId, text, state, language) {
    // Handle both object and string states
    const stateValue = typeof state === 'object' ? state.state : state;
    
    switch (stateValue) {
        case 'gmail_waiting_email':
            await processGmailEmail(chatId, userId, text, language);
            break;

        case 'withdrawal_amount':
            await processWithdrawal(chatId, userId, text, language);
            break;



        case 'change_gmail_task_text':
            await changeGmailTaskText(chatId, userId, text, language);
            break;

        case 'searching_user':
            await searchAndShowUser(chatId, text, language);
            userStates.delete(userId);
            const userMgmtKeyboard = keyboards.getKeyboard('userManagement', language);
            const userMgmtMessage = language === 'en' ? '👥 User Management:' : '👥 إدارة المستخدمين:';
            bot.sendMessage(chatId, userMgmtMessage, userMgmtKeyboard);
            break;

        case 'broadcast_message':
            await sendBroadcastMessage(chatId, text, language);
            userStates.delete(userId);
            const messageKeyboard = keyboards.getKeyboard('messageKeyboard', language);
            const messageMenuMessage = language === 'en' ? '📨 Message Options:' : '📨 خيارات الرسائل:';
            bot.sendMessage(chatId, messageMenuMessage, messageKeyboard);
            break;

        case 'private_message_id':
            const targetUser = await db.getUser(text);
            if (!targetUser) {
                const errorMessage = language === 'en' ?
                    '❌ User not found\nSend a valid ID or press Cancel:' :
                    '❌ لم يتم العثور على المستخدم\nأرسل آيدي صحيح أو اضغط إلغاء:';
                const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
                return bot.sendMessage(chatId, errorMessage, cancelKeyboard);
            }
            userStates.set(userId, `private_message_text_${text}`);
            const privateMessage = language === 'en' ?
                `📝 Write message for user: ${targetUser.username || 'Unknown'}` :
                `📝 اكتب الرسالة للمستخدم: ${targetUser.username || 'غير محدد'}`;
            const cancelKeyboard2 = keyboards.getKeyboard('cancelAdmin', language);
            bot.sendMessage(chatId, privateMessage, cancelKeyboard2);
            break;

        case 'change_min_withdrawal':
            await changeMinWithdrawal(chatId, text, language);
            userStates.delete(userId);
            const settingsKeyboard = keyboards.getKeyboard('settingsKeyboard', language);
            const settingsMessage = language === 'en' ? '⚙️ System Settings:' : '⚙️ إعدادات النظام:';
            bot.sendMessage(chatId, settingsMessage, settingsKeyboard);
            break;

        case 'change_support_message':
            await changeSupportMessage(chatId, text, language);
            userStates.delete(userId);
            const settingsKeyboard3 = keyboards.getKeyboard('settingsKeyboard', language);
            const settingsMessage3 = language === 'en' ? '⚙️ System Settings:' : '⚙️ إعدادات النظام:';
            bot.sendMessage(chatId, settingsMessage3, settingsKeyboard3);
            break;

        case 'change_email_reward':
            await changeEmailTaskReward(chatId, text, language);
            userStates.delete(userId);
            const rewardsKeyboard = keyboards.getKeyboard('rewardsSettings', language);
            const rewardsMessage = language === 'en' ? '💰 Reward and Price Settings:' : '💰 إعدادات المكافآت والأسعار:';
            bot.sendMessage(chatId, rewardsMessage, rewardsKeyboard);
            break;

        case 'change_gmail_reward':
            await changeGmailTaskReward(chatId, text, language);
            userStates.delete(userId);
            const rewardsKeyboard2 = keyboards.getKeyboard('rewardsSettings', language);
            const rewardsMessage2 = language === 'en' ? '💰 Reward and Price Settings:' : '💰 إعدادات المكافآت والأسعار:';
            bot.sendMessage(chatId, rewardsMessage2, rewardsKeyboard2);
            break;

        case 'change_gmail_password':
            await changeGmailPassword(chatId, text, language);
            userStates.delete(userId);
            const rewardsKeyboard3 = keyboards.getKeyboard('rewardsSettings', language);
            const rewardsMessage3 = language === 'en' ? '💰 Reward and Price Settings:' : '💰 إعدادات المكافآت والأسعار:';
            bot.sendMessage(chatId, rewardsMessage3, rewardsKeyboard3);
            break;

        case 'change_referral_reward_egp':
            await changeReferralRewardEGP(chatId, text, language);
            userStates.delete(userId);
            const referralKeyboard1 = keyboards.getKeyboard('referralRewardSettings', language);
            const referralMessage1 = language === 'en' ? '🔗 Referral Reward Settings:' : '🔗 إعدادات مكافأة الإحالة:';
            bot.sendMessage(chatId, referralMessage1, referralKeyboard1);
            break;

        case 'change_referral_reward_usd':
            await changeReferralRewardUSD(chatId, text, language);
            userStates.delete(userId);
            const referralKeyboard2 = keyboards.getKeyboard('referralRewardSettings', language);
            const referralMessage2 = language === 'en' ? '🔗 Referral Reward Settings:' : '🔗 إعدادات مكافأة الإحالة:';
            bot.sendMessage(chatId, referralMessage2, referralKeyboard2);
            break;

        case 'waiting_approve_emails':
            await processSelectiveApproval(chatId, userId, text, language);
            break;

        case 'waiting_reject_emails':
            await processSelectiveRejection(chatId, userId, text, language);
            break;

        default:
            if (stateValue.startsWith('withdrawal_method_')) {
                const amount = parseFloat(stateValue.replace('withdrawal_method_', ''));
                await handleWithdrawalMethodSelection(chatId, userId, text, amount, language);
            } else if (stateValue.startsWith('withdrawal_payeer_')) {
                const amount = parseFloat(stateValue.replace('withdrawal_payeer_', ''));
                await processPayeerWithdrawal(chatId, userId, text, amount, language);
            } else if (stateValue.startsWith('withdrawal_binance_')) {
                const amount = parseFloat(stateValue.replace('withdrawal_binance_', ''));
                await processBinanceWithdrawal(chatId, userId, text, amount, language);
            } else if (stateValue.startsWith('withdrawal_cash_')) {
                const amount = parseFloat(stateValue.replace('withdrawal_cash_', ''));
                await processCashWithdrawal(chatId, userId, text, amount, language);
            } else if (stateValue.startsWith('private_message_text_')) {
                const targetUserId = stateValue.replace('private_message_text_', '');
                await sendPrivateMessage(chatId, targetUserId, text, language);
                userStates.delete(userId);
                const messageKeyboard2 = keyboards.getKeyboard('messageKeyboard', language);
                const messageMenuMessage2 = language === 'en' ? '📨 Message Options:' : '📨 خيارات الرسائل:';
                bot.sendMessage(chatId, messageMenuMessage2, messageKeyboard2);
            } else if (stateValue.startsWith('edit_balance_')) {
                const targetUserId = stateValue.replace('edit_balance_', '');
                await processBalanceEdit(chatId, targetUserId, text, language);
                userStates.delete(userId);
                const userMgmtKeyboard = keyboards.getKeyboard('userManagement', language);
                const userMgmtMessage = language === 'en' ? '👥 User Management:' : '👥 إدارة المستخدمين:';
                bot.sendMessage(chatId, userMgmtMessage, userMgmtKeyboard);
            } else if (stateValue.startsWith('send_message_')) {
                const targetUserId = stateValue.replace('send_message_', '');
                await sendDirectMessage(chatId, targetUserId, text, language);
                userStates.delete(userId);
                const userMgmtKeyboard = keyboards.getKeyboard('userManagement', language);
                const userMgmtMessage = language === 'en' ? '👥 User Management:' : '👥 إدارة المستخدمين:';
                bot.sendMessage(chatId, userMgmtMessage, userMgmtKeyboard);
            }
            break;
    }
}

// Process Gmail email submission
async function processGmailEmail(chatId, userId, text, language) {
    try {
        // Check if user has active Gmail task
        const task = await db.getActiveTask(userId);
        if (!task || task.email !== 'gmail_task') {
            const message = language === 'en' ?
                '❌ No active Gmail task found\n\n💡 Please start a new Gmail task from the Tasks menu' :
                '❌ لا توجد مهمة جيميل نشطة\n\n💡 يرجى بدء مهمة جيميل جديدة من قائمة المهام';
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            userStates.delete(userId);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@gmail\.com$/i;
        if (!emailRegex.test(text)) {
            const message = language === 'en' ?
                '❌ Invalid Gmail address\n\n💡 Please send a valid Gmail address (example: yourname@gmail.com)\n\nOr press Cancel to exit:' :
                '❌ عنوان جيميل غير صحيح\n\n💡 يرجى إرسال عنوان جيميل صحيح (مثال: yourname@gmail.com)\n\nأو اضغط إلغاء للخروج:';
            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Check if email already exists
        const emailExists = await db.checkGmailEmailExists(text);
        if (emailExists) {
            const message = language === 'en' ?
                '❌ This Gmail address has already been submitted!\n\n💡 Please create a new Gmail account and send a different email address\n\n🔄 Each Gmail address can only be used once\n\nOr press Cancel to exit:' :
                '❌ تم إرسال هذا العنوان من قبل!\n\n💡 يرجى إنشاء حساب جيميل جديد وإرسال عنوان مختلف\n\n🔄 كل عنوان جيميل يمكن استخدامه مرة واحدة فقط\n\nأو اضغط إلغاء للخروج:';
            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        await db.addGmailAccount(userId, text);
        await db.removeActiveTask(userId);
        userStates.delete(userId);

        const keyboard = keyboards.getKeyboard('userKeyboard', language);
        const message = language === 'en' ?
            '✅ Excellent! Gmail account sent for review!\n\n💰 You will receive your reward after admin approval\n\n📞 If you have any questions, contact support' :
            '✅ ممتاز! تم إرسال حساب الجيميل للمراجعة!\n\n💰 ستحصل على مكافأتك بعد موافقة الأدمن\n\n📞 إذا كان لديك أي استفسار، تواصل مع الدعم';
        await bot.sendMessage(chatId, message, keyboard);

        // Notify admin
        const user = await db.getUser(userId);
        const adminMessage = `📱 New Gmail account for review!\n\nUser: ${user.username || 'Unknown'}\nID: ${userId}\nGmail: ${text}`;
        bot.sendMessage(config.ADMIN_ID, adminMessage);

    } catch (error) {
        console.error('Error processing Gmail email:', error);
        const message = language === 'en' ?
            '❌ Error processing Gmail account' :
            '❌ حدث خطأ في معالجة حساب الجيميل';
        bot.sendMessage(chatId, message);
    }
}

// Change Gmail task text (Admin function)
async function changeGmailTaskText(chatId, userId, text, language) {
    try {
        // Save new Gmail task text to database
        await db.setSetting('gmail_task_text', text);

        userStates.delete(userId);

        const successMessage = language === 'en' ?
            '✅ Gmail task text updated successfully!\n\n💡 The new text will be used for all future Gmail tasks.' :
            '✅ تم تحديث نص مهمة الجيميل بنجاح!\n\n💡 سيتم استخدام النص الجديد لجميع مهام الجيميل المستقبلية.';

        const rewardsKeyboard = keyboards.getKeyboard('rewardsSettings', language);
        bot.sendMessage(chatId, successMessage, rewardsKeyboard);

    } catch (error) {
        console.error('Error changing Gmail task text:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating Gmail task text' :
            '❌ حدث خطأ في تحديث نص مهمة الجيميل';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Process withdrawal request
// Process withdrawal request - EGP only
async function processWithdrawal(chatId, userId, text, language) {
    try {
        const withdrawAmount = parseFloat(text);
        if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
            const message = '❌ المبلغ غير صحيح\nأرسل رقم صحيح أو اضغط إلغاء:';
            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        const user = await db.getUser(userId);
        const currentBalance = user.balance || 0;
        const minWithdrawalEGP = await db.getSetting('min_withdrawal') || config.MIN_WITHDRAWAL;
        const minWithdrawal = parseFloat(minWithdrawalEGP);

        if (withdrawAmount > currentBalance) {
            const message = `❌ المبلغ أكبر من رصيدك\n\n💰 رصيدك الحالي: ${formatBalance(currentBalance, 'EGP')}\n\nأرسل مبلغ أقل أو اضغط إلغاء:`;
            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        if (withdrawAmount < minWithdrawal) {
            const message = `❌ المبلغ أقل من الحد الأدنى: ${formatBalance(minWithdrawal, 'EGP')}\n\nأرسل مبلغ أكبر أو اضغط إلغاء:`;
            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Ask for cash wallet number (EGP only)
        userStates.set(userId, `withdrawal_cash_${withdrawAmount}`);
        const message = `💳 طلب سحب محفظة كاش\n\n💰 المبلغ: ${formatBalance(withdrawAmount, 'EGP')}\n\n📝 يرجى إرسال رقم محفظة الكاش:\n\n📋 الصيغة: 11 رقم (01234567890)\n\n⚠️ تأكد من صحة الرقم!\nالرقم الخاطئ قد يؤدي لفقدان الأموال.`;

        const keyboard = keyboards.getKeyboard('cancelUser', language);
        bot.sendMessage(chatId, message, keyboard);

    } catch (error) {
        console.error('Error processing withdrawal:', error);
        const message = '❌ حدث خطأ في معالجة طلب السحب';
        bot.sendMessage(chatId, message);
    }
}


// Handle callback queries (inline button clicks)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    try {
        // Check if user is admin (except for withdrawal confirmation buttons)
        const isWithdrawalButton = data.startsWith('confirm_payeer_') ||
            data.startsWith('confirm_cash_') ||
            data.startsWith('confirm_binance_') ||
            data === 'cancel_withdrawal';

        if (!isAdmin(userId) && !isWithdrawalButton) {
            return bot.answerCallbackQuery(callbackQuery.id, {
                text: 'غير مسموح / Not authorized',
                show_alert: true
            });
        }

        const language = await getUserLanguage(userId);

        if (data.startsWith('approve_gmail_')) {
            const accountId = data.replace('approve_gmail_', '');
            await handleGmailApproval(chatId, accountId, messageId, language, true);
        } else if (data.startsWith('reject_gmail_')) {
            const accountId = data.replace('reject_gmail_', '');
            await handleGmailApproval(chatId, accountId, messageId, language, false);
        } else if (data.startsWith('ban_user_')) {
            const targetUserId = data.replace('ban_user_', '');
            await handleUserBan(chatId, targetUserId, messageId, language, true);
        } else if (data.startsWith('unban_user_')) {
            const targetUserId = data.replace('unban_user_', '');
            await handleUserBan(chatId, targetUserId, messageId, language, false);
        } else if (data.startsWith('edit_balance_')) {
            const targetUserId = data.replace('edit_balance_', '');
            await handleBalanceEdit(chatId, targetUserId, language);
        } else if (data.startsWith('message_user_')) {
            const targetUserId = data.replace('message_user_', '');
            await handleUserMessage(chatId, targetUserId, language);
        } else if (data.startsWith('user_details_')) {
            const targetUserId = data.replace('user_details_', '');
            await handleUserDetails(chatId, targetUserId, messageId, language);
        } else if (data.startsWith('refresh_user_')) {
            const targetUserId = data.replace('refresh_user_', '');
            await handleUserRefresh(chatId, targetUserId, messageId, language);
        } else if (data.startsWith('copy_id_')) {
            const targetUserId = data.replace('copy_id_', '');
            await handleCopyId(callbackQuery, targetUserId, language);
        } else if (data.startsWith('gmail_page_')) {
            const page = parseInt(data.replace('gmail_page_', ''));
            await showPendingGmailAccounts(chatId, language, page);
        } else if (data === 'page_info') {
            // Just acknowledge the callback, no action needed for page info button
            bot.answerCallbackQuery(callbackQuery.id, {
                text: language === 'en' ? 'Page information' : 'معلومات الصفحة',
                show_alert: false
            });
            return; // Don't call answerCallbackQuery again at the end
        } else if (data.startsWith('confirm_payeer_')) {
            await handlePayeerWithdrawalConfirm(chatId, messageId, data, language);
        } else if (data.startsWith('confirm_cash_')) {
            await handleCashWithdrawalConfirm(chatId, messageId, data, language);
        } else if (data.startsWith('confirm_binance_')) {
            await handleBinanceWithdrawalConfirm(chatId, messageId, data, language);
        } else if (data === 'cancel_withdrawal') {
            await handleWithdrawalCancel(chatId, messageId, language);
        } else if (data.startsWith('complete_withdrawal_')) {
            await handleWithdrawalCompletion(chatId, messageId, data, language);
        } else if (data === 'toggle_email_tasks') {
            await handleToggleEmailTasks(chatId, messageId, language);
        } else if (data === 'toggle_gmail_tasks') {
            await handleToggleGmailTasks(chatId, messageId, language);
        } else if (data === 'bulk_approve_confirm') {
            await processBulkApproval(chatId, messageId, language);
        } else if (data === 'bulk_approve_cancel') {
            const cancelMessage = language === 'en' ?
                '❌ Bulk approval cancelled' :
                '❌ تم إلغاء القبول الجماعي';
            bot.editMessageText(cancelMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        } else if (data === 'bulk_reject_confirm') {
            await processBulkRejection(chatId, messageId, language);
        } else if (data === 'bulk_reject_cancel') {
            const cancelMessage = language === 'en' ?
                '🔙 Bulk rejection cancelled' :
                '🔙 تم إلغاء الرفض الجماعي';
            bot.editMessageText(cancelMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        } else if (data.startsWith('selective_approve_')) {
            await processSelectiveApprovalConfirm(chatId, messageId, data, language);
        } else if (data === 'selective_approve_cancel') {
            const cancelMessage = language === 'en' ?
                '❌ Selective approval cancelled' :
                '❌ تم إلغاء القبول الانتقائي';
            bot.editMessageText(cancelMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        } else if (data.startsWith('selective_reject_')) {
            await processSelectiveRejectionConfirm(chatId, messageId, data, language);
        } else if (data === 'selective_reject_cancel') {
            const cancelMessage = language === 'en' ?
                '🔙 Selective rejection cancelled' :
                '🔙 تم إلغاء الرفض الانتقائي';
            bot.editMessageText(cancelMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Answer the callback query to remove loading state
        bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        console.error('Error handling callback query:', error);
        bot.answerCallbackQuery(callbackQuery.id, {
            text: 'حدث خطأ / Error occurred',
            show_alert: true
        });
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('error', (error) => {
    console.error('Bot error:', error);
});

// Handle delete all accounts confirmation
async function handleDeleteAllAccountsConfirm(chatId, messageId, language) {
    try {
        const totalCount = await db.getAvailableAccountsCount();

        if (totalCount === 0) {
            const message = language === 'en' ?
                '📦 No accounts to delete' :
                '📦 لا توجد يوزرات للحذف';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        const confirmMessage = language === 'en' ?
            `⚠️ DELETE ALL ACCOUNTS CONFIRMATION\n\n🗑️ You are about to delete ALL ${totalCount} available accounts!\n\n⚠️ This action CANNOT be undone!\n⚠️ All accounts will be permanently removed!\n⚠️ Users will not be able to get new tasks until you add new accounts!\n\n❓ Are you absolutely sure you want to continue?` :
            `⚠️ تأكيد حذف جميع اليوزرات\n\n🗑️ أنت على وشك حذف جميع الـ ${totalCount} يوزر المتاح!\n\n⚠️ هذا الإجراء لا يمكن التراجع عنه!\n⚠️ سيتم حذف جميع اليوزرات نهائياً!\n⚠️ لن يتمكن المستخدمون من الحصول على مهام جديدة حتى تضيف يوزرات جديدة!\n\n❓ هل أنت متأكد تماماً من المتابعة؟`;

        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '✅ YES, DELETE ALL' : '✅ نعم، احذف الكل',
                            callback_data: 'delete_all_accounts_yes'
                        },
                        {
                            text: language === 'en' ? '❌ NO, CANCEL' : '❌ لا، إلغاء',
                            callback_data: 'delete_all_accounts_no'
                        }
                    ]
                ]
            }
        };

        bot.editMessageText(confirmMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: confirmKeyboard.reply_markup
        });

    } catch (error) {
        console.error('Error showing delete all confirmation:', error);
        const errorMessage = language === 'en' ?
            '❌ Error showing confirmation' :
            '❌ حدث خطأ في عرض التأكيد';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle delete all accounts execution
async function handleDeleteAllAccounts(chatId, messageId, language) {
    try {
        const totalCount = await db.getAvailableAccountsCount();

        if (totalCount === 0) {
            const message = language === 'en' ?
                '📦 No accounts to delete' :
                '📦 لا توجد يوزرات للحذف';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Delete all accounts
        const deletedCount = await db.deleteAllAvailableAccounts();

        const successMessage = language === 'en' ?
            `🗑️ ALL ACCOUNTS DELETED SUCCESSFULLY!\n\n📊 Deleted Accounts: ${deletedCount}\n📅 Deletion Date: ${new Date().toLocaleString()}\n\n⚠️ All available accounts have been permanently removed!\n💡 You can add new accounts using "➕ Add Accounts" button\n\n🔄 The account pool is now empty - users cannot get new tasks until you add accounts.` :
            `🗑️ تم حذف جميع اليوزرات بنجاح!\n\n📊 اليوزرات المحذوفة: ${deletedCount}\n📅 تاريخ الحذف: ${new Date().toLocaleString()}\n\n⚠️ تم حذف جميع اليوزرات المتاحة نهائياً!\n💡 يمكنك إضافة يوزرات جديدة باستخدام زر "➕ إضافة يوزرات"\n\n🔄 مجموعة اليوزرات فارغة الآن - لن يتمكن المستخدمون من الحصول على مهام جديدة حتى تضيف يوزرات.`;

        bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error deleting all accounts:', error);
        const errorMessage = language === 'en' ?
            '❌ Error deleting all accounts' :
            '❌ حدث خطأ في حذف جميع اليوزرات';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}


// Process Payeer withdrawal with wallet validation
async function processPayeerWithdrawal(chatId, userId, walletAddress, amount, language) {
    try {
        // Validate Payeer wallet format: P + numbers (any length)
        const payeerRegex = /^P\d+$/;
        if (!payeerRegex.test(walletAddress)) {
            const message = language === 'en' ?
                `❌ Invalid Payeer wallet format!\n\n📋 Required format: P + numbers\n• Must start with P (capital letter)\n• Followed by numbers only\n\n📝 Examples:\n• P12345678\n• P1234567890\n• P123456\n\nPlease send correct wallet address or press Cancel:` :
                `❌ صيغة محفظة Payeer غير صحيحة!\n\n📋 الصيغة المطلوبة: P + أرقام\n• يجب أن تبدأ بـ P (حرف كبير)\n• متبوعة بأرقام فقط\n\n📝 أمثلة:\n• P12345678\n• P1234567890\n• P123456\n\nيرجى إرسال عنوان المحفظة الصحيح أو اضغط إلغاء:`;

            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Show confirmation message
        const confirmMessage = language === 'en' ?
            `💳 Confirm Payeer Withdrawal\n\n💰 Amount: $${amount.toFixed(2)}\n🏦 Payeer Wallet: ${walletAddress}\n\n⚠️ Please verify your wallet address carefully!\nOnce confirmed, this cannot be changed.\n\n✅ Is this information correct?` :
            `💳 تأكيد سحب Payeer\n\n💰 المبلغ: $${amount.toFixed(2)}\n🏦 محفظة Payeer: ${walletAddress}\n\n⚠️ يرجى التحقق من عنوان المحفظة بعناية!\nبعد التأكيد، لا يمكن تغيير هذه المعلومات.\n\n✅ هل هذه المعلومات صحيحة؟`;

        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '✅ Confirm Withdrawal' : '✅ تأكيد السحب',
                            callback_data: `confirm_payeer_${userId}_${amount}_${walletAddress}`
                        }
                    ],
                    [
                        {
                            text: language === 'en' ? '❌ Cancel' : '❌ إلغاء',
                            callback_data: 'cancel_withdrawal'
                        }
                    ]
                ]
            }
        };

        userStates.delete(userId);
        bot.sendMessage(chatId, confirmMessage, confirmKeyboard);

    } catch (error) {
        console.error('Error processing Payeer withdrawal:', error);
        const message = language === 'en' ?
            '❌ Error processing withdrawal request' :
            '❌ حدث خطأ في معالجة طلب السحب';
        bot.sendMessage(chatId, message);
    }
}

// Process Cash withdrawal with wallet validation
async function processCashWithdrawal(chatId, userId, walletNumber, amount, language) {
    try {
        // Validate cash wallet format: 11 digits
        const cashRegex = /^\d{11}$/;
        if (!cashRegex.test(walletNumber)) {
            const message = language === 'en' ?
                `❌ Invalid cash wallet number!\n\n📋 Required format: 11 digits\n• Must be exactly 11 numbers\n• No spaces or special characters\n\n📝 Example: 01234567890\n\nPlease send correct wallet number or press Cancel:` :
                `❌ رقم محفظة الكاش غير صحيح!\n\n📋 الصيغة المطلوبة: 11 رقم\n• يجب أن يكون 11 رقم بالضبط\n• بدون مسافات أو رموز خاصة\n\n📝 مثال: 01234567890\n\nيرجى إرسال رقم المحفظة الصحيح أو اضغط إلغاء:`;

            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Show confirmation message
        const confirmMessage = language === 'en' ?
            `💳 Confirm Cash Wallet Withdrawal\n\n💰 Amount: ${formatBalance(amount, 'EGP')}\n📱 Cash Wallet: ${walletNumber}\n\n⚠️ Please verify your wallet number carefully!\nOnce confirmed, this cannot be changed.\n\n✅ Is this information correct?` :
            `💳 تأكيد سحب محفظة الكاش\n\n💰 المبلغ: ${formatBalance(amount, 'EGP')}\n📱 محفظة الكاش: ${walletNumber}\n\n⚠️ يرجى التحقق من رقم المحفظة بعناية!\nبعد التأكيد، لا يمكن تغيير هذه المعلومات.\n\n✅ هل هذه المعلومات صحيحة؟`;

        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '✅ Confirm Withdrawal' : '✅ تأكيد السحب',
                            callback_data: `confirm_cash_${userId}_${amount}_${walletNumber}`
                        }
                    ],
                    [
                        {
                            text: language === 'en' ? '❌ Cancel' : '❌ إلغاء',
                            callback_data: 'cancel_withdrawal'
                        }
                    ]
                ]
            }
        };

        userStates.delete(userId);
        bot.sendMessage(chatId, confirmMessage, confirmKeyboard);

    } catch (error) {
        console.error('Error processing cash withdrawal:', error);
        const message = language === 'en' ?
            '❌ Error processing withdrawal request' :
            '❌ حدث خطأ في معالجة طلب السحب';
        bot.sendMessage(chatId, message);
    }
}

// Handle Payeer withdrawal confirmation
async function handlePayeerWithdrawalConfirm(chatId, messageId, data, language) {
    try {
        // Parse callback data: confirm_payeer_userId_amount_walletAddress
        const parts = data.split('_');
        const userId = parts[2];
        const amount = parseFloat(parts[3]);
        const walletAddress = parts.slice(4).join('_'); // In case wallet has underscores

        const user = await db.getUser(userId);
        if (!user) {
            const message = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Deduct amount from user balance immediately
        const currentBalance = user.balance_usd || 0;
        const newBalance = currentBalance - amount;
        await db.setUserUSDBalance(userId, newBalance);

        // Save withdrawal request
        const method = 'Payeer';
        const details = `Payeer Wallet: ${walletAddress}`;
        const requestId = await db.addWithdrawalRequest(userId, amount, 'USD', method, details);

        // Notify admin
        const adminMessage = language === 'en' ?
            `💳 New Payeer withdrawal request!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${userId}\n💰 Amount: $${amount.toFixed(2)}\n🏦 Payeer Wallet: ${walletAddress}\n💰 Current balance: $${(user.balance_usd || 0).toFixed(2)}\n📋 Request ID: #${requestId}` :
            `💳 طلب سحب Payeer جديد!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${userId}\n💰 المبلغ: $${amount.toFixed(2)}\n🏦 محفظة Payeer: ${walletAddress}\n💰 الرصيد الحالي: $${(user.balance_usd || 0).toFixed(2)}\n📋 رقم الطلب: #${requestId}`;

        bot.sendMessage(config.ADMIN_ID, adminMessage);

        const message = language === 'en' ?
            `✅ Payeer withdrawal request confirmed!\n\n💰 Amount: $${amount.toFixed(2)}\n🏦 Payeer Wallet: ${walletAddress}\n📋 Request ID: #${requestId}\n\n⏳ Your request will be processed soon\n💡 You will be notified once completed` :
            `✅ تم تأكيد طلب سحب Payeer!\n\n💰 المبلغ: $${amount.toFixed(2)}\n🏦 محفظة Payeer: ${walletAddress}\n📋 رقم الطلب: #${requestId}\n\n⏳ سيتم معالجة طلبك قريباً\n💡 سيتم إشعارك عند الانتهاء`;

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error confirming Payeer withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error confirming withdrawal' :
            '❌ حدث خطأ في تأكيد السحب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle Cash withdrawal confirmation
async function handleCashWithdrawalConfirm(chatId, messageId, data, language) {
    try {
        // Parse callback data: confirm_cash_userId_amount_walletNumber
        const parts = data.split('_');
        const userId = parts[2];
        const amount = parseFloat(parts[3]);
        const walletNumber = parts[4];

        const user = await db.getUser(userId);
        if (!user) {
            const message = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Deduct amount from user balance immediately
        const currentBalance = user.balance || 0;
        const newBalance = currentBalance - amount;
        await db.setUserBalance(userId, newBalance);

        // Save withdrawal request
        const method = 'Cash Wallet';
        const details = `Cash Wallet: ${walletNumber}`;
        const requestId = await db.addWithdrawalRequest(userId, amount, 'EGP', method, details);

        // Notify admin
        const adminMessage = language === 'en' ?
            `💳 New cash wallet withdrawal request!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${userId}\n💰 Amount: ${formatBalance(amount, 'EGP')}\n📱 Cash Wallet: ${walletNumber}\n💰 Current balance: ${formatBalance(user.balance || 0, 'EGP')}\n📋 Request ID: #${requestId}` :
            `💳 طلب سحب محفظة كاش جديد!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${userId}\n💰 المبلغ: ${formatBalance(amount, 'EGP')}\n📱 محفظة الكاش: ${walletNumber}\n💰 الرصيد الحالي: ${formatBalance(user.balance || 0, 'EGP')}\n📋 رقم الطلب: #${requestId}`;

        bot.sendMessage(config.ADMIN_ID, adminMessage);

        const message = language === 'en' ?
            `✅ Cash wallet withdrawal request confirmed!\n\n💰 Amount: ${formatBalance(amount, 'EGP')}\n📱 Cash Wallet: ${walletNumber}\n📋 Request ID: #${requestId}\n\n⏳ Your request will be processed soon\n💡 You will be notified once completed` :
            `✅ تم تأكيد طلب سحب محفظة الكاش!\n\n💰 المبلغ: ${formatBalance(amount, 'EGP')}\n📱 محفظة الكاش: ${walletNumber}\n📋 رقم الطلب: #${requestId}\n\n⏳ سيتم معالجة طلبك قريباً\n💡 سيتم إشعارك عند الانتهاء`;

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error confirming cash withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error confirming withdrawal' :
            '❌ حدث خطأ في تأكيد السحب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle withdrawal cancellation
async function handleWithdrawalCancel(chatId, messageId, language) {
    try {
        const message = language === 'en' ?
            '❌ Withdrawal request cancelled\n\n💡 You can start a new withdrawal request anytime from the main menu.' :
            '❌ تم إلغاء طلب السحب\n\n💡 يمكنك بدء طلب سحب جديد في أي وقت من القائمة الرئيسية.';

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error cancelling withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error cancelling withdrawal' :
            '❌ حدث خطأ في إلغاء السحب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle withdrawal completion by admin
async function handleWithdrawalCompletion(chatId, messageId, data, language) {
    try {
        // Parse callback data: complete_withdrawal_requestId
        const requestId = data.replace('complete_withdrawal_', '');

        // Get withdrawal request details
        const request = await db.getWithdrawalRequest(requestId);
        if (!request) {
            const message = language === 'en' ?
                '❌ Withdrawal request not found' :
                '❌ طلب السحب غير موجود';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        if (request.status !== 'pending') {
            const message = language === 'en' ?
                '❌ This withdrawal request has already been processed' :
                '❌ تم معالجة طلب السحب هذا مسبقاً';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Update withdrawal status to completed
        await db.completeWithdrawalRequest(requestId);

        // Deduct amount from user balance
        const user = await db.getUser(request.user_id);
        if (user) {
            if (request.currency === 'USD') {
                const newBalance = (user.balance_usd || 0) - request.amount;
                await db.setUserUSDBalance(request.user_id, Math.max(0, newBalance));
            } else {
                const newBalance = (user.balance || 0) - request.amount;
                await db.setUserBalance(request.user_id, Math.max(0, newBalance));
            }
        }

        // Update admin message
        const adminMessage = language === 'en' ?
            `✅ Withdrawal Completed!\n\n💳 Request #${requestId}\n👤 User: ${user?.username || 'Unknown'}\n🆔 User ID: ${request.user_id}\n💰 Amount: ${formatBalance(request.amount, request.currency)}\n💳 Method: ${request.method}\n📋 Details: ${request.details}\n📅 Completed: ${new Date().toLocaleString()}\n\n✅ Status: Payment Completed` :
            `✅ تم إكمال السحب!\n\n💳 طلب رقم #${requestId}\n👤 المستخدم: ${user?.username || 'غير محدد'}\n🆔 آيدي المستخدم: ${request.user_id}\n💰 المبلغ: ${formatBalance(request.amount, request.currency)}\n💳 الطريقة: ${request.method}\n📋 التفاصيل: ${request.details}\n📅 تاريخ الإكمال: ${new Date().toLocaleString()}\n\n✅ الحالة: تم الدفع`;

        bot.editMessageText(adminMessage, {
            chat_id: chatId,
            message_id: messageId
        });

        // Notify user about successful withdrawal
        try {
            const userLanguage = await getUserLanguage(request.user_id);
            const userMessage = userLanguage === 'en' ?
                `✅ Withdrawal Completed Successfully!\n\n💰 Amount: ${formatBalance(request.amount, request.currency)}\n💳 Method: ${request.method}\n📋 Details: ${request.details}\n📅 Completed: ${new Date().toLocaleString()}\n\n💡 Please check your wallet!\nThe payment has been sent to your account.\n\n📋 Request ID: #${requestId}` :
                `✅ تم إكمال السحب بنجاح!\n\n💰 المبلغ: ${formatBalance(request.amount, request.currency)}\n💳 الطريقة: ${request.method}\n📋 التفاصيل: ${request.details}\n📅 تاريخ الإكمال: ${new Date().toLocaleString()}\n\n💡 تأكد من محفظتك!\nتم إرسال الدفعة إلى حسابك.\n\n📋 رقم الطلب: #${requestId}`;

            await safeSendMessage(request.user_id, userMessage);
        } catch (error) {
            console.error('Failed to notify user about withdrawal completion:', error);
        }

    } catch (error) {
        console.error('Error completing withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error completing withdrawal' :
            '❌ حدث خطأ في إكمال السحب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle withdrawal method selection for USD
async function handleWithdrawalMethodSelection(chatId, userId, text, amount, language) {
    try {
        if (text === '🏦 Payeer') {
            // Ask for Payeer wallet address
            userStates.set(userId, `withdrawal_payeer_${amount}`);
            const message = language === 'en' ?
                `💳 Payeer Withdrawal Request\n\n💰 Amount: $${amount.toFixed(2)}\n\n📝 Please send your Payeer wallet address:\n\n📋 Format: P + 8 numbers (P12345678)\n\n⚠️ Make sure the address is correct!\nIncorrect address may result in loss of funds.` :
                `💳 طلب سحب Payeer\n\n💰 المبلغ: $${amount.toFixed(2)}\n\n📝 يرجى إرسال عنوان محفظة Payeer:\n\n📋 الصيغة: P + 8 أرقام (P12345678)\n\n⚠️ تأكد من صحة العنوان!\nالعنوان الخاطئ قد يؤدي لفقدان الأموال.`;

            const keyboard = keyboards.getKeyboard('cancelUser', language);
            bot.sendMessage(chatId, message, keyboard);

        } else if (text === '🟡 Binance') {
            // Ask for Binance ID
            userStates.set(userId, `withdrawal_binance_${amount}`);
            const message = language === 'en' ?
                `💳 Binance Withdrawal Request\n\n💰 Amount: $${amount.toFixed(2)}\n\n📝 Please send your Binance ID:\n\n📋 Format: 7-15 digits\n📝 Examples: 1234567 or 123456789012345\n\n⚠️ Make sure the ID is correct!\nIncorrect ID may result in loss of funds.` :
                `💳 طلب سحب Binance\n\n💰 المبلغ: $${amount.toFixed(2)}\n\n📝 يرجى إرسال معرف Binance:\n\n📋 الصيغة: 7-15 رقم\n📝 أمثلة: 1234567 أو 123456789012345\n\n⚠️ تأكد من صحة المعرف!\nالمعرف الخاطئ قد يؤدي لفقدان الأموال.`;

            const keyboard = keyboards.getKeyboard('cancelUser', language);
            bot.sendMessage(chatId, message, keyboard);

        } else if (text === '❌ Cancel' || text === '❌ إلغاء') {
            userStates.delete(userId);
            const message = language === 'en' ?
                '❌ Withdrawal cancelled' :
                '❌ تم إلغاء السحب';
            const keyboard = keyboards.getKeyboard('userKeyboard', language);
            bot.sendMessage(chatId, message, keyboard);
        } else {
            // Invalid selection
            const message = language === 'en' ?
                '❌ Invalid selection. Please choose a withdrawal method or press Cancel:' :
                '❌ اختيار غير صحيح. يرجى اختيار طريقة سحب أو اضغط إلغاء:';
            bot.sendMessage(chatId, message);
        }
    } catch (error) {
        console.error('Error handling withdrawal method selection:', error);
        const message = language === 'en' ?
            '❌ Error processing selection' :
            '❌ حدث خطأ في معالجة الاختيار';
        bot.sendMessage(chatId, message);
    }
}

// Process Binance withdrawal with ID validation
async function processBinanceWithdrawal(chatId, userId, binanceId, amount, language) {
    try {
        // Validate Binance ID format: 7-15 digits
        const binanceRegex = /^\d{7,15}$/;
        if (!binanceRegex.test(binanceId)) {
            const message = language === 'en' ?
                `❌ Invalid Binance ID format!\n\n📋 Required format: 7-15 digits\n• Must be between 7 and 15 numbers\n• No letters or special characters\n\n📝 Examples: 1234567, 123456789012345\n\nPlease send correct Binance ID or press Cancel:` :
                `❌ صيغة معرف Binance غير صحيحة!\n\n📋 الصيغة المطلوبة: 7-15 رقم\n• يجب أن يكون بين 7 و 15 رقم\n• بدون حروف أو رموز خاصة\n\n📝 أمثلة: 1234567، 123456789012345\n\nيرجى إرسال معرف Binance الصحيح أو اضغط إلغاء:`;

            const keyboard = keyboards.getKeyboard('cancelUser', language);
            return bot.sendMessage(chatId, message, keyboard);
        }

        // Show confirmation message
        const confirmMessage = language === 'en' ?
            `💳 Confirm Binance Withdrawal\n\n💰 Amount: $${amount.toFixed(2)}\n🟡 Binance ID: ${binanceId}\n\n⚠️ Please verify your Binance ID carefully!\nOnce confirmed, this cannot be changed.\n\n✅ Is this information correct?` :
            `💳 تأكيد سحب Binance\n\n💰 المبلغ: $${amount.toFixed(2)}\n🟡 معرف Binance: ${binanceId}\n\n⚠️ يرجى التحقق من معرف Binance بعناية!\nبعد التأكيد، لا يمكن تغيير هذه المعلومات.\n\n✅ هل هذه المعلومات صحيحة؟`;

        const confirmKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '✅ Confirm Withdrawal' : '✅ تأكيد السحب',
                            callback_data: `confirm_binance_${userId}_${amount}_${binanceId}`
                        }
                    ],
                    [
                        {
                            text: language === 'en' ? '❌ Cancel' : '❌ إلغاء',
                            callback_data: 'cancel_withdrawal'
                        }
                    ]
                ]
            }
        };

        userStates.delete(userId);
        bot.sendMessage(chatId, confirmMessage, confirmKeyboard);

    } catch (error) {
        console.error('Error processing Binance withdrawal:', error);
        const message = language === 'en' ?
            '❌ Error processing withdrawal request' :
            '❌ حدث خطأ في معالجة طلب السحب';
        bot.sendMessage(chatId, message);
    }
}

// Handle Binance withdrawal confirmation
async function handleBinanceWithdrawalConfirm(chatId, messageId, data, language) {
    try {
        // Parse callback data: confirm_binance_userId_amount_binanceId
        const parts = data.split('_');
        const userId = parts[2];
        const amount = parseFloat(parts[3]);
        const binanceId = parts[4];

        const user = await db.getUser(userId);
        if (!user) {
            const message = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Deduct amount from user balance immediately
        const currentBalance = user.balance_usd || 0;
        const newBalance = currentBalance - amount;
        await db.setUserUSDBalance(userId, newBalance);

        // Save withdrawal request
        const method = 'Binance';
        const details = `Binance ID: ${binanceId}`;
        const requestId = await db.addWithdrawalRequest(userId, amount, 'USD', method, details);

        // Notify admin
        const adminMessage = language === 'en' ?
            `💳 New Binance withdrawal request!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${userId}\n💰 Amount: $${amount.toFixed(2)}\n🟡 Binance ID: ${binanceId}\n💰 Current balance: $${(user.balance_usd || 0).toFixed(2)}\n📋 Request ID: #${requestId}` :
            `💳 طلب سحب Binance جديد!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${userId}\n💰 المبلغ: $${amount.toFixed(2)}\n🟡 معرف Binance: ${binanceId}\n💰 الرصيد الحالي: $${(user.balance_usd || 0).toFixed(2)}\n📋 رقم الطلب: #${requestId}`;

        bot.sendMessage(config.ADMIN_ID, adminMessage);

        const message = language === 'en' ?
            `✅ Binance withdrawal request confirmed!\n\n💰 Amount: $${amount.toFixed(2)}\n🟡 Binance ID: ${binanceId}\n📋 Request ID: #${requestId}\n\n⏳ Your request will be processed soon\n💡 You will be notified once completed` :
            `✅ تم تأكيد طلب سحب Binance!\n\n💰 المبلغ: $${amount.toFixed(2)}\n🟡 معرف Binance: ${binanceId}\n📋 رقم الطلب: #${requestId}\n\n⏳ سيتم معالجة طلبك قريباً\n💡 سيتم إشعارك عند الانتهاء`;

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error confirming Binance withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error confirming withdrawal' :
            '❌ حدث خطأ في تأكيد السحب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Bulk email management functions
async function exportAllEmails(chatId, language) {
    try {
        const pendingEmails = await db.getAllPendingEmails();
        const pendingGmails = await db.getPendingGmailAccounts();

        // Check if there are any pending emails
        if (pendingEmails.length === 0 && pendingGmails.length === 0) {
            const message = language === 'en' ? 
                '✅ No pending emails!\n\nAll emails have been reviewed.' : 
                '✅ لا توجد إيميلات معلقة!\n\nتمت مراجعة جميع الإيميلات.';
            return bot.sendMessage(chatId, message);
        }

        // Create file content
        let fileContent = '';
        
        // Header
        fileContent += language === 'en' ? 
            '========================================\n' +
            'PENDING EMAILS EXPORT\n' +
            'Only showing emails that have NOT been approved or rejected yet\n' +
            `Export Date: ${new Date().toLocaleString()}\n` +
            '========================================\n\n' :
            '========================================\n' +
            'تصدير الإيميلات المعلقة\n' +
            'يعرض فقط الإيميلات التي لم يتم قبولها أو رفضها بعد\n' +
            `تاريخ التصدير: ${new Date().toLocaleString('ar-EG')}\n` +
            '========================================\n\n';

        // Pending regular emails
        if (pendingEmails.length > 0) {
            fileContent += language === 'en' ? 
                '📧 PENDING REGULAR EMAILS:\n' +
                '----------------------------------------\n' :
                '📧 الإيميلات العادية المعلقة:\n' +
                '----------------------------------------\n';
            
            pendingEmails.forEach((email, index) => {
                fileContent += `${index + 1}. Email: ${email.email}\n`;
                fileContent += `   Password: ${email.password}\n`;
                if (email.user_id) {
                    fileContent += `   User ID: ${email.user_id}\n`;
                }
                if (email.created_at) {
                    fileContent += `   Created: ${email.created_at}\n`;
                }
                fileContent += '\n';
            });
            fileContent += '\n';
        }

        // Pending Gmail accounts
        if (pendingGmails.length > 0) {
            fileContent += language === 'en' ? 
                '📱 PENDING GMAIL ACCOUNTS:\n' +
                '----------------------------------------\n' :
                '📱 حسابات الجيميل المعلقة:\n' +
                '----------------------------------------\n';
            
            pendingGmails.forEach((gmail, index) => {
                fileContent += `${index + 1}. Email: ${gmail.email}\n`;
                if (gmail.user_id) {
                    fileContent += `   User ID: ${gmail.user_id}\n`;
                }
                if (gmail.created_at) {
                    fileContent += `   Created: ${gmail.created_at}\n`;
                }
                fileContent += '\n';
            });
            fileContent += '\n';
        }

        // Summary
        const total = pendingEmails.length + pendingGmails.length;
        fileContent += language === 'en' ?
            '========================================\n' +
            'SUMMARY:\n' +
            '========================================\n' +
            `Total Pending: ${total} emails\n` +
            `Regular Emails: ${pendingEmails.length}\n` +
            `Gmail Accounts: ${pendingGmails.length}\n\n` +
            '💡 Use bulk approve/reject to process them quickly!\n' :
            '========================================\n' +
            'الملخص:\n' +
            '========================================\n' +
            `إجمالي المعلق: ${total} إيميل\n` +
            `إيميلات عادية: ${pendingEmails.length}\n` +
            `حسابات جيميل: ${pendingGmails.length}\n\n` +
            '💡 استخدم القبول/الرفض الجماعي لمعالجتها بسرعة!\n';

        // Create filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const filename = `pending_emails_${timestamp}.txt`;

        // Write to file
        fs.writeFileSync(filename, fileContent, 'utf8');

        // Send file
        const caption = language === 'en' ?
            `📤 Pending Emails Export\n\n📊 Total: ${total} emails\n⏳ Regular: ${pendingEmails.length}\n📱 Gmail: ${pendingGmails.length}` :
            `📤 تصدير الإيميلات المعلقة\n\n📊 الإجمالي: ${total} إيميل\n⏳ عادية: ${pendingEmails.length}\n📱 جيميل: ${pendingGmails.length}`;

        await bot.sendDocument(chatId, filename, {
            caption: caption
        });

        // Delete file after sending
        fs.unlinkSync(filename);

        console.log(`Exported ${total} pending emails to ${filename}`);

    } catch (error) {
        console.error('Error exporting emails:', error);
        const errorMessage = language === 'en' ?
            '❌ Error exporting emails' :
            '❌ حدث خطأ في تصدير الإيميلات';
        bot.sendMessage(chatId, errorMessage);
    }
}

async function sendAndApproveEmails(chatId, userId, language) {
    try {
        const pendingGmails = await db.getPendingGmailAccounts();
        const pendingEmails = await db.getAllPendingEmails();

        if (pendingGmails.length === 0 && pendingEmails.length === 0) {
            const message = language === 'en' ?
                '📭 No pending emails to approve' :
                '📭 لا توجد إيميلات معلقة للقبول';
            return bot.sendMessage(chatId, message);
        }

        // Ask admin to send the emails to approve
        const instructionMessage = language === 'en' ?
            `✅ Selective Email Approval\n\n📝 Please send the emails you want to approve, one per line.\n\nExample:\nmrmostafa020@gmail.com\nmgdgdgdsf0@gmail.com\nuser@gmail.com\n\n💡 Only these specific emails will be approved.\n\n⏳ Waiting for your list...` :
            `✅ قبول إيميلات محددة\n\n📝 أرسل الإيميلات التي تريد قبولها، كل واحد في سطر.\n\nمثال:\nmrmostafa020@gmail.com\nmgdgdgdsf0@gmail.com\nuser@gmail.com\n\n💡 سيتم قبول هذه الإيميلات المحددة فقط.\n\n⏳ في انتظار قائمتك...`;

        // Set user state to wait for emails list
        userStates.set(userId, { 
            state: 'waiting_approve_emails',
            timestamp: Date.now()
        });

        const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
        bot.sendMessage(chatId, instructionMessage, cancelKeyboard);

    } catch (error) {
        console.error('Error in sendAndApproveEmails:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing approval' :
            '❌ حدث خطأ في معالجة القبول';
        bot.sendMessage(chatId, errorMessage);
    }
}

async function sendAndRejectEmails(chatId, userId, language) {
    try {
        const pendingGmails = await db.getPendingGmailAccounts();
        const pendingEmails = await db.getAllPendingEmails();

        if (pendingGmails.length === 0 && pendingEmails.length === 0) {
            const message = language === 'en' ?
                '📭 No pending emails to reject' :
                '📭 لا توجد إيميلات معلقة للرفض';
            return bot.sendMessage(chatId, message);
        }

        // Ask admin to send the emails to reject
        const instructionMessage = language === 'en' ?
            `❌ Selective Email Rejection\n\n📝 Please send the emails you want to reject, one per line.\n\nExample:\nmrmostafa020@gmail.com\nmgdgdgdsf0@gmail.com\nuser@gmail.com\n\n💡 Only these specific emails will be rejected.\n\n⏳ Waiting for your list...` :
            `❌ رفض إيميلات محددة\n\n📝 أرسل الإيميلات التي تريد رفضها، كل واحد في سطر.\n\nمثال:\nmrmostafa020@gmail.com\nmgdgdgdsf0@gmail.com\nuser@gmail.com\n\n💡 سيتم رفض هذه الإيميلات المحددة فقط.\n\n⏳ في انتظار قائمتك...`;

        // Set user state to wait for emails list
        userStates.set(userId, { 
            state: 'waiting_reject_emails',
            timestamp: Date.now()
        });

        const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
        bot.sendMessage(chatId, instructionMessage, cancelKeyboard);

    } catch (error) {
        console.error('Error in sendAndRejectEmails:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing rejection' :
            '❌ حدث خطأ في معالجة الرفض';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Process selective email approval
async function processSelectiveApproval(chatId, userId, text, language) {
    try {
        // Parse emails from text (one per line)
        const emailList = text.split('\n')
            .map(email => email.trim().toLowerCase())
            .filter(email => email.length > 0 && email.includes('@'));

        if (emailList.length === 0) {
            const message = language === 'en' ?
                '❌ No valid emails found\n\nPlease send emails, one per line.\n\nOr press Cancel to exit:' :
                '❌ لم يتم العثور على إيميلات صحيحة\n\nأرسل الإيميلات، كل واحد في سطر.\n\nأو اضغط إلغاء للخروج:';
            const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
            return bot.sendMessage(chatId, message, cancelKeyboard);
        }

        // Get all pending emails
        const pendingGmails = await db.getPendingGmailAccounts();
        const pendingEmails = await db.getAllPendingEmails();

        // Find matching emails
        const matchedGmails = pendingGmails.filter(gmail => 
            emailList.includes(gmail.email.toLowerCase())
        );
        const matchedEmails = pendingEmails.filter(email => 
            emailList.includes(email.email.toLowerCase())
        );

        const totalMatched = matchedGmails.length + matchedEmails.length;

        if (totalMatched === 0) {
            const message = language === 'en' ?
                `❌ No matching pending emails found\n\n📝 You sent ${emailList.length} emails, but none of them are in the pending list.\n\n💡 Make sure the emails are correct and pending review.` :
                `❌ لم يتم العثور على إيميلات معلقة مطابقة\n\n📝 أرسلت ${emailList.length} إيميل، لكن لا يوجد أي منها في قائمة المعلقة.\n\n💡 تأكد من أن الإيميلات صحيحة ومعلقة للمراجعة.`;
            userStates.delete(userId);
            const adminKeyboard = keyboards.getKeyboard('adminKeyboard', language);
            return bot.sendMessage(chatId, message, adminKeyboard);
        }

        // Show confirmation
        const confirmMessage = language === 'en' ?
            `✅ Found ${totalMatched} matching emails to approve:\n\n` +
            `📱 Gmail accounts: ${matchedGmails.length}\n` +
            `📧 Regular emails: ${matchedEmails.length}\n\n` +
            `This will:\n` +
            `✅ Mark these emails as approved\n` +
            `💰 Add rewards to users\n\n` +
            `Are you sure?` :
            `✅ تم العثور على ${totalMatched} إيميل مطابق للقبول:\n\n` +
            `📱 حسابات جيميل: ${matchedGmails.length}\n` +
            `📧 إيميلات عادية: ${matchedEmails.length}\n\n` +
            `هذا سوف:\n` +
            `✅ يضع علامة على هذه الإيميلات كمقبولة\n` +
            `💰 يضيف المكافآت للمستخدمين\n\n` +
            `هل أنت متأكد؟`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '✅ Yes, Approve' : '✅ نعم، قبول',
                            callback_data: `selective_approve_${matchedGmails.map(g => g.id).join(',')}_${matchedEmails.map(e => e.id).join(',')}`
                        },
                        {
                            text: language === 'en' ? '❌ Cancel' : '❌ إلغاء',
                            callback_data: 'selective_approve_cancel'
                        }
                    ]
                ]
            }
        };

        userStates.delete(userId);
        bot.sendMessage(chatId, confirmMessage, keyboard);

    } catch (error) {
        console.error('Error in processSelectiveApproval:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing approval' :
            '❌ حدث خطأ في معالجة القبول';
        userStates.delete(userId);
        bot.sendMessage(chatId, errorMessage);
    }
}

// Process selective email rejection
async function processSelectiveRejection(chatId, userId, text, language) {
    try {
        // Parse emails from text (one per line)
        const emailList = text.split('\n')
            .map(email => email.trim().toLowerCase())
            .filter(email => email.length > 0 && email.includes('@'));

        if (emailList.length === 0) {
            const message = language === 'en' ?
                '❌ No valid emails found\n\nPlease send emails, one per line.\n\nOr press Cancel to exit:' :
                '❌ لم يتم العثور على إيميلات صحيحة\n\nأرسل الإيميلات، كل واحد في سطر.\n\nأو اضغط إلغاء للخروج:';
            const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
            return bot.sendMessage(chatId, message, cancelKeyboard);
        }

        // Get all pending emails
        const pendingGmails = await db.getPendingGmailAccounts();
        const pendingEmails = await db.getAllPendingEmails();

        // Find matching emails
        const matchedGmails = pendingGmails.filter(gmail => 
            emailList.includes(gmail.email.toLowerCase())
        );
        const matchedEmails = pendingEmails.filter(email => 
            emailList.includes(email.email.toLowerCase())
        );

        const totalMatched = matchedGmails.length + matchedEmails.length;

        if (totalMatched === 0) {
            const message = language === 'en' ?
                `❌ No matching pending emails found\n\n📝 You sent ${emailList.length} emails, but none of them are in the pending list.\n\n💡 Make sure the emails are correct and pending review.` :
                `❌ لم يتم العثور على إيميلات معلقة مطابقة\n\n📝 أرسلت ${emailList.length} إيميل، لكن لا يوجد أي منها في قائمة المعلقة.\n\n💡 تأكد من أن الإيميلات صحيحة ومعلقة للمراجعة.`;
            userStates.delete(userId);
            const adminKeyboard = keyboards.getKeyboard('adminKeyboard', language);
            return bot.sendMessage(chatId, message, adminKeyboard);
        }

        // Show confirmation
        const confirmMessage = language === 'en' ?
            `❌ Found ${totalMatched} matching emails to reject:\n\n` +
            `📱 Gmail accounts: ${matchedGmails.length}\n` +
            `📧 Regular emails: ${matchedEmails.length}\n\n` +
            `This will:\n` +
            `❌ Mark these emails as rejected\n` +
            `📧 Notify users about rejection\n\n` +
            `Are you sure?` :
            `❌ تم العثور على ${totalMatched} إيميل مطابق للرفض:\n\n` +
            `📱 حسابات جيميل: ${matchedGmails.length}\n` +
            `📧 إيميلات عادية: ${matchedEmails.length}\n\n` +
            `هذا سوف:\n` +
            `❌ يضع علامة على هذه الإيميلات كمرفوضة\n` +
            `📧 يخطر المستخدمين بالرفض\n\n` +
            `هل أنت متأكد؟`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: language === 'en' ? '❌ Yes, Reject' : '❌ نعم، رفض',
                            callback_data: `selective_reject_${matchedGmails.map(g => g.id).join(',')}_${matchedEmails.map(e => e.id).join(',')}`
                        },
                        {
                            text: language === 'en' ? '🔙 Cancel' : '🔙 إلغاء',
                            callback_data: 'selective_reject_cancel'
                        }
                    ]
                ]
            }
        };

        userStates.delete(userId);
        bot.sendMessage(chatId, confirmMessage, keyboard);

    } catch (error) {
        console.error('Error in processSelectiveRejection:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing rejection' :
            '❌ حدث خطأ في معالجة الرفض';
        userStates.delete(userId);
        bot.sendMessage(chatId, errorMessage);
    }
}

async function processBulkApproval(chatId, messageId, language) {
    try {
        const pendingGmails = await db.getPendingGmailAccounts();
        
        if (pendingGmails.length === 0) {
            const message = language === 'en' ?
                '📭 No pending emails found' :
                '📭 لا توجد إيميلات معلقة';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Update status message
        const processingMessage = language === 'en' ?
            `⏳ Processing ${pendingGmails.length} emails...\n\nPlease wait...` :
            `⏳ جاري معالجة ${pendingGmails.length} إيميل...\n\nالرجاء الانتظار...`;
        
        await bot.editMessageText(processingMessage, {
            chat_id: chatId,
            message_id: messageId
        });

        let successCount = 0;
        let errorCount = 0;

        // Process each email
        for (const gmail of pendingGmails) {
            try {
                // Update status to approved
                await db.updateGmailAccountStatus(gmail.id, 'approved');

                // Get user and add reward
                const user = await db.getUser(gmail.user_id);
                if (user) {
                    const gmailReward = parseFloat(await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD);
                    const currency = user.preferred_currency || 'EGP';

                    if (currency === 'USD') {
                        const usdReward = await convertEGPToUSD(gmailReward);
                        const newBalance = (parseFloat(user.balance_usd) || 0) + usdReward;
                        await db.setUserUSDBalance(gmail.user_id, newBalance);
                    } else {
                        const newBalance = (parseFloat(user.balance) || 0) + gmailReward;
                        await db.setUserBalance(gmail.user_id, newBalance);
                    }

                    // Process referral reward
                    await processReferralReward(gmail.user_id);

                    // Notify user
                    const userLanguage = await getUserLanguage(gmail.user_id);
                    const approvalMessage = getMessage('USER_APPROVED', userLanguage);
                    await safeSendMessage(gmail.user_id, approvalMessage);
                }

                successCount++;
            } catch (error) {
                console.error(`Error approving email ${gmail.id}:`, error);
                errorCount++;
            }
        }

        // Send final report
        const reportMessage = language === 'en' ?
            `✅ Bulk Approval Complete!\n\n📊 Results:\n✅ Approved: ${successCount}\n❌ Errors: ${errorCount}\n📧 Total: ${pendingGmails.length}` :
            `✅ اكتمل القبول الجماعي!\n\n📊 النتائج:\n✅ مقبول: ${successCount}\n❌ أخطاء: ${errorCount}\n📧 الإجمالي: ${pendingGmails.length}`;

        bot.editMessageText(reportMessage, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error in processBulkApproval:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing bulk approval' :
            '❌ حدث خطأ في معالجة القبول الجماعي';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Process selective approval confirmation
async function processSelectiveApprovalConfirm(chatId, messageId, data, language) {
    try {
        // Parse IDs from callback data
        const parts = data.replace('selective_approve_', '').split('_');
        const gmailIds = parts[0] ? parts[0].split(',').filter(id => id).map(id => parseInt(id)) : [];
        const emailIds = parts[1] ? parts[1].split(',').filter(id => id).map(id => parseInt(id)) : [];

        const total = gmailIds.length + emailIds.length;

        // Update status message
        const processingMessage = language === 'en' ?
            `⏳ Processing ${total} emails...\n\nPlease wait...` :
            `⏳ جاري معالجة ${total} إيميل...\n\nالرجاء الانتظار...`;
        
        await bot.editMessageText(processingMessage, {
            chat_id: chatId,
            message_id: messageId
        });

        let successCount = 0;
        let errorCount = 0;

        // Process Gmail accounts
        for (const gmailId of gmailIds) {
            try {
                const gmail = await db.getGmailAccountById(gmailId);
                if (!gmail) continue;

                await db.updateGmailAccountStatus(gmailId, 'approved');

                const user = await db.getUser(gmail.user_id);
                if (user) {
                    const gmailReward = parseFloat(await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD);
                    const currency = user.preferred_currency || 'EGP';

                    if (currency === 'USD') {
                        const usdReward = await convertEGPToUSD(gmailReward);
                        const newBalance = (parseFloat(user.balance_usd) || 0) + usdReward;
                        await db.setUserUSDBalance(gmail.user_id, newBalance);
                    } else {
                        const newBalance = (parseFloat(user.balance) || 0) + gmailReward;
                        await db.setUserBalance(gmail.user_id, newBalance);
                    }

                    await processReferralReward(gmail.user_id);

                    const userLanguage = await getUserLanguage(gmail.user_id);
                    const approvalMessage = getMessage('USER_APPROVED', userLanguage);
                    await safeSendMessage(gmail.user_id, approvalMessage);
                }

                successCount++;
            } catch (error) {
                console.error(`Error approving Gmail ${gmailId}:`, error);
                errorCount++;
            }
        }

        // Process regular emails (similar logic)
        for (const emailId of emailIds) {
            try {
                const email = await db.getPendingAccountById(emailId);
                if (!email) continue;

                await db.removePendingAccount(emailId);

                const user = await db.getUser(email.user_id);
                if (user) {
                    const emailReward = parseFloat(await db.getSetting('task_reward') || config.TASK_REWARD);
                    const currency = user.preferred_currency || 'EGP';

                    if (currency === 'USD') {
                        const usdReward = await convertEGPToUSD(emailReward);
                        const newBalance = (parseFloat(user.balance_usd) || 0) + usdReward;
                        await db.setUserUSDBalance(email.user_id, newBalance);
                    } else {
                        const newBalance = (parseFloat(user.balance) || 0) + emailReward;
                        await db.setUserBalance(email.user_id, newBalance);
                    }

                    await processReferralReward(email.user_id);

                    const userLanguage = await getUserLanguage(email.user_id);
                    const approvalMessage = getMessage('USER_APPROVED', userLanguage);
                    await safeSendMessage(email.user_id, approvalMessage);
                }

                successCount++;
            } catch (error) {
                console.error(`Error approving email ${emailId}:`, error);
                errorCount++;
            }
        }

        // Send final report
        const reportMessage = language === 'en' ?
            `✅ Selective Approval Complete!\n\n📊 Results:\n✅ Approved: ${successCount}\n❌ Errors: ${errorCount}\n📧 Total: ${total}` :
            `✅ اكتمل القبول الانتقائي!\n\n📊 النتائج:\n✅ مقبول: ${successCount}\n❌ أخطاء: ${errorCount}\n📧 الإجمالي: ${total}`;

        bot.editMessageText(reportMessage, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error in processSelectiveApprovalConfirm:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing selective approval' :
            '❌ حدث خطأ في معالجة القبول الانتقائي';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Process selective rejection confirmation
async function processSelectiveRejectionConfirm(chatId, messageId, data, language) {
    try {
        // Parse IDs from callback data
        const parts = data.replace('selective_reject_', '').split('_');
        const gmailIds = parts[0] ? parts[0].split(',').filter(id => id).map(id => parseInt(id)) : [];
        const emailIds = parts[1] ? parts[1].split(',').filter(id => id).map(id => parseInt(id)) : [];

        const total = gmailIds.length + emailIds.length;

        // Update status message
        const processingMessage = language === 'en' ?
            `⏳ Processing ${total} emails...\n\nPlease wait...` :
            `⏳ جاري معالجة ${total} إيميل...\n\nالرجاء الانتظار...`;
        
        await bot.editMessageText(processingMessage, {
            chat_id: chatId,
            message_id: messageId
        });

        let successCount = 0;
        let errorCount = 0;

        // Process Gmail accounts
        for (const gmailId of gmailIds) {
            try {
                const gmail = await db.getGmailAccountById(gmailId);
                if (!gmail) continue;

                await db.updateGmailAccountStatus(gmailId, 'rejected');

                const userLanguage = await getUserLanguage(gmail.user_id);
                const rejectionMessage = getMessage('USER_REJECTED', userLanguage);
                await safeSendMessage(gmail.user_id, rejectionMessage);

                successCount++;
            } catch (error) {
                console.error(`Error rejecting Gmail ${gmailId}:`, error);
                errorCount++;
            }
        }

        // Process regular emails
        for (const emailId of emailIds) {
            try {
                const email = await db.getPendingAccountById(emailId);
                if (!email) continue;

                await db.removePendingAccount(emailId);

                const userLanguage = await getUserLanguage(email.user_id);
                const rejectionMessage = getMessage('USER_REJECTED', userLanguage);
                await safeSendMessage(email.user_id, rejectionMessage);

                successCount++;
            } catch (error) {
                console.error(`Error rejecting email ${emailId}:`, error);
                errorCount++;
            }
        }

        // Send final report
        const reportMessage = language === 'en' ?
            `❌ Selective Rejection Complete!\n\n📊 Results:\n❌ Rejected: ${successCount}\n⚠️ Errors: ${errorCount}\n📧 Total: ${total}` :
            `❌ اكتمل الرفض الانتقائي!\n\n📊 النتائج:\n❌ مرفوض: ${successCount}\n⚠️ أخطاء: ${errorCount}\n📧 الإجمالي: ${total}`;

        bot.editMessageText(reportMessage, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error in processSelectiveRejectionConfirm:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing selective rejection' :
            '❌ حدث خطأ في معالجة الرفض الانتقائي';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

async function processBulkRejection(chatId, messageId, language) {
    try {
        const pendingGmails = await db.getPendingGmailAccounts();
        
        if (pendingGmails.length === 0) {
            const message = language === 'en' ?
                '📭 No pending emails found' :
                '📭 لا توجد إيميلات معلقة';
            return bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Update status message
        const processingMessage = language === 'en' ?
            `⏳ Processing ${pendingGmails.length} emails...\n\nPlease wait...` :
            `⏳ جاري معالجة ${pendingGmails.length} إيميل...\n\nالرجاء الانتظار...`;
        
        await bot.editMessageText(processingMessage, {
            chat_id: chatId,
            message_id: messageId
        });

        let successCount = 0;
        let errorCount = 0;

        // Process each email
        for (const gmail of pendingGmails) {
            try {
                // Update status to rejected
                await db.updateGmailAccountStatus(gmail.id, 'rejected');

                // Notify user
                const userLanguage = await getUserLanguage(gmail.user_id);
                const rejectionMessage = getMessage('USER_REJECTED', userLanguage);
                await safeSendMessage(gmail.user_id, rejectionMessage);

                successCount++;
            } catch (error) {
                console.error(`Error rejecting email ${gmail.id}:`, error);
                errorCount++;
            }
        }

        // Send final report
        const reportMessage = language === 'en' ?
            `❌ Bulk Rejection Complete!\n\n📊 Results:\n❌ Rejected: ${successCount}\n⚠️ Errors: ${errorCount}\n📧 Total: ${pendingGmails.length}` :
            `❌ اكتمل الرفض الجماعي!\n\n📊 النتائج:\n❌ مرفوض: ${successCount}\n⚠️ أخطاء: ${errorCount}\n📧 الإجمالي: ${pendingGmails.length}`;

        bot.editMessageText(reportMessage, {
            chat_id: chatId,
            message_id: messageId
        });

    } catch (error) {
        console.error('Error in processBulkRejection:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing bulk rejection' :
            '❌ حدث خطأ في معالجة الرفض الجماعي';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Safe bot startup function
async function startBotSafely() {
    try {
        console.log('🚀 Starting Multilingual Telegram Bot...');

        // Verify bot token first
        const botInfo = await bot.getMe();
        console.log(`✅ Bot verified: @${botInfo.username}`);

        // Clear any existing webhooks
        await bot.deleteWebHook();
        console.log('🧹 Cleared existing webhooks');

        // Start polling with retry logic
        await bot.startPolling();
        console.log('🤖 بوت تليجرام بدأ بنجاح!');
        console.log('🇪🇬 اللغة: العربية فقط');
        console.log('💰 العملة: الجنيه المصري فقط');
        console.log('📡 البوت يستمع للرسائل الآن...');

    } catch (error) {
        console.error('❌ Failed to start bot:', error.message);

        if (error.message.includes('401')) {
            console.error('🔑 Invalid bot token. Please check your BOT_TOKEN in config.js');
        } else if (error.message.includes('timeout')) {
            console.error('🌐 Network timeout. Please check your internet connection');
        } else {
            console.error('💡 Please check your configuration and try again');
        }

        process.exit(1);
    }
}

// Start the bot
startBotSafely();

// Admin functions

// Show statistics
async function showStatistics(chatId, language) {
    try {
        const userCount = await db.getUserCount();
        const totalBalance = await db.getTotalBalance();

        const message = language === 'en' ?
            `📊 Bot Statistics:\n\n👥 Total Users: ${userCount}\n💰 Total Balance: ${formatBalance(totalBalance, 'EGP')}\n\n📅 Generated on: ${new Date().toLocaleString()}` :
            `📊 إحصائيات البوت:\n\n👥 إجمالي المستخدمين: ${userCount}\n💰 إجمالي الأرصدة: ${formatBalance(totalBalance, 'EGP')}\n\n📅 تم الإنشاء في: ${new Date().toLocaleString()}`;

        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error showing statistics:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading statistics' :
            '❌ حدث خطأ في تحميل الإحصائيات';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Show pending accounts for review
async function showPendingAccounts(chatId, language, page = 1) {
    try {
        const accounts = await db.getPendingAccounts();
        if (accounts.length === 0) {
            const message = language === 'en' ?
                '📧 No pending accounts for review\n\n💡 Completed accounts will appear here for your approval' :
                '📧 لا توجد يوزرات معلقة للمراجعة\n\n💡 ستظهر هنا اليوزرات المكتملة لموافقتك';
            return bot.sendMessage(chatId, message);
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(accounts.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, accounts.length);
        const pageAccounts = accounts.slice(startIndex, endIndex);

        const headerMessage = language === 'en' ?
            `📧 Pending Email Accounts (${startIndex + 1}-${endIndex} of ${accounts.length})\n📄 Page ${page}/${totalPages}` :
            `📧 اليوزرات المعلقة (${startIndex + 1}-${endIndex} من ${accounts.length})\n📄 صفحة ${page}/${totalPages}`;

        bot.sendMessage(chatId, headerMessage);

        // Send each account with approve/reject buttons
        for (const account of pageAccounts) {
            const user = await db.getUser(account.user_id);
            const username = user ? (user.username || 'غير محدد') : 'غير محدد';

            const message = language === 'en' ?
                `📧 Email Account:\n\n📧 Email: ${account.email}\n🔑 Password: ${account.password}\n👤 User: ${username}\n🆔 User ID: ${account.user_id}\n📅 Date: ${new Date(account.created_at).toLocaleString()}` :
                `📧 حساب إيميل:\n\n📧 الإيميل: ${account.email}\n🔑 كلمة المرور: ${account.password}\n👤 المستخدم: ${username}\n🆔 آيدي المستخدم: ${account.user_id}\n📅 التاريخ: ${new Date(account.created_at).toLocaleString()}`;

            const inlineKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: language === 'en' ? '✅ Approve' : '✅ قبول',
                                callback_data: `approve_email_${account.id}`
                            },
                            {
                                text: language === 'en' ? '❌ Reject' : '❌ رفض',
                                callback_data: `reject_email_${account.id}`
                            }
                        ]
                    ]
                }
            };

            bot.sendMessage(chatId, message, inlineKeyboard);
        }

        // Add pagination buttons if there are multiple pages
        if (totalPages > 1) {
            const paginationButtons = [];
            
            if (page > 1) {
                paginationButtons.push({
                    text: language === 'en' ? '⬅️ Previous' : '⬅️ السابق',
                    callback_data: `email_page_${page - 1}`
                });
            }
            
            if (page < totalPages) {
                paginationButtons.push({
                    text: language === 'en' ? 'Next ➡️' : 'التالي ➡️',
                    callback_data: `email_page_${page + 1}`
                });
            }

            if (paginationButtons.length > 0) {
                const paginationKeyboard = {
                    reply_markup: {
                        inline_keyboard: [paginationButtons]
                    }
                };

                const paginationMessage = language === 'en' ?
                    `📄 Page ${page} of ${totalPages} • ${accounts.length} total accounts` :
                    `📄 صفحة ${page} من ${totalPages} • ${accounts.length} حساب إجمالي`;

                bot.sendMessage(chatId, paginationMessage, paginationKeyboard);
            }
        }
    } catch (error) {
        console.error('Error showing pending accounts:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading pending accounts' :
            '❌ حدث خطأ في تحميل اليوزرات المعلقة';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Show pending Gmail accounts
async function showPendingGmailAccounts(chatId, language, page = 1) {
    try {
        const accounts = await db.getPendingGmailAccounts();
        if (accounts.length === 0) {
            const message = language === 'en' ?
                '📱 No pending Gmail accounts for review\n\n💡 Created Gmail accounts will appear here for your approval' :
                '📱 لا توجد حسابات جيميل معلقة للمراجعة\n\n💡 ستظهر هنا الجيميلات التي ينشئها المستخدمون وتحتاج موافقتك';
            return bot.sendMessage(chatId, message);
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(accounts.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, accounts.length);
        const pageAccounts = accounts.slice(startIndex, endIndex);

        const headerMessage = language === 'en' ?
            `📱 Pending Gmail Accounts (${startIndex + 1}-${endIndex} of ${accounts.length})\n📄 Page ${page}/${totalPages}` :
            `📱 حسابات الجيميل المعلقة (${startIndex + 1}-${endIndex} من ${accounts.length})\n📄 صفحة ${page}/${totalPages}`;

        bot.sendMessage(chatId, headerMessage);

        // Send each account with approve/reject buttons
        for (const account of pageAccounts) {
            const user = await db.getUser(account.user_id);
            const username = user ? (user.username || 'غير محدد') : 'غير محدد';

            const message = language === 'en' ?
                `📱 Gmail Account:\n\n📧 Email: ${account.email}\n👤 User: ${username}\n🆔 User ID: ${account.user_id}\n📅 Date: ${new Date(account.created_at).toLocaleString()}` :
                `📱 حساب جيميل:\n\n📧 الإيميل: ${account.email}\n👤 المستخدم: ${username}\n🆔 آيدي المستخدم: ${account.user_id}\n📅 التاريخ: ${new Date(account.created_at).toLocaleString()}`;

            const inlineKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: language === 'en' ? '✅ Approve' : '✅ قبول',
                                callback_data: `approve_gmail_${account.id}`
                            },
                            {
                                text: language === 'en' ? '❌ Reject' : '❌ رفض',
                                callback_data: `reject_gmail_${account.id}`
                            }
                        ]
                    ]
                }
            };

            bot.sendMessage(chatId, message, inlineKeyboard);
        }

        // Add pagination buttons if there are multiple pages
        if (totalPages > 1) {
            const paginationButtons = [];
            
            if (page > 1) {
                paginationButtons.push({
                    text: language === 'en' ? '⬅️ Previous' : '⬅️ السابق',
                    callback_data: `gmail_page_${page - 1}`
                });
            }
            
            if (page < totalPages) {
                paginationButtons.push({
                    text: language === 'en' ? 'Next ➡️' : 'التالي ➡️',
                    callback_data: `gmail_page_${page + 1}`
                });
            }

            if (paginationButtons.length > 0) {
                const paginationKeyboard = {
                    reply_markup: {
                        inline_keyboard: [paginationButtons]
                    }
                };

                const paginationMessage = language === 'en' ?
                    `📄 Page ${page} of ${totalPages} • ${accounts.length} total accounts` :
                    `📄 صفحة ${page} من ${totalPages} • ${accounts.length} حساب إجمالي`;

                bot.sendMessage(chatId, paginationMessage, paginationKeyboard);
            }
        }
    } catch (error) {
        console.error('Error showing pending Gmail accounts:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading pending Gmail accounts' :
            '❌ حدث خطأ في تحميل حسابات الجيميل المعلقة';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Show pending withdrawal requests
async function showPendingWithdrawalRequests(chatId, language) {
    try {
        const requests = await db.getPendingWithdrawalRequests();
        if (requests.length === 0) {
            const message = language === 'en' ?
                '💳 No pending withdrawal requests\n\n💡 User withdrawal requests will appear here for your review' :
                '💳 لا توجد طلبات سحب معلقة\n\n💡 ستظهر هنا طلبات السحب من المستخدمين للمراجعة';
            return bot.sendMessage(chatId, message);
        }

        // Send each request as a separate message with payment button
        for (let i = 0; i < Math.min(requests.length, 10); i++) {
            const request = requests[i];
            const user = await db.getUser(request.user_id);

            const message = language === 'en' ?
                `💳 Withdrawal Request #${request.id}\n\n👤 User: ${user?.username || 'Unknown'}\n🆔 User ID: \`${request.user_id}\`\n💰 Amount: ${formatBalance(request.amount, request.currency)}\n💳 Method: ${request.method}\n📋 Details: ${request.details}\n📅 Date: ${new Date(request.created_at).toLocaleString()}\n\n⏳ Status: Pending` :
                `💳 طلب سحب رقم #${request.id}\n\n👤 المستخدم: ${user?.username || 'غير محدد'}\n🆔 آيدي المستخدم: \`${request.user_id}\`\n💰 المبلغ: ${formatBalance(request.amount, request.currency)}\n💳 الطريقة: ${request.method}\n📋 التفاصيل: ${request.details}\n📅 التاريخ: ${new Date(request.created_at).toLocaleString()}\n\n⏳ الحالة: معلق`;

            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: language === 'en' ? '✅ Payment Completed' : '✅ تم الدفع',
                                callback_data: `complete_withdrawal_${request.id}`
                            }
                        ]
                    ]
                }
            };

            bot.sendMessage(chatId, message, {
                reply_markup: keyboard.reply_markup
            });
        }

        if (requests.length > 10) {
            const moreMessage = language === 'en' ?
                `\n📊 Showing first 10 requests out of ${requests.length} total` :
                `\n📊 عرض أول 10 طلبات من إجمالي ${requests.length} طلب`;
            bot.sendMessage(chatId, moreMessage);
        }

    } catch (error) {
        console.error('Error showing withdrawal requests:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading withdrawal requests' :
            '❌ حدث خطأ في تحميل طلبات السحب';
        bot.sendMessage(chatId, errorMessage);
    }
}


// Show last users
async function showLastUsers(chatId, language) {
    try {
        const users = await db.getLastUsers(10);
        if (users.length === 0) {
            const message = language === 'en' ?
                '👥 No users found' :
                '👥 لا يوجد مستخدمون';
            return bot.sendMessage(chatId, message);
        }

        const headerMessage = language === 'en' ?
            '👥 Last 10 Users:' :
            '👥 آخر 10 مستخدمين:';

        bot.sendMessage(chatId, headerMessage);

        // Send each user with control buttons
        for (const user of users) {
            const status = user.is_banned ? (language === 'en' ? '🚫 Banned' : '🚫 محظور') : (language === 'en' ? '✅ Active' : '✅ نشط');
            const currency = user.preferred_currency || 'EGP';
            const balance = currency === 'USD' ? user.balance_usd || 0 : user.balance || 0;

            const message = language === 'en' ?
                `👤 User Information:\n\n📝 Username: ${user.username || 'Unknown'}\n🆔 ID: ${user.id}\n💰 Balance: ${formatBalance(balance, currency)}\n💱 Currency: ${currency}\n🌍 Language: ${user.preferred_language || 'ar'}\n📊 Status: ${status}\n📅 Joined: ${new Date(user.created_at).toLocaleDateString()}\n⏰ Last Active: ${new Date(user.last_active || user.created_at).toLocaleDateString()}` :
                `👤 معلومات المستخدم:\n\n📝 اليوزر نيم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${user.id}\n💰 الرصيد: ${formatBalance(balance, currency)}\n💱 العملة: ${currency}\n🌍 اللغة: ${user.preferred_language || 'ar'}\n📊 الحالة: ${status}\n📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleDateString()}\n⏰ آخر نشاط: ${new Date(user.last_active || user.created_at).toLocaleDateString()}`;

            // Create control buttons for each user
            const inlineKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: `📋 ${language === 'en' ? 'Copy ID' : 'نسخ الآيدي'}`,
                                callback_data: `copy_id_${user.id}`
                            }
                        ],
                        [
                            {
                                text: user.is_banned ?
                                    (language === 'en' ? '✅ Unban' : '✅ إلغاء الحظر') :
                                    (language === 'en' ? '🚫 Ban' : '🚫 حظر'),
                                callback_data: user.is_banned ? `unban_user_${user.id}` : `ban_user_${user.id}`
                            },
                            {
                                text: language === 'en' ? '💰 Edit Balance' : '💰 تعديل الرصيد',
                                callback_data: `edit_balance_${user.id}`
                            }
                        ],
                        [
                            {
                                text: language === 'en' ? '📨 Send Message' : '📨 إرسال رسالة',
                                callback_data: `message_user_${user.id}`
                            },
                            {
                                text: language === 'en' ? '📊 Full Details' : '📊 التفاصيل الكاملة',
                                callback_data: `user_details_${user.id}`
                            }
                        ]
                    ]
                }
            };

            bot.sendMessage(chatId, message, inlineKeyboard);
        }
    } catch (error) {
        console.error('Error showing last users:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading users' :
            '❌ حدث خطأ في تحميل المستخدمين';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Search and show user
async function searchAndShowUser(chatId, searchTerm, language) {
    try {
        const trimmedSearch = searchTerm.trim();
        
        // Check if search term is numeric (likely an ID)
        const isNumeric = /^\d+$/.test(trimmedSearch);
        
        if (isNumeric) {
            // Search by ID only
            const user = await db.getUser(trimmedSearch);
            if (!user) {
                const message = language === 'en' ?
                    `❌ User with ID "${trimmedSearch}" not found` :
                    `❌ لم يتم العثور على مستخدم بالآيدي "${trimmedSearch}"`;
                return bot.sendMessage(chatId, message);
            }
            await displayUserInfo(chatId, user, language);
        } else {
            // Search by username - show multiple results if found
            const users = await db.searchUsers(trimmedSearch, 5);
            if (users.length === 0) {
                const message = language === 'en' ?
                    `❌ No users found with username containing "${trimmedSearch}"\n\n💡 Search tips:\n• Use exact User ID (numbers)\n• Use username (partial match works)\n• Example: "john" will find "john123"` :
                    `❌ لم يتم العثور على مستخدمين باليوزر نيم "${trimmedSearch}"\n\n💡 نصائح البحث:\n• استخدم الآيدي الدقيق (أرقام)\n• استخدم اليوزر نيم (البحث الجزئي يعمل)\n• مثال: "أحمد" سيجد "أحمد123"`;
                return bot.sendMessage(chatId, message);
            }
            
            if (users.length === 1) {
                // Only one result, show it directly
                await displayUserInfo(chatId, users[0], language);
            } else {
                // Multiple results, show list for selection
                await displayMultipleUsers(chatId, users, trimmedSearch, language);
            }
        }
    } catch (error) {
        console.error('Error searching user:', error);
        const errorMessage = language === 'en' ?
            '❌ Error searching for user' :
            '❌ حدث خطأ في البحث عن المستخدم';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Display single user information
async function displayUserInfo(chatId, user, language) {
    const status = user.is_banned ? (language === 'en' ? '🚫 Banned' : '🚫 محظور') : (language === 'en' ? '✅ Active' : '✅ نشط');
    const currency = user.preferred_currency || 'EGP';
    const balance = currency === 'USD' ? user.balance_usd || 0 : user.balance || 0;

    const message = language === 'en' ?
        `👤 User Information:\n\n📝 Username: ${user.username || 'Unknown'}\n🆔 ID: ${user.id}\n💰 Balance: ${formatBalance(balance, currency)}\n💱 Currency: ${currency}\n🌍 Language: ${user.preferred_language || 'ar'}\n📊 Status: ${status}\n📅 Joined: ${new Date(user.created_at).toLocaleString()}\n⏰ Last Active: ${new Date(user.last_active || user.created_at).toLocaleString()}` :
        `👤 معلومات المستخدم:\n\n📝 اليوزر نيم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${user.id}\n💰 الرصيد: ${formatBalance(balance, currency)}\n💱 العملة: ${currency}\n🌍 اللغة: ${user.preferred_language || 'ar'}\n📊 الحالة: ${status}\n📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleString()}\n⏰ آخر نشاط: ${new Date(user.last_active || user.created_at).toLocaleString()}`;

    // Create control buttons for the user
    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: `📋 ${language === 'en' ? 'Copy ID' : 'نسخ الآيدي'}`,
                        callback_data: `copy_id_${user.id}`
                    }
                ],
                [
                    {
                        text: user.is_banned ?
                            (language === 'en' ? '✅ Unban' : '✅ إلغاء الحظر') :
                            (language === 'en' ? '🚫 Ban' : '🚫 حظر'),
                        callback_data: user.is_banned ? `unban_user_${user.id}` : `ban_user_${user.id}`
                    },
                    {
                        text: `💰 ${language === 'en' ? 'Edit Balance' : 'تعديل الرصيد'}`,
                        callback_data: `edit_balance_${user.id}`
                    }
                ],
                [
                    {
                        text: `📨 ${language === 'en' ? 'Send Message' : 'إرسال رسالة'}`,
                        callback_data: `message_user_${user.id}`
                    },
                    {
                        text: `🔄 ${language === 'en' ? 'Refresh' : 'تحديث'}`,
                        callback_data: `refresh_user_${user.id}`
                    }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, message, inlineKeyboard);
}

// Display multiple users for selection
async function displayMultipleUsers(chatId, users, searchTerm, language) {
    const headerMessage = language === 'en' ?
        `🔍 Found ${users.length} users matching "${searchTerm}":\n\nClick on a user to view details:` :
        `🔍 تم العثور على ${users.length} مستخدمين يطابقون "${searchTerm}":\n\nاضغط على مستخدم لعرض التفاصيل:`;

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: users.map(user => [
                {
                    text: `👤 ${user.username || 'غير محدد'} (${user.id})`,
                    callback_data: `user_details_${user.id}`
                }
            ])
        }
    };

    bot.sendMessage(chatId, headerMessage, inlineKeyboard);
}

// Send broadcast message
async function sendBroadcastMessage(chatId, messageText, language) {
    try {
        const users = await db.getLastUsers(1000); // Get all users (limit 1000 for safety)
        let sentCount = 0;
        let failedCount = 0;

        const statusMessage = language === 'en' ?
            '📢 Sending broadcast message...' :
            '📢 جاري إرسال الرسالة الجماعية...';
        bot.sendMessage(chatId, statusMessage);

        for (const user of users) {
            try {
                // Note: For broadcast messages, we send the same message to all users
                // If you want language-specific broadcasts, you would need to:
                // 1. Create separate Arabic and English versions of the message
                // 2. Get each user's language and send appropriate version
                // For now, sending the admin's message as-is to all users
                const result = await safeSendMessage(user.id, messageText);
                if (result === null) {
                    // Message failed to send (user blocked bot, etc.)
                    failedCount++;
                } else {
                    sentCount++;
                }
                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                failedCount++;
                console.error(`Failed to send message to user ${user.id}:`, error.message);
            }
        }

        const resultMessage = language === 'en' ?
            `✅ Broadcast completed!\n\n📊 Results:\n✅ Sent: ${sentCount}\n❌ Failed: ${failedCount}\n📝 Message: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"` :
            `✅ تم إرسال الرسالة الجماعية!\n\n📊 النتائج:\n✅ تم الإرسال: ${sentCount}\n❌ فشل: ${failedCount}\n📝 الرسالة: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`;

        bot.sendMessage(chatId, resultMessage);
    } catch (error) {
        console.error('Error sending broadcast message:', error);
        const errorMessage = language === 'en' ?
            '❌ Error sending broadcast message' :
            '❌ حدث خطأ في إرسال الرسالة الجماعية';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Send private message
async function sendPrivateMessage(chatId, targetUserId, messageText, language) {
    try {
        await safeSendMessage(targetUserId, messageText);
        const successMessage = language === 'en' ?
            `✅ Message sent successfully to user ${targetUserId}` :
            `✅ تم إرسال الرسالة بنجاح للمستخدم ${targetUserId}`;
        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error sending private message:', error);
        const errorMessage = language === 'en' ?
            `❌ Failed to send message to user ${targetUserId}` :
            `❌ فشل في إرسال الرسالة للمستخدم ${targetUserId}`;
        bot.sendMessage(chatId, errorMessage);
    }
}

// Add accounts
async function addAccounts(chatId, accountsText, language) {
    try {
        const lines = accountsText.split('\n').filter(line => line.trim());
        let addedCount = 0;
        let failedCount = 0;

        for (const line of lines) {
            const parts = line.trim().split(':');
            if (parts.length >= 2) {
                const email = parts[0].trim();
                const password = parts[1].trim();
                const firstName = parts.length > 2 ? parts[2].trim() : null;
                const lastName = parts.length > 3 ? parts[3].trim() : null;

                try {
                    await db.addAvailableAccount(email, password, firstName, lastName);
                    addedCount++;
                } catch (error) {
                    failedCount++;
                    console.error(`Failed to add account ${email}:`, error.message);
                }
            } else {
                failedCount++;
            }
        }

        const resultMessage = language === 'en' ?
            `✅ Accounts processing completed!\n\n📊 Results:\n✅ Added/Updated: ${addedCount}\n❌ Failed: ${failedCount}\n\n💡 Duplicate accounts were updated with new data\n💡 Failed accounts may have invalid format\n\n📝 Supported formats:\n• email:password\n• email:password:firstname:lastname` :
            `✅ تم معالجة اليوزرات!\n\n📊 النتائج:\n✅ تم الإضافة/التحديث: ${addedCount}\n❌ فشل: ${failedCount}\n\n💡 اليوزرات المكررة تم تحديث بياناتها\n💡 اليوزرات الفاشلة قد تكون بتنسيق خاطئ\n\n📝 التنسيقات المدعومة:\n• email:password\n• email:password:firstname:lastname`;

        bot.sendMessage(chatId, resultMessage);

        // Notify all users about new accounts if any were added successfully
        if (addedCount > 0) {
            const notificationsEnabled = await db.getSetting('notify_users_new_accounts') !== 'false';
            if (notificationsEnabled) {
                await notifyUsersAboutNewAccounts(addedCount);
            }
        }
    } catch (error) {
        console.error('Error adding accounts:', error);
        const errorMessage = language === 'en' ?
            '❌ Error adding accounts' :
            '❌ حدث خطأ في إضافة اليوزرات';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Notify all users about new accounts
async function notifyUsersAboutNewAccounts(addedCount) {
    try {
        console.log(`📢 Notifying users about ${addedCount} new accounts...`);
        
        const users = await db.getLastUsers(1000); // Get all users (limit 1000 for safety)
        let notifiedCount = 0;
        let failedCount = 0;

        for (const user of users) {
            try {
                // Get user's preferred language
                const userLanguage = await getUserLanguage(user.id);
                
                const notificationMessage = userLanguage === 'en' ?
                    `🎉 Great News!\n\n📧 New high-value email accounts have been added!\n💰 Higher rewards available now\n\n🚀 Go to Tasks menu to start earning!\n\n⚡ Don't miss out - limited accounts available!` :
                    `🎉 أخبار رائعة!\n\n📧 تم إضافة إيميلات جديدة بسعر مرتفع!\n💰 مكافآت أعلى متاحة الآن\n\n🚀 اذهب لقائمة المهام لتبدأ الربح!\n\n⚡ لا تفوت الفرصة - عدد محدود من الحسابات!`;

                const result = await safeSendMessage(user.id, notificationMessage);
                if (result === null) {
                    failedCount++;
                } else {
                    notifiedCount++;
                }

                // Add small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                failedCount++;
                console.error(`Failed to notify user ${user.id}:`, error.message);
            }
        }

        console.log(`📊 Notification results: ✅ Sent: ${notifiedCount}, ❌ Failed: ${failedCount}`);
    } catch (error) {
        console.error('Error notifying users about new accounts:', error);
    }
}



// Change minimum withdrawal
async function changeMinWithdrawal(chatId, newAmount, language) {
    try {
        const amount = parseFloat(newAmount);
        if (isNaN(amount) || amount <= 0) {
            const errorMessage = language === 'en' ?
                '❌ Invalid amount. Please enter a valid number.' :
                '❌ مبلغ غير صحيح. يرجى إدخال رقم صحيح.';
            return bot.sendMessage(chatId, errorMessage);
        }

        // Save minimum withdrawal in EGP
        await db.setSetting('min_withdrawal', amount.toString());
        
        // Calculate and save USD equivalent
        const usdEquivalent = await convertEGPToUSD(amount);
        await db.setSetting('min_withdrawal_usd', usdEquivalent.toString());

        const successMessage = language === 'en' ?
            `✅ Minimum withdrawal updated successfully!\n\n💳 New minimum:\n💰 EGP: ${formatBalance(amount, 'EGP')}\n💵 USD: $${usdEquivalent.toFixed(3)}\n\n💡 Both currencies updated automatically!` :
            `✅ تم تحديث الحد الأدنى للسحب بنجاح!\n\n💳 الحد الجديد:\n💰 جنيه: ${formatBalance(amount, 'EGP')}\n💵 دولار: $${usdEquivalent.toFixed(3)}\n\n💡 تم تحديث العملتين تلقائياً!`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing minimum withdrawal:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating minimum withdrawal' :
            '❌ حدث خطأ في تحديث الحد الأدنى للسحب';
        bot.sendMessage(chatId, errorMessage);
    }
}


// Change support message
async function changeSupportMessage(chatId, newMessage, language) {
    try {
        await db.setSetting('support_message', newMessage);

        const successMessage = language === 'en' ?
            `✅ Support message updated successfully!\n\n💬 New message: "${newMessage.substring(0, 100)}${newMessage.length > 100 ? '...' : ''}"` :
            `✅ تم تحديث رسالة الدعم بنجاح!\n\n💬 الرسالة الجديدة: "${newMessage.substring(0, 100)}${newMessage.length > 100 ? '...' : ''}"`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing support message:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating support message' :
            '❌ حدث خطأ في تحديث رسالة الدعم';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Change email task reward
async function changeEmailTaskReward(chatId, newReward, language) {
    try {
        const reward = parseFloat(newReward);
        if (isNaN(reward) || reward <= 0) {
            const errorMessage = language === 'en' ?
                '❌ Invalid reward amount. Please enter a valid number.' :
                '❌ مبلغ مكافأة غير صحيح. يرجى إدخال رقم صحيح.';
            return bot.sendMessage(chatId, errorMessage);
        }

        await db.setSetting('task_reward', reward.toString());

        const successMessage = language === 'en' ?
            `✅ Email task reward updated successfully!\n\n💰 New reward: ${formatBalance(reward, 'EGP')}` :
            `✅ تم تحديث مكافأة مهمة اليوزرات بنجاح!\n\n💰 المكافأة الجديدة: ${formatBalance(reward, 'EGP')}`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing email task reward:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating email task reward' :
            '❌ حدث خطأ في تحديث مكافأة مهمة اليوزرات';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Change Gmail task reward
async function changeGmailTaskReward(chatId, newReward, language) {
    try {
        const reward = parseFloat(newReward);
        if (isNaN(reward) || reward <= 0) {
            const errorMessage = language === 'en' ?
                '❌ Invalid reward amount. Please enter a valid number.' :
                '❌ مبلغ مكافأة غير صحيح. يرجى إدخال رقم صحيح.';
            return bot.sendMessage(chatId, errorMessage);
        }

        await db.setSetting('gmail_task_reward', reward.toString());

        const successMessage = language === 'en' ?
            `✅ Gmail task reward updated successfully!\n\n📱 New reward: ${formatBalance(reward, 'EGP')}` :
            `✅ تم تحديث مكافأة مهمة الجيميل بنجاح!\n\n📱 المكافأة الجديدة: ${formatBalance(reward, 'EGP')}`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing Gmail task reward:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating Gmail task reward' :
            '❌ حدث خطأ في تحديث مكافأة مهمة الجيميل';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Change Gmail password
async function changeGmailPassword(chatId, newPassword, language) {
    try {
        await db.setSetting('gmail_password', newPassword);

        const successMessage = language === 'en' ?
            `✅ Gmail password updated successfully!\n\n🔑 New password: ${newPassword}\n\n⚠️ This will be used for all future Gmail tasks` :
            `✅ تم تحديث كلمة مرور الجيميل بنجاح!\n\n🔑 كلمة المرور الجديدة: ${newPassword}\n\n⚠️ سيتم استخدامها في جميع مهام الجيميل المستقبلية`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing Gmail password:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating Gmail password' :
            '❌ حدث خطأ في تحديث كلمة مرور الجيميل';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Toggle Email Tasks (Enable/Disable)
async function toggleEmailTasks(chatId, language) {
    try {
        const currentStatus = await db.getSetting('tasks_enabled');
        const isEnabled = currentStatus !== 'false';
        
        // Toggle status
        const newStatus = isEnabled ? 'false' : 'true';
        await db.setSetting('tasks_enabled', newStatus);
        
        const statusText = !isEnabled ? 
            (language === 'en' ? '✅ Enabled' : '✅ مفعلة') : 
            (language === 'en' ? '❌ Disabled' : '❌ معطلة');
        
        const message = language === 'en' ?
            `📧 Email Creation Task Status:\n\n${statusText}\n\n💡 Users ${!isEnabled ? 'can now' : 'cannot'} access email creation tasks` :
            `📧 حالة مهمة إنشاء اليوزرات:\n\n${statusText}\n\n💡 المستخدمون ${!isEnabled ? 'يمكنهم الآن' : 'لا يمكنهم'} الوصول لمهام إنشاء اليوزرات`;
        
        // Create inline keyboard for quick toggle
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: !isEnabled ? 
                                (language === 'en' ? '❌ Disable' : '❌ تعطيل') : 
                                (language === 'en' ? '✅ Enable' : '✅ تفعيل'),
                            callback_data: 'toggle_email_tasks'
                        }
                    ]
                ]
            }
        };
        
        bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error toggling email tasks:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating task status' :
            '❌ حدث خطأ في تحديث حالة المهمة';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Toggle Gmail Tasks (Enable/Disable)
async function toggleGmailTasks(chatId, language) {
    try {
        const currentStatus = await db.getSetting('gmail_tasks_enabled');
        const isEnabled = currentStatus !== 'false';
        
        // Toggle status
        const newStatus = isEnabled ? 'false' : 'true';
        await db.setSetting('gmail_tasks_enabled', newStatus);
        
        const statusText = !isEnabled ? 
            (language === 'en' ? '✅ Enabled' : '✅ مفعلة') : 
            (language === 'en' ? '❌ Disabled' : '❌ معطلة');
        
        const message = language === 'en' ?
            `📱 Gmail Creation Task Status:\n\n${statusText}\n\n💡 Users ${!isEnabled ? 'can now' : 'cannot'} access Gmail creation tasks` :
            `📱 حالة مهمة إنشاء الجيميل:\n\n${statusText}\n\n💡 المستخدمون ${!isEnabled ? 'يمكنهم الآن' : 'لا يمكنهم'} الوصول لمهام إنشاء الجيميل`;
        
        // Create inline keyboard for quick toggle
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: !isEnabled ? 
                                (language === 'en' ? '❌ Disable' : '❌ تعطيل') : 
                                (language === 'en' ? '✅ Enable' : '✅ تفعيل'),
                            callback_data: 'toggle_gmail_tasks'
                        }
                    ]
                ]
            }
        };
        
        bot.sendMessage(chatId, message, keyboard);
    } catch (error) {
        console.error('Error toggling Gmail tasks:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating task status' :
            '❌ حدث خطأ في تحديث حالة المهمة';
        bot.sendMessage(chatId, errorMessage);
    }
}


// Handle toggle Gmail tasks button
async function handleToggleGmailTasks(chatId, messageId, language) {
    try {
        const currentStatus = await db.getSetting('gmail_tasks_enabled');
        const isEnabled = currentStatus !== 'false';
        
        // Toggle status
        const newStatus = isEnabled ? 'false' : 'true';
        await db.setSetting('gmail_tasks_enabled', newStatus);
        
        const statusText = !isEnabled ? 
            (language === 'en' ? '✅ Enabled' : '✅ مفعلة') : 
            (language === 'en' ? '❌ Disabled' : '❌ معطلة');
        
        const message = language === 'en' ?
            `📱 Gmail Creation Task Status:\n\n${statusText}\n\n💡 Users ${!isEnabled ? 'can now' : 'cannot'} access Gmail creation tasks` :
            `📱 حالة مهمة إنشاء الجيميل:\n\n${statusText}\n\n💡 المستخدمون ${!isEnabled ? 'يمكنهم الآن' : 'لا يمكنهم'} الوصول لمهام إنشاء الجيميل`;
        
        // Create inline keyboard for quick toggle
        const keyboard = {
            inline_keyboard: [
                [
                    {
                        text: !isEnabled ? 
                            (language === 'en' ? '❌ Disable' : '❌ تعطيل') : 
                            (language === 'en' ? '✅ Enable' : '✅ تفعيل'),
                        callback_data: 'toggle_gmail_tasks'
                    }
                ]
            ]
        };
        
        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Error handling toggle Gmail tasks:', error);
    }
}

// Change referral reward EGP
async function changeReferralRewardEGP(chatId, newReward, language) {
    try {
        const reward = parseFloat(newReward);
        if (isNaN(reward) || reward < 0) {
            const errorMessage = language === 'en' ?
                '❌ Please enter a valid positive number' :
                '❌ يرجى إدخال رقم صحيح موجب';
            bot.sendMessage(chatId, errorMessage);
            return;
        }

        await db.setSetting('referral_reward_egp', reward.toString());

        const successMessage = language === 'en' ?
            `✅ Referral reward (EGP) updated successfully!\n\n💰 New reward: ${formatBalance(reward, 'EGP')}` :
            `✅ تم تحديث مكافأة الإحالة (جنيه) بنجاح!\n\n💰 المكافأة الجديدة: ${formatBalance(reward, 'EGP')}`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing referral reward EGP:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating referral reward (EGP)' :
            '❌ حدث خطأ في تحديث مكافأة الإحالة (جنيه)';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Change referral reward USD
async function changeReferralRewardUSD(chatId, newReward, language) {
    try {
        const reward = parseFloat(newReward);
        if (isNaN(reward) || reward < 0) {
            const errorMessage = language === 'en' ?
                '❌ Please enter a valid positive number' :
                '❌ يرجى إدخال رقم صحيح موجب';
            bot.sendMessage(chatId, errorMessage);
            return;
        }

        await db.setSetting('referral_reward_usd', reward.toString());

        const successMessage = language === 'en' ?
            `✅ Referral reward (USD) updated successfully!\n\n💵 New reward: ${formatBalance(reward, 'USD')}` :
            `✅ تم تحديث مكافأة الإحالة (دولار) بنجاح!\n\n💵 المكافأة الجديدة: ${formatBalance(reward, 'USD')}`;

        bot.sendMessage(chatId, successMessage);
    } catch (error) {
        console.error('Error changing referral reward USD:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating referral reward (USD)' :
            '❌ حدث خطأ في تحديث مكافأة الإحالة (دولار)';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Add reward to user balance
async function addRewardToUser(userId, taskType) {
    try {
        const user = await db.getUser(userId);
        if (!user) return false;

        // Get reward amount from database or config
        let rewardAmount;
        if (taskType === 'gmail') {
            rewardAmount = parseFloat(await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD);
        } else {
            rewardAmount = parseFloat(await db.getSetting('task_reward') || config.TASK_REWARD);
        }

        // Add reward based on user's preferred currency
        if (user.preferred_currency === 'USD') {
            const usdReward = await convertEGPToUSD(rewardAmount);
            const newBalance = (user.balance_usd || 0) + usdReward;
            await db.setUserUSDBalance(userId, newBalance);
        } else {
            const newBalance = (user.balance || 0) + rewardAmount;
            await db.setUserBalance(userId, newBalance);
        }

        return true;
    } catch (error) {
        console.error('Error adding reward to user:', error);
        return false;
    }
}

// Approve user task (for inline buttons - can be added later)
async function approveUserTask(accountId, taskType = 'email') {
    try {
        // This function can be expanded to handle inline button approvals
        // For now, it's a placeholder for future inline keyboard implementation
        console.log(`Task approved: Account ID ${accountId}, Type: ${taskType}`);
        return true;
    } catch (error) {
        console.error('Error approving task:', error);
        return false;
    }
}

// Reject user task (for inline buttons - can be added later)
async function rejectUserTask(accountId, taskType = 'email') {
    try {
        // This function can be expanded to handle inline button rejections
        // For now, it's a placeholder for future inline keyboard implementation
        console.log(`Task rejected: Account ID ${accountId}, Type: ${taskType}`);
        return true;
    } catch (error) {
        console.error('Error rejecting task:', error);
        return false;
    }
}

// Handle email account approval/rejection
async function handleEmailApproval(chatId, accountId, messageId, language, isApproved) {
    try {
        // Get account details from pending accounts
        const accounts = await db.getPendingAccounts();
        const account = accounts.find(acc => acc.id.toString() === accountId);

        if (!account) {
            const errorMessage = language === 'en' ?
                '❌ Account not found or already processed' :
                '❌ الحساب غير موجود أو تم معالجته بالفعل';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        if (isApproved) {
            // Add reward to user
            const rewardAdded = await addRewardToUser(account.user_id, 'email');

            if (rewardAdded) {
                // Get reward amount for display
                const rewardAmount = parseFloat(await db.getSetting('task_reward') || config.TASK_REWARD);
                const user = await db.getUser(account.user_id);
                const currency = user?.preferred_currency || 'EGP';
                const displayReward = currency === 'USD' ?
                    `$${(await convertEGPToUSD(rewardAmount)).toFixed(3)}` :
                    formatBalance(rewardAmount, 'EGP');

                // Get user's preferred language for notification
                const userLanguage = await getUserLanguage(account.user_id);

                // Notify user in their preferred language
                const userMessage = userLanguage === 'en' ?
                    `✅ Your email account has been approved!\n\n💰 Reward added: ${displayReward}\n📧 Account: ${account.email}` :
                    `✅ تم قبول حساب الإيميل الخاص بك!\n\n💰 تم إضافة المكافأة: ${displayReward}\n📧 الحساب: ${account.email}`;

                await safeSendMessage(account.user_id, userMessage);

                // Process referral reward if applicable
                await processReferralReward(account.user_id);

                // Update admin message
                const adminMessage = language === 'en' ?
                    `✅ APPROVED\n\n📧 Email: ${account.email}\n👤 User: ${account.user_id}\n💰 Reward: ${displayReward}\n📅 Approved: ${new Date().toLocaleString()}` :
                    `✅ تم القبول\n\n📧 الإيميل: ${account.email}\n👤 المستخدم: ${account.user_id}\n💰 المكافأة: ${displayReward}\n📅 تاريخ القبول: ${new Date().toLocaleString()}`;

                bot.editMessageText(adminMessage, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } else {
                const errorMessage = language === 'en' ?
                    '❌ Error adding reward to user' :
                    '❌ حدث خطأ في إضافة المكافأة للمستخدم';
                bot.editMessageText(errorMessage, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }
        } else {
            // Rejected - return account to available accounts
            try {
                await db.addAvailableAccount(account.email, account.password);
            } catch (error) {
                console.error('Error returning rejected account to pool:', error.message);
            }

            // Get user's preferred language for notification
            const userLanguage = await getUserLanguage(account.user_id);

            // Notify user in their preferred language
            const userMessage = userLanguage === 'en' ?
                `❌ Your email account was rejected.\n\n📧 Account: ${account.email}\n\n💡 Make sure you create the account correctly next time\n📞 If there is a problem, contact support\n\n🔄 You can try again with a new task` :
                `❌ تم رفض حساب الإيميل الخاص بك.\n\n📧 الحساب: ${account.email}\n\n💡 تأكد من أنك أنشأت الحساب بشكل صحيح المرة القادمة\n📞 إذا هناك مشكلة، تواصل مع الدعم\n\n🔄 يمكنك المحاولة مرة أخرى بمهمة جديدة`;

            try {
                await bot.sendMessage(account.user_id, userMessage);
            } catch (error) {
                console.error('Failed to notify user:', error);
            }

            // Update admin message
            const adminMessage = language === 'en' ?
                `❌ REJECTED\n\n📧 Email: ${account.email}\n👤 User: ${account.user_id}\n📅 Rejected: ${new Date().toLocaleString()}\n\n💡 Account returned to available pool` :
                `❌ تم الرفض\n\n📧 الإيميل: ${account.email}\n👤 المستخدم: ${account.user_id}\n📅 تاريخ الرفض: ${new Date().toLocaleString()}\n\n💡 تم إرجاع الحساب للمجموعة المتاحة`;

            bot.editMessageText(adminMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Remove from pending accounts
        await db.removePendingAccount(account.id);

    } catch (error) {
        console.error('Error handling email approval:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing approval' :
            '❌ حدث خطأ في معالجة الموافقة';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle Gmail account approval/rejection
async function handleGmailApproval(chatId, accountId, messageId, language, isApproved) {
    try {
        // Get account details from Gmail accounts
        const accounts = await db.getPendingGmailAccounts();
        const account = accounts.find(acc => acc.id.toString() === accountId);

        if (!account) {
            const errorMessage = language === 'en' ?
                '❌ Gmail account not found or already processed' :
                '❌ حساب الجيميل غير موجود أو تم معالجته بالفعل';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        if (isApproved) {
            // Add reward to user
            const rewardAdded = await addRewardToUser(account.user_id, 'gmail');

            if (rewardAdded) {
                // Get reward amount for display
                const rewardAmount = parseFloat(await db.getSetting('gmail_task_reward') || config.GMAIL_TASK_REWARD);
                const user = await db.getUser(account.user_id);
                const currency = user?.preferred_currency || 'EGP';
                const displayReward = currency === 'USD' ?
                    `$${(await convertEGPToUSD(rewardAmount)).toFixed(3)}` :
                    formatBalance(rewardAmount, 'EGP');

                // Get user's preferred language for notification
                const userLanguage = await getUserLanguage(account.user_id);

                // Notify user in their preferred language
                const userMessage = userLanguage === 'en' ?
                    `✅ Your Gmail account has been approved!\n\n💰 Reward added: ${displayReward}\n📱 Gmail: ${account.email}` :
                    `✅ تم قبول حساب الجيميل الخاص بك!\n\n💰 تم إضافة المكافأة: ${displayReward}\n📱 الجيميل: ${account.email}`;

                try {
                    await bot.sendMessage(account.user_id, userMessage);
                } catch (error) {
                    console.error('Failed to notify user:', error);
                }

                // Process referral reward if applicable
                await processReferralReward(account.user_id);

                // Update admin message
                const adminMessage = language === 'en' ?
                    `✅ APPROVED\n\n📱 Gmail: ${account.email}\n👤 User: ${account.user_id}\n💰 Reward: ${displayReward}\n📅 Approved: ${new Date().toLocaleString()}` :
                    `✅ تم القبول\n\n📱 الجيميل: ${account.email}\n👤 المستخدم: ${account.user_id}\n💰 المكافأة: ${displayReward}\n📅 تاريخ القبول: ${new Date().toLocaleString()}`;

                bot.editMessageText(adminMessage, {
                    chat_id: chatId,
                    message_id: messageId
                });

                // Update Gmail account status to approved
                await db.updateGmailAccountStatus(account.id, 'approved');
            } else {
                const errorMessage = language === 'en' ?
                    '❌ Error adding reward to user' :
                    '❌ حدث خطأ في إضافة المكافأة للمستخدم';
                bot.editMessageText(errorMessage, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }
        } else {
            // Rejected
            // Get user's preferred language for notification
            const userLanguage = await getUserLanguage(account.user_id);

            // Notify user in their preferred language
            const userMessage = userLanguage === 'en' ?
                `❌ Your Gmail account was rejected.\n\n📱 Gmail: ${account.email}\n\n💡 Make sure you create the account correctly next time:\n• Use the provided password\n• Create from mobile phone only\n\n📞 If there is a problem, contact support\n🔄 You can try again with a new Gmail task` :
                `❌ تم رفض حساب الجيميل الخاص بك.\n\n📱 الجيميل: ${account.email}\n\n💡 تأكد من أنك أنشأت الحساب بشكل صحيح المرة القادمة:\n• استخدم كلمة المرور المعطاة\n• أنشئ الحساب من الهاتف فقط\n\n📞 إذا هناك مشكلة، تواصل مع الدعم\n🔄 يمكنك المحاولة مرة أخرى بمهمة جيميل جديدة`;

            try {
                await bot.sendMessage(account.user_id, userMessage);
            } catch (error) {
                console.error('Failed to notify user:', error);
            }

            // Update admin message
            const adminMessage = language === 'en' ?
                `❌ REJECTED\n\n📱 Gmail: ${account.email}\n👤 User: ${account.user_id}\n📅 Rejected: ${new Date().toLocaleString()}` :
                `❌ تم الرفض\n\n📱 الجيميل: ${account.email}\n👤 المستخدم: ${account.user_id}\n📅 تاريخ الرفض: ${new Date().toLocaleString()}`;

            bot.editMessageText(adminMessage, {
                chat_id: chatId,
                message_id: messageId
            });

            // Update Gmail account status to rejected
            await db.updateGmailAccountStatus(account.id, 'rejected');
        }

    } catch (error) {
        console.error('Error handling Gmail approval:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing approval' :
            '❌ حدث خطأ في معالجة الموافقة';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle user ban/unban
async function handleUserBan(chatId, targetUserId, messageId, language, isBan) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        if (isBan) {
            await db.banUser(targetUserId);
            const successMessage = language === 'en' ?
                `🚫 User Banned Successfully!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${targetUserId}\n📅 Banned: ${new Date().toLocaleString()}\n\n⚠️ User can no longer use the bot` :
                `🚫 تم حظر المستخدم بنجاح!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${targetUserId}\n📅 تاريخ الحظر: ${new Date().toLocaleString()}\n\n⚠️ لا يمكن للمستخدم استخدام البوت الآن`;

            // Notify user
            try {
                // Get user's preferred language for notification
                const userLanguage = await getUserLanguage(targetUserId);

                const userMessage = userLanguage === 'en' ?
                    '🚫 You have been banned from using this bot.\n\nIf you believe this is a mistake, please contact support.' :
                    '🚫 تم حظرك من استخدام هذا البوت.\n\nإذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع الدعم.';
                await bot.sendMessage(targetUserId, userMessage);
            } catch (error) {
                console.error('Failed to notify banned user:', error);
            }

            bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            await db.unbanUser(targetUserId);
            const successMessage = language === 'en' ?
                `✅ User Unbanned Successfully!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${targetUserId}\n📅 Unbanned: ${new Date().toLocaleString()}\n\n✅ User can now use the bot again` :
                `✅ تم إلغاء حظر المستخدم بنجاح!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${targetUserId}\n📅 تاريخ إلغاء الحظر: ${new Date().toLocaleString()}\n\n✅ يمكن للمستخدم استخدام البوت الآن`;

            // Notify user
            try {
                // Get user's preferred language for notification
                const userLanguage = await getUserLanguage(targetUserId);

                const userMessage = userLanguage === 'en' ?
                    '✅ Your ban has been lifted! You can now use the bot again.\n\nWelcome back!' :
                    '✅ تم إلغاء حظرك! يمكنك الآن استخدام البوت مرة أخرى.\n\nأهلاً بعودتك!';
                await bot.sendMessage(targetUserId, userMessage);
            } catch (error) {
                console.error('Failed to notify unbanned user:', error);
            }

            bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }
    } catch (error) {
        console.error('Error handling user ban:', error);
        const errorMessage = language === 'en' ?
            '❌ Error processing ban/unban' :
            '❌ حدث خطأ في معالجة الحظر/إلغاء الحظر';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle balance edit
async function handleBalanceEdit(chatId, targetUserId, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.sendMessage(chatId, errorMessage);
        }

        const currency = user.preferred_currency || 'EGP';
        const currentBalance = currency === 'USD' ? user.balance_usd || 0 : user.balance || 0;

        userStates.set(chatId.toString(), `edit_balance_${targetUserId}`);

        const message = language === 'en' ?
            `💰 Edit Balance for ${user.username || 'Unknown'}\n\n🆔 User ID: ${targetUserId}\n💱 Currency: ${currency}\n💰 Current Balance: ${formatBalance(currentBalance, currency)}\n\n💡 Send amount to add/subtract:\n\n✅ Positive number (+10): Adds to balance\n❌ Negative number (-5): Subtracts from balance\n\n📝 Examples:\n• +50 → Adds 50 to current balance\n• -20 → Subtracts 20 from current balance\n• 30 → Adds 30 to current balance` :
            `💰 تعديل رصيد ${user.username || 'غير محدد'}\n\n🆔 آيدي المستخدم: ${targetUserId}\n💱 العملة: ${currency}\n💰 الرصيد الحالي: ${formatBalance(currentBalance, currency)}\n\n💡 أرسل المبلغ للإضافة/الخصم:\n\n✅ رقم موجب (+10): يضيف للرصيد\n❌ رقم سالب (-5): يخصم من الرصيد\n\n📝 أمثلة:\n• +50 ← يضيف 50 للرصيد الحالي\n• -20 ← يخصم 20 من الرصيد الحالي\n• 30 ← يضيف 30 للرصيد الحالي`;

        const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
        bot.sendMessage(chatId, message, cancelKeyboard);
    } catch (error) {
        console.error('Error handling balance edit:', error);
        const errorMessage = language === 'en' ?
            '❌ Error initiating balance edit' :
            '❌ حدث خطأ في بدء تعديل الرصيد';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Handle user message
async function handleUserMessage(chatId, targetUserId, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.sendMessage(chatId, errorMessage);
        }

        userStates.set(chatId.toString(), `send_message_${targetUserId}`);

        const message = language === 'en' ?
            `📨 Send Message to ${user.username || 'Unknown'}\n\n🆔 User ID: ${targetUserId}\n\n💡 Write your message:` :
            `📨 إرسال رسالة إلى ${user.username || 'غير محدد'}\n\n🆔 آيدي المستخدم: ${targetUserId}\n\n💡 اكتب رسالتك:`;

        const cancelKeyboard = keyboards.getKeyboard('cancelAdmin', language);
        bot.sendMessage(chatId, message, cancelKeyboard);
    } catch (error) {
        console.error('Error handling user message:', error);
        const errorMessage = language === 'en' ?
            '❌ Error initiating message send' :
            '❌ حدث خطأ في بدء إرسال الرسالة';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Handle user details
async function handleUserDetails(chatId, targetUserId, messageId, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Delete the old message and send new detailed info
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (deleteError) {
            console.log('Could not delete message:', deleteError.message);
        }
        
        await displayUserInfo(chatId, user, language);

        const status = user.is_banned ? (language === 'en' ? '🚫 Banned' : '🚫 محظور') : (language === 'en' ? '✅ Active' : '✅ نشط');
        const currency = user.preferred_currency || 'EGP';
        const egpBalance = user.balance || 0;
        const usdBalance = user.balance_usd || 0;

        const detailedMessage = language === 'en' ?
            `👤 Detailed User Information:\n\n📝 Username: ${user.username || 'Unknown'}\n🆔 ID: ${targetUserId}\n💰 EGP Balance: ${formatBalance(egpBalance, 'EGP')}\n💵 USD Balance: $${usdBalance.toFixed(2)}\n💱 Preferred Currency: ${currency}\n🌍 Language: ${user.preferred_language || 'ar'}\n📊 Status: ${status}\n📅 Joined: ${new Date(user.created_at).toLocaleString()}\n⏰ Last Active: ${new Date(user.last_active || user.created_at).toLocaleString()}\n\n📊 Account Statistics:\n• Total Tasks: N/A\n• Completed Tasks: N/A\n• Success Rate: N/A` :
            `👤 معلومات المستخدم المفصلة:\n\n📝 اليوزر نيم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${targetUserId}\n💰 رصيد الجنيه: ${formatBalance(egpBalance, 'EGP')}\n💵 رصيد الدولار: $${usdBalance.toFixed(2)}\n💱 العملة المفضلة: ${currency}\n🌍 اللغة: ${user.preferred_language || 'ar'}\n📊 الحالة: ${status}\n📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleString()}\n⏰ آخر نشاط: ${new Date(user.last_active || user.created_at).toLocaleString()}\n\n📊 إحصائيات الحساب:\n• إجمالي المهام: غير متاح\n• المهام المكتملة: غير متاح\n• معدل النجاح: غير متاح`;

        bot.editMessageText(detailedMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    } catch (error) {
        console.error('Error showing user details:', error);
        const errorMessage = language === 'en' ?
            '❌ Error loading user details' :
            '❌ حدث خطأ في تحميل تفاصيل المستخدم';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle user refresh
async function handleUserRefresh(chatId, targetUserId, messageId, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        const status = user.is_banned ? (language === 'en' ? '🚫 Banned' : '🚫 محظور') : (language === 'en' ? '✅ Active' : '✅ نشط');
        const currency = user.preferred_currency || 'EGP';
        const balance = currency === 'USD' ? user.balance_usd || 0 : user.balance || 0;

        const message = language === 'en' ?
            `👤 User Information (Updated):\n\n📝 Username: ${user.username || 'Unknown'}\n🆔 ID: ${user.id}\n💰 Balance: ${formatBalance(balance, currency)}\n💱 Currency: ${currency}\n🌍 Language: ${user.preferred_language || 'ar'}\n📊 Status: ${status}\n📅 Joined: ${new Date(user.created_at).toLocaleDateString()}\n⏰ Last Active: ${new Date(user.last_active || user.created_at).toLocaleDateString()}\n\n🔄 Updated: ${new Date().toLocaleString()}` :
            `👤 معلومات المستخدم (محدثة):\n\n📝 اليوزر نيم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${user.id}\n💰 الرصيد: ${formatBalance(balance, currency)}\n💱 العملة: ${currency}\n🌍 اللغة: ${user.preferred_language || 'ar'}\n📊 الحالة: ${status}\n📅 تاريخ الانضمام: ${new Date(user.created_at).toLocaleDateString()}\n⏰ آخر نشاط: ${new Date(user.last_active || user.created_at).toLocaleDateString()}\n\n🔄 تم التحديث: ${new Date().toLocaleString()}`;

        // Recreate control buttons
        const inlineKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: `📋 ${language === 'en' ? 'Copy ID' : 'نسخ الآيدي'}`,
                            callback_data: `copy_id_${user.id}`
                        }
                    ],
                    [
                        {
                            text: user.is_banned ?
                                (language === 'en' ? '✅ Unban' : '✅ إلغاء الحظر') :
                                (language === 'en' ? '🚫 Ban' : '🚫 حظر'),
                            callback_data: user.is_banned ? `unban_user_${user.id}` : `ban_user_${user.id}`
                        },
                        {
                            text: language === 'en' ? '💰 Edit Balance' : '💰 تعديل الرصيد',
                            callback_data: `edit_balance_${user.id}`
                        }
                    ],
                    [
                        {
                            text: language === 'en' ? '📨 Send Message' : '📨 إرسال رسالة',
                            callback_data: `message_user_${user.id}`
                        },
                        {
                            text: language === 'en' ? '📊 Full Details' : '📊 التفاصيل الكاملة',
                            callback_data: `user_details_${user.id}`
                        }
                    ]
                ]
            }
        };

        bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: inlineKeyboard.reply_markup
        });
    } catch (error) {
        console.error('Error refreshing user info:', error);
        const errorMessage = language === 'en' ?
            '❌ Error refreshing user information' :
            '❌ حدث خطأ في تحديث معلومات المستخدم';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Process balance edit
async function processBalanceEdit(chatId, targetUserId, amountInput, language) {
    try {
        // Parse the input amount (can be positive or negative)
        const amount = parseFloat(amountInput);
        if (isNaN(amount)) {
            const errorMessage = language === 'en' ?
                '❌ Invalid amount. Please enter a valid number.\n\n📝 Examples:\n• +50 (adds 50)\n• -20 (subtracts 20)\n• 30 (adds 30)' :
                '❌ مبلغ غير صحيح. يرجى إدخال رقم صحيح.\n\n📝 أمثلة:\n• +50 (يضيف 50)\n• -20 (يخصم 20)\n• 30 (يضيف 30)';
            return bot.sendMessage(chatId, errorMessage);
        }

        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.sendMessage(chatId, errorMessage);
        }

        const currency = user.preferred_currency || 'EGP';
        const currentBalance = currency === 'USD' ? (user.balance_usd || 0) : (user.balance || 0);

        // Calculate new balance by adding the amount (can be positive or negative)
        const newBalance = currentBalance + amount;

        // Prevent negative balance
        if (newBalance < 0) {
            const errorMessage = language === 'en' ?
                `❌ Cannot subtract ${Math.abs(amount)} from current balance!\n\n💰 Current Balance: ${formatBalance(currentBalance, currency)}\n💰 Amount to subtract: ${formatBalance(Math.abs(amount), currency)}\n💰 Result would be: ${formatBalance(newBalance, currency)}\n\n⚠️ Balance cannot be negative!` :
                `❌ لا يمكن خصم ${Math.abs(amount)} من الرصيد الحالي!\n\n💰 الرصيد الحالي: ${formatBalance(currentBalance, currency)}\n💰 المبلغ المراد خصمه: ${formatBalance(Math.abs(amount), currency)}\n💰 النتيجة ستكون: ${formatBalance(newBalance, currency)}\n\n⚠️ الرصيد لا يمكن أن يكون سالباً!`;
            return bot.sendMessage(chatId, errorMessage);
        }

        // Update the balance
        if (currency === 'USD') {
            await db.setUserUSDBalance(targetUserId, newBalance);
        } else {
            await db.setUserBalance(targetUserId, newBalance);
        }

        // Determine operation type for display
        const operationType = amount >= 0 ?
            (language === 'en' ? 'Added' : 'تم إضافة') :
            (language === 'en' ? 'Subtracted' : 'تم خصم');

        const operationSymbol = amount >= 0 ? '+' : '';

        const successMessage = language === 'en' ?
            `✅ Balance updated successfully!\n\n👤 User: ${user.username || 'Unknown'}\n🆔 ID: ${targetUserId}\n💱 Currency: ${currency}\n\n💰 Previous Balance: ${formatBalance(currentBalance, currency)}\n${operationSymbol}${formatBalance(amount, currency)} (${operationType})\n💰 New Balance: ${formatBalance(newBalance, currency)}\n\n📅 Updated: ${new Date().toLocaleString()}` :
            `✅ تم تحديث الرصيد بنجاح!\n\n👤 المستخدم: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${targetUserId}\n💱 العملة: ${currency}\n\n💰 الرصيد السابق: ${formatBalance(currentBalance, currency)}\n${operationSymbol}${formatBalance(amount, currency)} (${operationType})\n💰 الرصيد الجديد: ${formatBalance(newBalance, currency)}\n\n📅 تاريخ التحديث: ${new Date().toLocaleString()}`;

        bot.sendMessage(chatId, successMessage);

        // Notify user about balance change
        try {
            const changeDescription = amount >= 0 ?
                (language === 'en' ? `+${formatBalance(amount, currency)} added` : `+${formatBalance(amount, currency)} تم إضافة`) :
                (language === 'en' ? `${formatBalance(amount, currency)} deducted` : `${formatBalance(Math.abs(amount), currency)} تم خصم`);

            // Get user's preferred language for notification
            const userLanguage = await getUserLanguage(targetUserId);

            const userMessage = userLanguage === 'en' ?
                `💰 Your balance has been updated by admin!\n\n💰 Previous Balance: ${formatBalance(currentBalance, currency)}\n💰 Change: ${changeDescription}\n💰 New Balance: ${formatBalance(newBalance, currency)}\n\n📅 Updated: ${new Date().toLocaleString()}` :
                `💰 تم تحديث رصيدك من قبل الأدمن!\n\n💰 الرصيد السابق: ${formatBalance(currentBalance, currency)}\n💰 التغيير: ${changeDescription}\n💰 الرصيد الجديد: ${formatBalance(newBalance, currency)}\n\n📅 تاريخ التحديث: ${new Date().toLocaleString()}`;
            await bot.sendMessage(targetUserId, userMessage);
        } catch (error) {
            console.error('Failed to notify user about balance change:', error);
        }

    } catch (error) {
        console.error('Error processing balance edit:', error);
        const errorMessage = language === 'en' ?
            '❌ Error updating balance' :
            '❌ حدث خطأ في تحديث الرصيد';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Send direct message to user
async function sendDirectMessage(chatId, targetUserId, messageText, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            const errorMessage = language === 'en' ?
                '❌ User not found' :
                '❌ المستخدم غير موجود';
            return bot.sendMessage(chatId, errorMessage);
        }

        try {
            await bot.sendMessage(targetUserId, messageText);
            const successMessage = language === 'en' ?
                `✅ Message sent successfully!\n\n👤 To: ${user.username || 'Unknown'}\n🆔 ID: ${targetUserId}\n📨 Message: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"\n📅 Sent: ${new Date().toLocaleString()}` :
                `✅ تم إرسال الرسالة بنجاح!\n\n👤 إلى: ${user.username || 'غير محدد'}\n🆔 الآيدي: ${targetUserId}\n📨 الرسالة: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"\n📅 تاريخ الإرسال: ${new Date().toLocaleString()}`;
            bot.sendMessage(chatId, successMessage);
        } catch (error) {
            const errorMessage = language === 'en' ?
                `❌ Failed to send message to user ${targetUserId}\n\nPossible reasons:\n• User blocked the bot\n• User deleted their account\n• Network error` :
                `❌ فشل في إرسال الرسالة للمستخدم ${targetUserId}\n\nالأسباب المحتملة:\n• المستخدم حظر البوت\n• المستخدم حذف حسابه\n• خطأ في الشبكة`;
            bot.sendMessage(chatId, errorMessage);
        }

    } catch (error) {
        console.error('Error sending direct message:', error);
        const errorMessage = language === 'en' ?
            '❌ Error sending message' :
            '❌ حدث خطأ في إرسال الرسالة';
        bot.sendMessage(chatId, errorMessage);
    }
}

// Handle copy ID
async function handleCopyId(callbackQuery, targetUserId, language) {
    try {
        const user = await db.getUser(targetUserId);
        if (!user) {
            return bot.answerCallbackQuery(callbackQuery.id, {
                text: language === 'en' ? '❌ User not found' : '❌ المستخدم غير موجود',
                show_alert: true
            });
        }

        // Send the ID as a copyable message
        const copyMessage = language === 'en' ?
            `📋 User ID copied!\n\n🆔 ID: \`${targetUserId}\`\n\n💡 Tap the ID above to copy it` :
            `📋 تم نسخ آيدي المستخدم!\n\n🆔 الآيدي: \`${targetUserId}\`\n\n💡 اضغط على الآيدي أعلاه لنسخه`;

        bot.sendMessage(callbackQuery.message.chat.id, copyMessage, {
            reply_to_message_id: callbackQuery.message.message_id
        });

        // Answer callback query with success message
        bot.answerCallbackQuery(callbackQuery.id, {
            text: language === 'en' ?
                `📋 ID: ${targetUserId} - Ready to copy!` :
                `📋 الآيدي: ${targetUserId} - جاهز للنسخ!`,
            show_alert: false
        });

    } catch (error) {
        console.error('Error handling copy ID:', error);
        bot.answerCallbackQuery(callbackQuery.id, {
            text: language === 'en' ? '❌ Error copying ID' : '❌ حدث خطأ في نسخ الآيدي',
            show_alert: true
        });
    }
}

// Handle delete account
async function handleDeleteAccount(chatId, accountId, messageId, language) {
    try {
        // Get account details before deletion
        const accounts = await db.getAvailableAccountsList(1000);
        const account = accounts.find(acc => acc.id.toString() === accountId);

        if (!account) {
            const errorMessage = language === 'en' ?
                '❌ Account not found or already deleted' :
                '❌ الحساب غير موجود أو تم حذفه بالفعل';
            return bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

        // Delete the account
        const deleted = await db.removeAvailableAccountById(accountId);

        if (deleted > 0) {
            const successMessage = language === 'en' ?
                `🗑️ Account Deleted Successfully!\n\n📧 Email: ${account.email}\n🔑 Password: ${account.password}\n📅 Deleted: ${new Date().toLocaleString()}\n\n⚠️ This account has been permanently removed from the available pool` :
                `🗑️ تم حذف الحساب بنجاح!\n\n📧 الإيميل: ${account.email}\n🔑 كلمة المرور: ${account.password}\n📅 تاريخ الحذف: ${new Date().toLocaleString()}\n\n⚠️ تم حذف هذا الحساب نهائياً من المجموعة المتاحة`;

            bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        } else {
            const errorMessage = language === 'en' ?
                '❌ Failed to delete account' :
                '❌ فشل في حذف الحساب';
            bot.editMessageText(errorMessage, {
                chat_id: chatId,
                message_id: messageId
            });
        }

    } catch (error) {
        console.error('Error deleting account:', error);
        const errorMessage = language === 'en' ?
            '❌ Error deleting account' :
            '❌ حدث خطأ في حذف الحساب';
        bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}