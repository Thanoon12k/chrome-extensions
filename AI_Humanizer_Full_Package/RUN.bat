@echo off
title DOCX Manual Rephrase Workbench v4
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
    py docx_manual_rephrase_workbench_v4.py
) else (
    python docx_manual_rephrase_workbench_v4.py
)
pause
