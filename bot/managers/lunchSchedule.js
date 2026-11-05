
const DEFAULT_MINUTES = 450;
function sendMinutes(value) { return Number.isInteger(value) && value >= 0 && value < 1440 ? value : DEFAULT_MINUTES; }
function formatTime(value) { const n = sendMinutes(value); return String(Math.floor(n / 60)).padStart(2, "0") + ":" + String(n % 60).padStart(2, "0"); }
function isDue(row, day, minutes, date) { const start = sendMinutes(row.send_minutes); return day >= 1 && day <= 5 && row.last_sent !== date && minutes >= start && minutes < Math.min(start + 150, 1440); }
module.exports = { sendMinutes, formatTime, isDue };
