@echo off
rem sqlmap launcher: uses the bundled source in tools/sqlmap
setlocal
set "HERE=%~dp0"
python "%HERE%..\sqlmap\sqlmap.py" %*
