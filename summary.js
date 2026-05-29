import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const thaiMonths = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const thaiDows = ["อา","จ","อ","พ","พฤ","ศ","ส"];
let latestRows = [];
let latestHistory = [];
let latestConfig = {};

window.downloadCSV = downloadCSV;

init();

function init() {
  if (firebaseConfig.apiKey.includes("PASTE_")) {
    setStatus("ยังไม่ได้ใส่ Firebase config จึงโหลดข้อมูลออนไลน์ไม่ได้", "warn");
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const id = currentScheduleId();

  onSnapshot(doc(db, "schedules", id), (snap) => {
    if (!snap.exists()) {
      setStatus("ยังไม่มีตารางสำหรับเดือนนี้ ให้หัวหน้าสร้างตารางที่หน้าแก้ไขก่อน", "warn");
      return;
    }
    const data = snap.data();
    latestRows = data.rows || [];
    latestHistory = data.history || [];
    latestConfig = data.currentConfig || {};
    render(data);
  }, (err) => {
    setStatus("โหลดข้อมูลไม่สำเร็จ: " + err.message, "warn");
  });
}

function currentScheduleId() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function setStatus(text, cls) {
  const el = document.getElementById("status");
  el.className = cls;
  el.textContent = text;
}

function render(data) {
  const cfg = data.currentConfig || {};
  const rows = data.rows || [];
  const history = data.history || [];
  setStatus("กำลังแสดงตารางล่าสุดแบบ realtime", "status");

  const monthName = cfg.month !== undefined ? thaiMonths[cfg.month] : "-";
  document.getElementById("latestInfo").innerHTML = `
    <div class="statgrid">
      <div class="stat"><b>${monthName}</b>เดือน</div>
      <div class="stat"><b>${cfg.year || "-"}</b>ปี</div>
      <div class="stat"><b>${esc(data.updatedAtText || "-")}</b>อัปเดตล่าสุด</div>
      <div class="stat"><b>${esc(data.updatedBy || "-")}</b>แก้ไขโดย</div>
    </div>
    <div>สถานะ: <b>ตารางล่าสุดที่ใช้งานอยู่</b></div>
  `;

  renderPersonSummary(buildPersonSummary(rows), [...new Set([...(cfg.morning || []), ...(cfg.night || [])])]);
  renderCalendar(cfg.year, cfg.month, rows);
  renderHistory(history);
}

function buildPersonSummary(rows) {
  const out = {};
  rows.forEach(r => {
    r.morningOff.forEach(n => { if(!out[n]) out[n]=[]; out[n].push({date:r.displayDate, iso:r.date, shift:"กะเช้า", period:r.period}); });
    r.nightOff.forEach(n => { if(!out[n]) out[n]=[]; out[n].push({date:r.displayDate, iso:r.date, shift:"กะดึก", period:r.period}); });
  });
  return out;
}

function renderPersonSummary(personOff, all) {
  if (!all.length) {
    document.getElementById("personSummary").innerHTML = "ยังไม่มีรายชื่อพนักงาน";
    return;
  }

  let html = `<div class="person-grid">`;
  all.sort((a,b)=>a.localeCompare(b)).forEach(name => {
    const items = personOff[name] || [];
    html += `<div class="person-card"><div class="person-name">${esc(name)} <span class="small">(${items.length} วัน)</span></div>`;
    if (!items.length) html += `<span class="small">ยังไม่ได้วันหยุด</span>`;
    items.forEach(i => html += `<span class="date-pill">${esc(i.date)} — ${esc(i.shift)} — ${esc(i.period)}</span>`);
    html += `</div>`;
  });
  html += `</div>`;
  document.getElementById("personSummary").innerHTML = html;
}

function renderHistory(history) {
  if (!history.length) {
    document.getElementById("history").innerHTML = "ยังไม่มีประวัติ";
    return;
  }
  let html = `<table><tr><th>เวลา</th><th>ผู้แก้ไข</th><th>รายการ</th></tr>`;
  [...history].reverse().slice(0, 20).forEach(h => {
    html += `<tr><td>${esc(h.time || "")}</td><td>${esc(h.editor || "")}</td><td>${esc(h.text || "")}</td></tr>`;
  });
  html += `</table>`;
  document.getElementById("history").innerHTML = html;
}

function renderCalendar(year, month, rows) {
  if (!rows.length || year === undefined || month === undefined) {
    document.getElementById("calendar").innerHTML = "ยังไม่มีปฏิทิน";
    return;
  }

  const byDay = {}; rows.forEach(r => byDay[r.day] = r);
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();

  let html = `<div class="calendar">`;
  thaiDows.forEach(d => html += `<div class="dow">${d}</div>`);
  for (let i = 0; i < first; i++) html += `<div class="day empty"></div>`;
  for (let d = 1; d <= days; d++) {
    const r = byDay[d];
    html += `<div class="day ${r?.isBusy ? "busy-day" : ""}">
      <div class="date-num">${d}</div>
      <div class="period">${esc(r?.period || "")}</div>
      ${r?.isBusy ? `<div class="busy-label">ห้ามหยุด</div>` : ""}
      ${shiftBlock("morning","กะเช้า",r?.morningOff || [], r?.morningWork || [])}
      ${shiftBlock("night","กะดึก",r?.nightOff || [], r?.nightWork || [])}
    </div>`;
  }
  html += `</div>`;
  document.getElementById("calendar").innerHTML = html;
}

function shiftBlock(cls,title,off,work) {
  return `<div class="shift ${cls}"><b>${title}</b><br>หยุด: ${pill(off,"off")}<br>ทำงาน: ${pill(work,"work")}</div>`;
}
function pill(list,type) {
  if(!list.length) return "—";
  const cls = type === "work" ? "work" : "off";
  return list.map(x=>`<span class="${cls}">${esc(x)}</span>`).join("");
}

function downloadCSV() {
  if (!latestRows.length) return alert("ยังไม่มีข้อมูลให้ดาวน์โหลด");
  const personRows = [];
  const personOff = buildPersonSummary(latestRows);
  Object.entries(personOff).forEach(([name,items]) => personRows.push([name, items.map(i=>`${i.date} ${i.shift} ${i.period}`).join(" | ")]));
  const historyRows = latestHistory.map(h => [h.time, h.editor, h.text]);

  const csv = [
    ["Date","Period","Status","Morning Off","Morning Working","Night Off","Night Working"],
    ...latestRows.map(r=>[r.date,r.period,r.isBusy?"ห้ามหยุด":"สุ่มวันหยุด",r.morningOff.join(" | "),r.morningWork.join(" | "),r.nightOff.join(" | "),r.nightWork.join(" | ")]),
    [], ["Person","Days Off"], ...personRows,
    [], ["Time","Editor","History"], ...historyRows
  ].map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "latest-holiday-summary.csv"; a.click();
  URL.revokeObjectURL(url);
}

function esc(str) {
  return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
