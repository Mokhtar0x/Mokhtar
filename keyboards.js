// Multilingual keyboard layouts

const keyboards = {
    // Language selection keyboard
    languageSelection: {
        reply_markup: {
            keyboard: [
                [{ text: '🇸🇦 العربية' }, { text: '🇺🇸 English' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Currency selection keyboards
    currencySelectionAr: {
        reply_markup: {
            keyboard: [
                [{ text: '💵 الدولار الأمريكي' }],
                [{ text: '💰 الجنيه المصري' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    currencySelectionEn: {
        reply_markup: {
            keyboard: [
                [{ text: '💵 US Dollar' }],
                [{ text: '💰 Egyptian Pound' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Main user keyboards - Arabic only, no referral
    userKeyboardAr: {
        reply_markup: {
            keyboard: [
                [{ text: '📋 المهام' }],
                [{ text: '💰 المحفظة' }, { text: '💳 السحب' }],
                [{ text: '🆔 عرض الآيدي' }],
                [{ text: '💬 الدعم' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Admin keyboards - Arabic only
    adminKeyboardAr: {
        reply_markup: {
            keyboard: [
                [{ text: '👥 إدارة المستخدمين' }, { text: '📊 الإحصائيات' }],
                [{ text: '📱 مراجعة الجيميلات' }],
                [{ text: '💳 طلبات السحب' }, { text: '📨 إرسال رسالة' }],
                [{ text: '⚙️ إعدادات النظام' }, { text: '🎮 التحكم في المهام' }],
                [{ text: '📥 إدارة الإيميلات الجماعية' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Task menus - Gmail only
    tasksMenuAr: {
        reply_markup: {
            keyboard: [
                [{ text: '📱 مهمة إنشاء جيميل' }],
                [{ text: '🔙 العودة للقائمة الرئيسية' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    tasksMenuEn: {
        reply_markup: {
            keyboard: [
                [{ text: '📱 Gmail Creation Task' }],
                [{ text: '🔙 Back to Main Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Gmail task keyboards
    gmailTaskAr: {
        reply_markup: {
            keyboard: [
                [{ text: '✅ متابعة' }],
                [{ text: '❌ إلغاء المهمة' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    gmailTaskEn: {
        reply_markup: {
            keyboard: [
                [{ text: '✅ Continue' }],
                [{ text: '❌ Cancel Task' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Cancel keyboards
    cancelUserAr: {
        reply_markup: {
            keyboard: [
                [{ text: '❌ إلغاء' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    cancelUserEn: {
        reply_markup: {
            keyboard: [
                [{ text: '❌ Cancel' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    cancelAdminAr: {
        reply_markup: {
            keyboard: [
                [{ text: '❌ إلغاء' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    cancelAdminEn: {
        reply_markup: {
            keyboard: [
                [{ text: '❌ Cancel' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Currency change keyboards
    currencyChangeAr: {
        reply_markup: {
            keyboard: [
                [{ text: '💵 تغيير إلى الدولار' }],
                [{ text: '💰 تغيير إلى الجنيه' }],
                [{ text: '🔙 العودة للقائمة الرئيسية' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    currencyChangeEn: {
        reply_markup: {
            keyboard: [
                [{ text: '💵 Change to USD' }],
                [{ text: '💰 Change to EGP' }],
                [{ text: '🔙 Back to Main Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // User management keyboards (Admin)
    userManagementAr: {
        reply_markup: {
            keyboard: [
                [{ text: '🔍 البحث عن مستخدم' }],
                [{ text: '📊 آخر 10 مستخدمين' }],
                [{ text: '🔙 العودة لقائمة الأدمن' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    userManagementEn: {
        reply_markup: {
            keyboard: [
                [{ text: '🔍 Search User' }],
                [{ text: '📊 Last 10 Users' }],
                [{ text: '🔙 Back to Admin Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Message keyboards (Admin)
    messageKeyboardAr: {
        reply_markup: {
            keyboard: [
                [{ text: '📢 رسالة جماعية' }],
                [{ text: '👤 رسالة لشخص معين' }],
                [{ text: '🔙 العودة لقائمة الأدمن' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    messageKeyboardEn: {
        reply_markup: {
            keyboard: [
                [{ text: '📢 Broadcast Message' }],
                [{ text: '👤 Private Message' }],
                [{ text: '🔙 Back to Admin Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Settings keyboards (Admin) - Arabic only
    settingsKeyboardAr: {
        reply_markup: {
            keyboard: [
                [{ text: '💰 إعدادات المكافآت' }],
                [{ text: '💳 تغيير الحد الأدنى للسحب' }],
                [{ text: '💬 تعديل رسالة الدعم' }],
                [{ text: '🔙 العودة لقائمة الأدمن' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Task control keyboards (Admin) - Gmail only
    taskControlAr: {
        reply_markup: {
            keyboard: [
                [{ text: '📱 مهمة إنشاء الجيميل' }],
                [{ text: '🔙 العودة لقائمة الأدمن' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    taskControlEn: {
        reply_markup: {
            keyboard: [
                [{ text: '📱 Gmail Creation Task' }],
                [{ text: '🔙 Back to Admin Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Reward settings keyboards (Admin)
    rewardsSettingsAr: {
        reply_markup: {
            keyboard: [
                [{ text: '💰 مكافأة مهمة اليوزرات' }],
                [{ text: '📱 مكافأة مهمة الجيميل' }],
                [{ text: '🔗 مكافأة الإحالة' }],
                [{ text: '🔑 كلمة مرور الجيميل الموحدة' }],
                [{ text: '📝 تعديل نص مهمة الجيميل' }],
                [{ text: '🔙 العودة للإعدادات' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    rewardsSettingsEn: {
        reply_markup: {
            keyboard: [
                [{ text: '💰 Email Task Reward' }],
                [{ text: '📱 Gmail Task Reward' }],
                [{ text: '🔗 Referral Reward' }],
                [{ text: '🔑 Universal Gmail Password' }],
                [{ text: '📝 Edit Gmail Task Text' }],
                [{ text: '🔙 Back to Settings' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Referral system keyboards
    referralMenuAr: {
        reply_markup: {
            keyboard: [
                [{ text: '🔗 كود الإحالة' }],
                [{ text: '📊 إحصائيات الإحالة' }],
                [{ text: '👥 قائمة الإحالات' }],
                [{ text: '🔙 العودة للقائمة الرئيسية' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    referralMenuEn: {
        reply_markup: {
            keyboard: [
                [{ text: '🔗 Referral Code' }],
                [{ text: '📊 Referral Stats' }],
                [{ text: '👥 Referral List' }],
                [{ text: '🔙 Back to Main Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Referral reward settings keyboards (Admin)
    referralRewardSettingsAr: {
        reply_markup: {
            keyboard: [
                [{ text: '💰 مكافأة الإحالة بالجنيه' }],
                [{ text: '💵 مكافأة الإحالة بالدولار' }],
                [{ text: '🔙 العودة لإعدادات المكافآت' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    referralRewardSettingsEn: {
        reply_markup: {
            keyboard: [
                [{ text: '💰 Referral Reward EGP' }],
                [{ text: '💵 Referral Reward USD' }],
                [{ text: '🔙 Back to Reward Settings' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    // Bulk email management keyboards (Admin)
    bulkEmailManagementAr: {
        reply_markup: {
            keyboard: [
                [{ text: '📤 تصدير كل الإيميلات' }],
                [{ text: '✅ إرسال المقبولة وقبولها' }],
                [{ text: '❌ إرسال المرفوضة ورفضها' }],
                [{ text: '🔙 العودة لقائمة الأدمن' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    },

    bulkEmailManagementEn: {
        reply_markup: {
            keyboard: [
                [{ text: '📤 Export All Emails' }],
                [{ text: '✅ Send Approved & Approve' }],
                [{ text: '❌ Send Rejected & Reject' }],
                [{ text: '🔙 Back to Admin Menu' }]
            ],
            resize_keyboard: true,
            one_time_keyboard: false
        }
    }
};

// Helper function to get keyboard - Arabic only
function getKeyboard(keyboardName, language = 'ar') {
    // Always return Arabic version
    const fullKeyboardName = keyboardName + 'Ar';
    return keyboards[fullKeyboardName] || keyboards[keyboardName + 'Ar'];
}

// Dynamic function to create tasks menu with rewards - Arabic only
function createTasksMenuWithRewards(language = 'ar', emailReward = '', gmailReward = '') {
    const backButton = '🔙 العودة للقائمة الرئيسية';

    if (gmailReward) {
        // Create button with reward
        const gmailButton = `📱 مهمة إنشاء جيميل - ${gmailReward}`;

        return {
            reply_markup: {
                keyboard: [
                    [{ text: gmailButton }],
                    [{ text: backButton }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };
    } else {
        // Fallback to original button without reward
        const gmailButton = '📱 مهمة إنشاء جيميل';

        return {
            reply_markup: {
                keyboard: [
                    [{ text: gmailButton }],
                    [{ text: backButton }]
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };
    }
}

module.exports = {
    ...keyboards,
    getKeyboard,
    createTasksMenuWithRewards
};