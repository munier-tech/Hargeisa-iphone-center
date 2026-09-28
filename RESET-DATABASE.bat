@echo off
title Reset HARGEISA IPHONE CENTER database
cd /d "%~dp0"
echo.
echo   WARNING: this permanently deletes ALL data (customers, repairs, stock, users, settings).
echo   The system will start again fresh with admin@hic.so / Admin@123.
echo   Make sure the server window is closed first.
echo.
set /p OK=Type YES to continue:
if /i not "%OK%"=="YES" (echo Cancelled. & pause & exit /b)
if exist data\hic.sqlite del /q data\hic.sqlite
if exist data\hic.sqlite-wal del /q data\hic.sqlite-wal
if exist data\hic.sqlite-shm del /q data\hic.sqlite-shm
echo Done. Start the system again with START-SYSTEM.bat
pause
