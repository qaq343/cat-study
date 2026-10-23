@echo off
cd /d "%~dp0src-tauri"
"%USERPROFILE%\.cargo\bin\cargo.exe" tauri build
