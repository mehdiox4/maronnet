@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Installez la version 22 LTS ou plus recente : https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set MAJ=%%v
if %MAJ% LSS 22 (
  echo Node.js 22.13 ou plus recent est requis. Version actuelle :
  node -v
  echo Telechargez la derniere version LTS : https://nodejs.org
  pause & exit /b 1
)
if /i "%~1"=="demo" (
  echo Chargement des donnees de DEMONSTRATION fictives...
  node server\demo.js
)
echo.
echo Demarrage de MARONET 360 - ouvrez http://localhost:3000 dans votre navigateur.
echo Pour arreter : fermez cette fenetre ou Ctrl+C.
node server\index.js
pause
