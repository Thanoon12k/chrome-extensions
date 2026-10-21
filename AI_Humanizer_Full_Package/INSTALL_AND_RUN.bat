@echo off
title Install DOCX Manual Rephrase Workbench v4
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
    set PY=py
) else (
    set PY=python
)

%PY% --version
if errorlevel 1 (
    echo Python was not found.
    echo Install Python 3.10+ and enable Add Python to PATH.
    pause
    exit /b 1
)

%PY% -m pip install -r requirements.txt
if errorlevel 1 (
    echo Installation failed.
    pause
    exit /b 1
)

%PY% docx_manual_rephrase_workbench_v4.py
pause
