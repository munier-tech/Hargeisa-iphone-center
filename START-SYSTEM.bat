@echo off
title HARGEISA IPHONE CENTER - Server
cd /d "%~dp0"

rem ---- find Python (PATH first, then the per-user install)
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PY (
  echo Python was not found. Install it once with:
  echo    winget install -e --id Python.Python.3.12
  echo then run this file again.
  pause & exit /b 1
)

rem ---- install the required packages the first time (Flask, waitress, bcrypt, cryptography, psycopg)
"%PY%" -c "import flask,waitress,bcrypt,cryptography,psycopg,psycopg_pool" >nul 2>nul || (
  echo Installing required packages...
  "%PY%" -m pip install --disable-pip-version-check -r requirements.txt
)

rem ---- the PostgreSQL (Neon) connection string: DATABASE_URL environment variable or the .env file
if not defined DATABASE_URL if not exist ".env" (
  echo DATABASE_URL is not set. Copy .env.example to .env and put your Neon connection string in it,
  echo or set it once with:  setx DATABASE_URL "postgresql://..."   ^(then open a new window^)
  pause & exit /b 1
)

echo ==================================================
echo   HARGEISA IPHONE CENTER  -  Hubsiimo iyo Degdegsiimo
echo ==================================================
echo   Staff system   : http://localhost:8080
echo   Customer portal: http://localhost:8080/portal
echo   Phones on the same Wi-Fi: use this PC's IP, e.g. http://192.168.x.x:8080
echo   Default login  : admin@hic.so  /  Admin@123   (change it in My Profile)
echo   Press CTRL+C to stop.
echo ==================================================
start "" http://localhost:8080
"%PY%" server\app.py
pause
