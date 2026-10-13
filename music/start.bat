@echo off
cd /d "%~dp0"
if not exist Lavalink.jar (
  echo Lavalink.jar not found. Download from https://github.com/lavalink-devs/Lavalink/releases and put it in this folder.
  pause
  exit /b 1
)
java -Xmx512m -jar Lavalink.jar
