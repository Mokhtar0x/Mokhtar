@echo off
echo ========================================
echo    Bot Health Check
echo    فحص صحة البوت
echo ========================================
echo.

echo [1/6] Checking Node.js installation...
echo [1/6] فحص تثبيت Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Node.js not installed!
    echo [X] Node.js غير مثبت!
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo يرجى تثبيت Node.js من: https://nodejs.org
    pause
    exit /b 1
) else (
    node --version
    echo [OK] Node.js installed
    echo [OK] Node.js مثبت
)
echo.

echo [2/6] Checking required files...
echo [2/6] فحص الملفات المطلوبة...
set missing=0

if not exist bot.js (
    echo [X] bot.js missing!
    echo [X] bot.js مفقود!
    set missing=1
) else (
    echo [OK] bot.js found
    echo [OK] bot.js موجود
)

if not exist config.js (
    echo [X] config.js missing!
    echo [X] config.js مفقود!
    set missing=1
) else (
    echo [OK] config.js found
    echo [OK] config.js موجود
)

if not exist database.js (
    echo [X] database.js missing!
    echo [X] database.js مفقود!
    set missing=1
) else (
    echo [OK] database.js found
    echo [OK] database.js موجود
)

if not exist keyboards.js (
    echo [X] keyboards.js missing!
    echo [X] keyboards.js مفقود!
    set missing=1
) else (
    echo [OK] keyboards.js found
    echo [OK] keyboards.js موجود
)

if not exist package.json (
    echo [X] package.json missing!
    echo [X] package.json مفقود!
    set missing=1
) else (
    echo [OK] package.json found
    echo [OK] package.json موجود
)

if %missing% equ 1 (
    echo.
    echo [X] Some files are missing!
    echo [X] بعض الملفات مفقودة!
    pause
    exit /b 1
)
echo.

echo [3/6] Checking node_modules...
echo [3/6] فحص المكتبات...
if not exist node_modules (
    echo [!] node_modules not found
    echo [!] المكتبات غير موجودة
    echo.
    echo Installing dependencies...
    echo جاري تثبيت المكتبات...
    call npm install
    if %errorlevel% neq 0 (
        echo [X] Failed to install dependencies!
        echo [X] فشل تثبيت المكتبات!
        pause
        exit /b 1
    )
) else (
    echo [OK] node_modules found
    echo [OK] المكتبات موجودة
)
echo.

echo [4/6] Checking syntax...
echo [4/6] فحص الأخطاء...
node -c bot.js >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Syntax error in bot.js!
    echo [X] خطأ في bot.js!
    node -c bot.js
    pause
    exit /b 1
) else (
    echo [OK] bot.js syntax OK
    echo [OK] bot.js بدون أخطاء
)

node -c config.js >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Syntax error in config.js!
    echo [X] خطأ في config.js!
    node -c config.js
    pause
    exit /b 1
) else (
    echo [OK] config.js syntax OK
    echo [OK] config.js بدون أخطاء
)

node -c database.js >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Syntax error in database.js!
    echo [X] خطأ في database.js!
    node -c database.js
    pause
    exit /b 1
) else (
    echo [OK] database.js syntax OK
    echo [OK] database.js بدون أخطاء
)

node -c keyboards.js >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Syntax error in keyboards.js!
    echo [X] خطأ في keyboards.js!
    node -c keyboards.js
    pause
    exit /b 1
) else (
    echo [OK] keyboards.js syntax OK
    echo [OK] keyboards.js بدون أخطاء
)
echo.

echo [5/6] Checking if bot is running...
echo [5/6] فحص إذا كان البوت يعمل...
tasklist /FI "IMAGENAME eq node.exe" 2>NUL | find /I /N "node.exe">NUL
if %errorlevel% equ 0 (
    echo [!] Bot is already running!
    echo [!] البوت يعمل بالفعل!
    echo.
    echo Running processes:
    echo العمليات الجارية:
    tasklist /FI "IMAGENAME eq node.exe"
) else (
    echo [OK] Bot is not running
    echo [OK] البوت غير مشغل
)
echo.

echo [6/6] Checking logs directory...
echo [6/6] فحص مجلد السجلات...
if not exist logs (
    echo [!] logs directory not found, creating...
    echo [!] مجلد السجلات غير موجود، جاري الإنشاء...
    mkdir logs
    echo [OK] logs directory created
    echo [OK] تم إنشاء مجلد السجلات
) else (
    echo [OK] logs directory exists
    echo [OK] مجلد السجلات موجود
)
echo.

echo ========================================
echo    Health Check Complete!
echo    اكتمل الفحص!
echo ========================================
echo.
echo [OK] All checks passed!
echo [OK] جميع الفحوصات نجحت!
echo.
echo Bot is ready to start!
echo البوت جاهز للتشغيل!
echo.
echo To start the bot, run: start-bot.bat
echo لتشغيل البوت، قم بتشغيل: start-bot.bat
echo.
pause
