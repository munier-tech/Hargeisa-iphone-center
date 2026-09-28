@echo off
title Reset HARGEISA IPHONE CENTER database
cd /d "%~dp0"
echo.
echo   The system's data is now stored in PostgreSQL (Neon), not in data\hic.sqlite.
echo   This script no longer deletes anything - data\hic.sqlite is kept as an archive of the old data.
echo.
echo   To start with a clean database: create a new, empty database (or branch) in the Neon console,
echo   put its connection string in DATABASE_URL (or the .env file) and start the system again.
echo   The tables and the default login admin@hic.so / Admin@123 are then created automatically.
echo.
pause
