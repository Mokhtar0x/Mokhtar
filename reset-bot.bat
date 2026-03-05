@echo off
echo ========================================
echo    Bot Reset Script
echo    اعادة تعيين البوت
echo ========================================
echo.

REM Stop any running bot processes
echo [1/5] Stopping bot processes...
echo [1/5] ايقاف عمليات البوت...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Backup current database
echo [2/5] Creating backup...
echo [2/5] انشاء نسخة احتياطية...
if exist bot_database.db (
    set timestamp=%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
    set timestamp=%timestamp: =0%
    copy bot_database.db "backup_%timestamp%_bot_database.db" >nul
    echo Backup created: backup_%timestamp%_bot_database.db
    echo تم انشاء النسخة الاحتياطية
)

REM Delete old database files
echo [3/5] Deleting old database...
echo [3/5] حذف قاعدة البيانات القديمة...
if exist bot_database.db del /F /Q bot_database.db
if exist bot_database.db-shm del /F /Q bot_database.db-shm
if exist bot_database.db-wal del /F /Q bot_database.db-wal

REM Clear logs
echo [4/5] Clearing logs...
echo [4/5] مسح السجلات...
if exist logs\errors.log del /F /Q logs\errors.log
if exist logs\activity.log del /F /Q logs\activity.log

REM Start fresh bot
echo [5/5] Starting fresh bot...
echo [5/5] بدء البوت من جديد...
echo.
echo ========================================
echo    Bot reset complete!
echo    تم اعادة تعيين البوت بنجاح!
echo ========================================
echo.
echo Starting bot in 3 seconds...
echo سيبدأ البوت خلال 3 ثواني...
timeout /t 3 /nobreak >nul

start cmd /k "node bot.js"

echo.
echo Bot started in new window!
echo تم بدء البوت في نافذة جديدة!
echo.
pause
