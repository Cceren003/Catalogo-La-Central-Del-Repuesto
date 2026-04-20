@echo off
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0\.."
npx -y serve -l 8123 .
