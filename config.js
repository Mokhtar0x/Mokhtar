module.exports = {
    BOT_TOKEN: process.env.BOT_TOKEN || '8767796785:AAElA-8cTClWHgEpsIPzXXgPHlqD-mYt8oU',
    ADMIN_ID: process.env.ADMIN_ID || '6536561137',
    BOT_USERNAME: process.env.BOT_USERNAME || 'egy_easy_cash_bot', // اسم البوت بدون @

    // High-performance settings for millions of users
    PERFORMANCE: {
        MAX_CONCURRENT_REQUESTS: 100,
        REQUEST_TIMEOUT: 30000,
        CACHE_EXPIRY: 600000, // 10 minutes
        RATE_LIMIT_WINDOW: 60000, // 1 minute
        MAX_REQUESTS_PER_MINUTE: 30,
        MEMORY_CLEANUP_INTERVAL: 300000, // 5 minutes
        DATABASE_POOL_SIZE: 10,
        ENABLE_CLUSTERING: true,
        MAX_WORKERS: require('os').cpus().length
    },

    // Rewards and limits
    TASK_REWARD: 5, // Task reward (in EGP)
    GMAIL_TASK_REWARD: 10, // Gmail task reward (in EGP)
    MIN_WITHDRAWAL: 50, // Minimum withdrawal (in EGP)

    // Referral system rewards
    REFERRAL_REWARD_EGP: 4, // Referral reward in EGP
    REFERRAL_REWARD_USD: 0.09, // Referral reward in USD

    // Currency settings and exchange rates
    USD_TO_EGP_RATE: 48, // USD to EGP exchange rate
    MIN_WITHDRAWAL_USD: 1, // Minimum withdrawal in USD

    // Task timeout (in minutes)
    TASK_TIMEOUT: 5,

    // Task status (can be changed by admin)
    TASKS_ENABLED: true,
    GMAIL_TASKS_ENABLED: true,

    // Gmail task settings
    GMAIL_PASSWORD: 'DefaultPass123',

    // Default Gmail task text (can be changed by admin)
    DEFAULT_GMAIL_TASK_TEXT: '📱 مهمة إنشاء جيميل\n\n📋 التعليمات:\n🔑 كلمة المرور الموحدة: {password}\n📱 يجب إنشاء الحساب من الهاتف فقط\n👤 استخدم أي اسم تريده (عربي أو أجنبي)\n📧 استخدم كلمة المرور الموحدة المذكورة أعلاه\n\n⚠️ ستحصل على المكافأة بعد موافقة الأدمن\n\n💡 بعد إنشاء الحساب، اضغط "متابعة" لإدخال الإيميل\n\n🕐 خذ وقتك - لا يوجد حد زمني لهذه المهمة',

    // Default language
    DEFAULT_LANGUAGE: 'ar', // 'ar' for Arabic, 'en' for English

    // System messages in both languages
    MESSAGES: {
        ar: {
            WELCOME: '🎉 مرحباً بك في أسهل وأسرع طريقة للربح! 💰\n\n✨ ابدأ رحلتك نحو الربح الآن ✨',
            LANGUAGE_SELECTION: '🌍 مرحباً بك! اختر لغتك المفضلة:\n\n🇸🇦 للعربية اضغط على الزر أدناه\n🇺🇸 For English press the button below\n\nWelcome! Choose your preferred language:',
            CURRENCY_SELECTION: '💱 اختر العملة المفضلة لك:\n\n💵 الدولار الأمريكي - للسحب على Payeer و Binance\n💰 الجنيه المصري - للسحب على المحافظ المحلية\n\n⚠️ يمكنك تغيير العملة في أي وقت من إعدادات المحفظة',
            TASK_ASSIGNED: '📧 تم تعيين مهمة إنشاء يوزر لك!\n\n📝 قم بإنشاء حساب جيميل باستخدام البيانات المحددة:\n\nالبريد الإلكتروني: {email}\nكلمة المرور: `{password}`{names}\n\n⏰ لديك 5 دقائق لإكمال المهمة\n\n⚠️ ستحصل على المكافأة بعد موافقة الأدمن\n\n❌ إذا لم تتمكن من إكمال المهمة، يرجى إلغاؤها',
            GMAIL_TASK_ASSIGNED: '', // Will be loaded from database settings
            TASK_COMPLETED: '✅ تم إرسال اليوزر للمراجعة!\nستحصل على المكافأة بعد موافقة الأدمن',
            TASK_TIMEOUT: '⏰ انتهت مدة المهمة! حاول مرة أخرى',
            USER_APPROVED: '✅ تم قبول اليوزر وإضافة المكافأة لرصيدك!',
            USER_REJECTED: '❌ تم رفض الحساب\n\n💡 تأكد من أنك أنشأت الحساب بشكل صحيح المرة القادمة\n📞 إذا هناك مشكلة، تواصل مع الدعم\n\n🌟 لا تيأس! يمكنك المحاولة مرة أخرى',
            INSUFFICIENT_BALANCE: '❌ رصيدك غير كافي للسحب',
            SUPPORT: '💬 للدعم تواصل مع الأدمن: @admin_username',
            ADMIN_WELCOME: '👑 مرحباً أيها الأدمن!',
            USER_BANNED: '🚫 تم حظرك من استخدام البوت',
            OPERATION_CANCELLED: '✅ تم إلغاء العملية',
            CHOOSE_TASKS: '🎯 اختر زر المهام لتبدأ رحلتك! 🚀',
            REFERRAL_REWARD_EARNED: '🎉 تهانينا! حصلت على مكافأة إحالة بقيمة {amount} لدعوة صديق أكمل مهمة بنجاح!',
            REFERRAL_CODE_GENERATED: '🔗 كود الإحالة الخاص بك:\n\n`{code}`\n\n📋 انسخ هذا الكود وشاركه مع أصدقائك\n💰 ستحصل على {reward} عندما يكمل صديقك مهمة واحدة ويحصل على موافقة الأدمن\n\n📤 شارك الرابط القابل للنقر أدناه مع أصدقائك!',
            REFERRAL_STATS: '📊 إحصائيات الإحالة:\n\n👥 إجمالي الإحالات: {total}\n✅ الإحالات المكتملة: {completed}\n💰 إجمالي الأرباح: {earned}\n\n🔗 كود الإحالة: `{code}`'
        },
        en: {
            WELCOME: '🎉 Welcome to the easiest and fastest way to earn money! 💰\n\n✨ Start your earning journey now ✨',
            LANGUAGE_SELECTION: '🌍 مرحباً بك! اختر لغتك المفضلة:\n\n🇸🇦 للعربية اضغط على الزر أدناه\n🇺🇸 For English press the button below\n\nWelcome! Choose your preferred language:',
            CURRENCY_SELECTION: '💱 Choose your preferred currency:\n\n💵 US Dollar - for Payeer and Binance withdrawals\n💰 Egyptian Pound - for local wallet withdrawals\n\n⚠️ You can change the currency anytime from wallet settings',
            TASK_ASSIGNED: '📧 Email creation task assigned!\n\n📝 Register a Gmail account using the specified data:\n\nEmail: {email}\nPassword: `{password}`{names}\n\n⏰ You have 5 minutes to complete the task\n\n⚠️ You will receive the reward after admin approval\n\n❌ If you are unable to complete the task, please cancel it',
            GMAIL_TASK_ASSIGNED: '', // Will be loaded from database settings
            TASK_COMPLETED: '✅ Account sent for review!\nYou will receive the reward after admin approval',
            TASK_TIMEOUT: '⏰ Task time expired! Try again',
            USER_APPROVED: '✅ Account approved and reward added to your balance!',
            USER_REJECTED: '❌ Account rejected\n\n💡 Make sure you create the account correctly next time\n📞 If there is a problem, contact support\n\n🌟 Don\'t give up! You can try again',
            INSUFFICIENT_BALANCE: '❌ Insufficient balance for withdrawal',
            SUPPORT: '💬 For support contact admin: @admin_username',
            ADMIN_WELCOME: '👑 Welcome Admin!',
            USER_BANNED: '🚫 You have been banned from using the bot',
            OPERATION_CANCELLED: '✅ Operation cancelled',
            CHOOSE_TASKS: '🎯 Choose Tasks button to start your journey! 🚀',
            REFERRAL_REWARD_EARNED: '🎉 Congratulations! You earned a referral reward of {amount} for inviting a friend who completed a task successfully!',
            REFERRAL_CODE_GENERATED: '🔗 Your referral code:\n\n`{code}`\n\n📋 Copy this code and share it with your friends\n💰 You will earn {reward} when your friend completes one task and gets admin approval\n\n📤 Share the clickable link below with your friends!',
            REFERRAL_STATS: '📊 Referral Statistics:\n\n👥 Total Referrals: {total}\n✅ Completed Referrals: {completed}\n💰 Total Earnings: {earned}\n\n🔗 Referral Code: `{code}`'
        }
    }
};