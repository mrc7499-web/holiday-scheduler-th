import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

let db = null;
let unsubscribe = null;
let lastRows = [];
let lastPersonOff = {};
let lastStats = {};
let swapHistory = [];
let currentConfig = {};
let applyingRemote = false;

const thaiMonths = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const thaiDows = ["อา","จ","อ","พ","พฤ","ศ","ส"];

window.runScheduler = runScheduler;
window.swapHoliday = swapHoliday;
window.downloadCSV = downloadCSV;
window.clearLocalOnly = clearLocalOnly;

init();

async function init() {
  initMonth();
  refreshSwapControls();

  try {
    if (firebaseConfig.apiKey.includes("PASTE_")) {
      setStatus("ยังไม่ได้ใส่ Firebase config — เปิดแบบ offline ได้ แต่ยังไม่ออนไลน์", "warn");
      return;
    }
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    listenCurrentSchedule();
    setStatus("เชื่อมต่อ Firebase แล้ว — ข้อมูลจะ sync แบบ realtime", "ok");
  } catch (err) {
    setStatus("เชื่อมต่อ Firebase ไม่สำเร็จ: " + err.message, "warn");
  }
}

function setStatus(text, cls) {
  const el = document.getElementById("onlineStatus");
  el.className = cls;
  el.textContent = text;
}

function scheduleId() {
  const y = document.getElementById("year").value;
  const m = String(Number(document.getElementById("month").value) + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function listenCurrentSchedule() {
  if (!db) return;
  if (unsubscribe) unsubscribe();

  const ref = doc(db, "schedules", scheduleId());
  unsubscribe = onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    const data = snap.data();
    applyingRemote = true;
    currentConfig = data.currentConfig || {};
    lastRows = data.rows || [];
    swapHistory = data.history || [];
    hydrateInputsFromConfig(currentConfig);
    rebuildAll(false);
    applyingRemote = false;
  }, (err) => setStatus("อ่านข้อมูลออนไลน์ไม่สำเร็จ: " + err.message, "warn"));
}

async function saveOnline(actionText) {
  if (!db || applyingRemote) return;
  const editor = document.getElementById("editorName").value.trim() || "ไม่ระบุชื่อ";
  const history = [...swapHistory];
  if (actionText) {
    history.push({ time: new Date().toLocaleString("th-TH"), editor, text: actionText });
  }
  swapHistory = history;

  await setDoc(doc(db, "schedules", scheduleId()), {
    currentConfig,
    rows: lastRows,
    history: swapHistory,
    updatedAt: serverTimestamp(),
    updatedAtText: new Date().toLocaleString("th-TH"),
    updatedBy: editor,
    scheduleIdText: scheduleId()
  }, { merge: true });
}

function initMonth() {
  const now = new Date();
  const m = document.getElementById("month");
  thaiMonths.forEach((name, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = name;
    if (i === now.getMonth()) opt.selected = true;
    m.appendChild(opt);
  });
  document.getElementById("year").value = now.getFullYear();
  document.getElementById("month").onchange = listenCurrentSchedule;
  document.getElementById("year").onchange = listenCurrentSchedule;
}

function hydrateInputsFromConfig(cfg) {
  if (!cfg || cfg.month === undefined) return;
  document.getElementById("month").value = cfg.month;
  document.getElementById("year").value = cfg.year;
  document.getElementById("busyDates").value = [...(cfg.busyDaysArray || [])].join("\n");
  document.getElementById("morningEmployees").value = (cfg.morning || []).join("\n");
  document.getElementById("nightEmployees").value = (cfg.night || []).join("\n");
  document.getElementById("morningCapacity").value = cfg.morningCap ?? 1;
  document.getElementById("nightCapacity").value = cfg.nightCap ?? 1;
  document.getElementById("targetDays").value = cfg.target ?? 4;
  document.getElementById("maxDays").value = cfg.maxDays ?? 6;
  document.getElementById("minGap").value = cfg.minGap ?? 2;
  document.getElementById("reserveEndMonth").checked = !!cfg.reserveEndMonth;
  document.getElementById("spreadPeriods").checked = !!cfg.spreadPeriods;
}

function splitText(id) { return document.getElementById(id).value.split(/\n|,| /).map(x=>x.trim()).filter(Boolean); }
function employees(id) { return document.getElementById(id).value.split(/\n/).map(x=>x.trim()).filter(Boolean); }
function getBusyDaysArray() { return splitText("busyDates").map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=31); }
function iso(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function thaiShort(d){return `${d.getDate()} ${thaiMonths[d.getMonth()]}`;}
function periodOfDay(day) { if (day <= 10) return "ต้นเดือน"; if (day <= 20) return "กลางเดือน"; return "สิ้นเดือน"; }
function monthDates(year, month) { const days = new Date(year, month+1, 0).getDate(); return Array.from({length:days}, (_,i)=>new Date(year,month,i+1)); }
function daysBetweenIso(a, b) { return Math.abs((new Date(a+"T00:00:00") - new Date(b+"T00:00:00")) / 86400000); }
function initStats(all) { const s = {}; all.forEach(n => s[n] = { total:0, periods:{"ต้นเดือน":0,"กลางเดือน":0,"สิ้นเดือน":0}, dates:[] }); return s; }

function periodLimit(target, period, reserveEndMonth) {
  if (!reserveEndMonth) return target;
  const endQuota = Math.max(1, Math.floor(target / 3));
  const midQuota = Math.max(1, Math.floor(target / 3));
  const earlyQuota = Math.max(1, target - midQuota - endQuota);
  if (period === "ต้นเดือน") return earlyQuota;
  if (period === "กลางเดือน") return earlyQuota + midQuota;
  return target;
}
function isTooClose(name, dateIso, stats, minGap) {
  return stats[name].dates.some(d => daysBetweenIso(d, dateIso) <= minGap);
}
function scoreCandidate(name, dateObj, stats, target, maxDays, minGap, spreadPeriods, reserveEndMonth) {
  const dateIso = iso(dateObj), st = stats[name], period = periodOfDay(dateObj.getDate());
  if (st.total >= maxDays) return -99999;
  if (isTooClose(name, dateIso, stats, minGap)) return -99999;
  const allowedByNow = periodLimit(target, period, reserveEndMonth);
  if (st.total >= allowedByNow && period !== "สิ้นเดือน") return -99999;
  let score = (target - st.total) * 120 + Math.random() * 8;
  if (spreadPeriods) {
    if (st.periods[period] === 0) score += 120;
    if (st.periods[period] >= 1) score -= 45 * st.periods[period];
    if (period === "สิ้นเดือน" && st.periods["สิ้นเดือน"] === 0) score += 160;
    if (period === "กลางเดือน" && st.periods["กลางเดือน"] === 0) score += 80;
  }
  return score;
}
function pickForShift(list, stats, maxDays, target, capacity, dateObj, minGap, spreadPeriods, reserveEndMonth) {
  if (capacity <= 0) return [];
  const selected = [];
  for (let i=0; i<capacity; i++) {
    const candidates = list.filter(n => !selected.includes(n))
      .map(n => ({ name:n, score:scoreCandidate(n,dateObj,stats,target,maxDays,minGap,spreadPeriods,reserveEndMonth) }))
      .filter(x => x.score > -90000)
      .sort((a,b) => b.score - a.score);
    if (!candidates.length) break;
    const best = candidates[0].name;
    selected.push(best);
    const p = periodOfDay(dateObj.getDate());
    stats[best].total += 1;
    stats[best].periods[p] += 1;
    stats[best].dates.push(iso(dateObj));
  }
  return selected;
}
function workers(list, off) { const s = new Set(off); return list.filter(n=>!s.has(n)); }

async function runScheduler() {
  const month = Number(document.getElementById("month").value);
  const year = Number(document.getElementById("year").value);
  const busyDaysArray = getBusyDaysArray();
  const busyDays = new Set(busyDaysArray);
  const morning = employees("morningEmployees");
  const night = employees("nightEmployees");
  const morningCap = Number(document.getElementById("morningCapacity").value);
  const nightCap = Number(document.getElementById("nightCapacity").value);
  const target = Number(document.getElementById("targetDays").value);
  const maxDays = Number(document.getElementById("maxDays").value);
  const minGap = Number(document.getElementById("minGap").value);
  const reserveEndMonth = document.getElementById("reserveEndMonth").checked;
  const spreadPeriods = document.getElementById("spreadPeriods").checked;

  if ((!morning.length && !night.length) || !year || target < 1 || maxDays < target) {
    alert("กรุณากรอกข้อมูลให้ครบ และให้วันหยุดสูงสุดมากกว่าหรือเท่ากับวันหยุดเป้าหมาย");
    return;
  }
  if (morning.length && morningCap > morning.length) return alert("กะเช้าตั้งจำนวนคนหยุดมากกว่าจำนวนพนักงาน");
  if (night.length && nightCap > night.length) return alert("กะดึกตั้งจำนวนคนหยุดมากกว่าจำนวนพนักงาน");

  const all = [...new Set([...morning, ...night])];
  const stats = initStats(all);
  const dates = monthDates(year, month);

  const rows = dates.map(dateObj => {
    const day = dateObj.getDate();
    const isBusy = busyDays.has(day);
    let mo = [], no = [];
    if (!isBusy) {
      mo = pickForShift(morning, stats, maxDays, target, morningCap, dateObj, minGap, spreadPeriods, reserveEndMonth);
      no = pickForShift(night, stats, maxDays, target, nightCap, dateObj, minGap, spreadPeriods, reserveEndMonth);
    }
    return { dateObj: dateObj.toISOString(), date: iso(dateObj), day, displayDate: thaiShort(dateObj), period: periodOfDay(day), isBusy,
      morningOff: mo, morningWork: workers(morning, mo), nightOff: no, nightWork: workers(night, no) };
  });

  currentConfig = { month, year, busyDaysArray, morning, night, morningCap, nightCap, target, maxDays, minGap, reserveEndMonth, spreadPeriods };
  lastRows = rows;
  swapHistory = [];
  rebuildAll(false);
  await saveOnline("สร้างตารางใหม่");
}

function rebuildAll(save = false) {
  const all = [...new Set([...(currentConfig.morning || []), ...(currentConfig.night || [])])];
  lastPersonOff = buildPersonSummary(lastRows);
  lastStats = rebuildStats(all, lastRows);
  document.getElementById("calendarTitle").textContent = currentConfig.month === undefined ? "ยังไม่ได้สร้างปฏิทิน" : `${thaiMonths[currentConfig.month]} ${currentConfig.year}`;
  renderCalendar(currentConfig.year, currentConfig.month, lastRows);
  renderSummary(lastRows, lastStats, currentConfig);
  renderPersonSummary(lastPersonOff, all);
  renderSwapHistory();
  refreshSwapControls();
}
function buildPersonSummary(rows) {
  const out = {};
  rows.forEach(r => {
    r.morningOff.forEach(n => { if(!out[n]) out[n]=[]; out[n].push({date:r.displayDate, iso:r.date, shift:"กะเช้า", period:r.period}); });
    r.nightOff.forEach(n => { if(!out[n]) out[n]=[]; out[n].push({date:r.displayDate, iso:r.date, shift:"กะดึก", period:r.period}); });
  });
  return out;
}
function rebuildStats(all, rows) {
  const stats = initStats(all);
  rows.forEach(r => {
    [...r.morningOff, ...r.nightOff].forEach(name => {
      if (!stats[name]) stats[name] = { total:0, periods:{"ต้นเดือน":0,"กลางเดือน":0,"สิ้นเดือน":0}, dates:[] };
      stats[name].total++;
      stats[name].periods[r.period]++;
      stats[name].dates.push(r.date);
    });
  });
  return stats;
}

function refreshSwapControls() {
  const from = document.getElementById("swapFrom"), fromDate = document.getElementById("swapFromDate"), to = document.getElementById("swapTo"), toDate = document.getElementById("swapToDate");
  [from, fromDate, to, toDate].forEach(el => el.innerHTML = "");
  const names = Object.keys(lastPersonOff).sort((a,b)=>a.localeCompare(b));
  if (!names.length) {
    [from, to].forEach(el => el.innerHTML = `<option value="">ยังไม่มีตาราง</option>`);
    [fromDate, toDate].forEach(el => el.innerHTML = `<option value="">ยังไม่มีวันหยุด</option>`);
    return;
  }
  names.forEach(name => from.innerHTML += `<option value="${escAttr(name)}">${esc(name)}</option>`);
  fillFromDateSelect(); fillToPersonSelect(); fillToDateSelect();
  from.onchange = () => { fillFromDateSelect(); fillToPersonSelect(); fillToDateSelect(); };
  fromDate.onchange = () => { fillToPersonSelect(); fillToDateSelect(); };
  to.onchange = () => fillToDateSelect();
}
function fillFromDateSelect() {
  const person = document.getElementById("swapFrom").value;
  const dateSelect = document.getElementById("swapFromDate");
  dateSelect.innerHTML = "";
  const items = lastPersonOff[person] || [];
  if (!items.length) return dateSelect.innerHTML = `<option value="">ไม่มีวันหยุด</option>`;
  items.forEach(item => dateSelect.innerHTML += `<option value="${escAttr(item.iso)}">${esc(item.date)} — ${esc(item.shift)}</option>`);
}
function selectedFromShift() {
  return getShiftForPersonOnDate(document.getElementById("swapFrom").value, document.getElementById("swapFromDate").value);
}
function fillToPersonSelect() {
  const fromPerson = document.getElementById("swapFrom").value;
  const shift = selectedFromShift();
  const to = document.getElementById("swapTo");
  to.innerHTML = "";
  const names = Object.keys(lastPersonOff)
    .filter(name => name !== fromPerson)
    .filter(name => isPersonInShift(name, shift))
    .filter(name => (lastPersonOff[name] || []).some(item => getShiftForPersonOnDate(name, item.iso) === shift))
    .sort((a,b)=>a.localeCompare(b));
  if (!names.length) return to.innerHTML = `<option value="">ไม่มีเพื่อนในกะเดียวกันที่มีวันหยุดให้แลก</option>`;
  names.forEach(name => to.innerHTML += `<option value="${escAttr(name)}">${esc(name)}</option>`);
}
function fillToDateSelect() {
  const person = document.getElementById("swapTo").value;
  const shift = selectedFromShift();
  const dateSelect = document.getElementById("swapToDate");
  dateSelect.innerHTML = "";
  const items = (lastPersonOff[person] || []).filter(item => getShiftForPersonOnDate(person, item.iso) === shift);
  if (!items.length) return dateSelect.innerHTML = `<option value="">ไม่มีวันหยุดในกะเดียวกัน</option>`;
  items.forEach(item => dateSelect.innerHTML += `<option value="${escAttr(item.iso)}">${esc(item.date)} — ${esc(item.shift)}</option>`);
}
function findRow(dateIso) { return lastRows.find(r => r.date === dateIso); }
function removeName(arr, name) { const idx = arr.indexOf(name); if (idx >= 0) arr.splice(idx, 1); }
function addUnique(arr, name) { if (!arr.includes(name)) arr.push(name); }
function getShiftForPersonOnDate(person, dateIso) {
  const r = findRow(dateIso);
  if (!r) return null;
  if (r.morningOff.includes(person)) return "morning";
  if (r.nightOff.includes(person)) return "night";
  return null;
}
function isPersonInShift(person, shift) {
  if (shift === "morning") return (currentConfig.morning || []).includes(person);
  if (shift === "night") return (currentConfig.night || []).includes(person);
  return false;
}
function validateSwap(a, dateA, b, dateB) {
  if (!a || !b || !dateA || !dateB) return "กรุณาเลือกข้อมูลให้ครบ";
  if (a === b) return "ไม่สามารถสลับกับตัวเองได้";
  if (dateA === dateB) return "ไม่ควรสลับวันเดียวกัน";
  const rowA = findRow(dateA), rowB = findRow(dateB);
  if (!rowA || !rowB) return "ไม่พบวันที่ในตาราง";
  if (rowA.isBusy || rowB.isBusy) return "ไม่สามารถสลับเข้าวันห้ามหยุดได้";
  const shiftA = getShiftForPersonOnDate(a, dateA), shiftB = getShiftForPersonOnDate(b, dateB);
  if (!shiftA || !shiftB) return "ต้องเลือกวันที่เป็นวันหยุดจริงของทั้งสองคน";
  if (shiftA !== shiftB) return "สลับข้ามกะไม่ได้: กะเช้าต้องแลกกะเช้า และกะดึกต้องแลกกะดึกเท่านั้น";
  return "";
}
async function swapHoliday() {
  if (!lastRows.length) return alert("กรุณาสร้างปฏิทินก่อน");
  const a = document.getElementById("swapFrom").value, dateA = document.getElementById("swapFromDate").value;
  const b = document.getElementById("swapTo").value, dateB = document.getElementById("swapToDate").value;
  const error = validateSwap(a, dateA, b, dateB);
  if (error) return alert(error);
  const rowA = findRow(dateA), rowB = findRow(dateB);
  const shift = getShiftForPersonOnDate(a, dateA);

  if (shift === "morning") {
    removeName(rowA.morningOff, a); addUnique(rowA.morningOff, b); rowA.morningWork = workers(currentConfig.morning, rowA.morningOff);
    removeName(rowB.morningOff, b); addUnique(rowB.morningOff, a); rowB.morningWork = workers(currentConfig.morning, rowB.morningOff);
  } else {
    removeName(rowA.nightOff, a); addUnique(rowA.nightOff, b); rowA.nightWork = workers(currentConfig.night, rowA.nightOff);
    removeName(rowB.nightOff, b); addUnique(rowB.nightOff, a); rowB.nightWork = workers(currentConfig.night, rowB.nightOff);
  }

  rebuildAll(false);
  await saveOnline(`${a} (${rowA.displayDate}) สลับกับ ${b} (${rowB.displayDate})`);
  alert(`สลับเรียบร้อย\n${a} ได้หยุด ${rowB.displayDate}\n${b} ได้หยุด ${rowA.displayDate}`);
}

function renderPersonSummary(personOff, all) {
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
function renderSwapHistory() {
  if (!swapHistory.length) return document.getElementById("swapHistory").innerHTML = "ยังไม่มีประวัติ";
  let html = `<table><tr><th>เวลา</th><th>ผู้แก้ไข</th><th>รายการ</th></tr>`;
  swapHistory.forEach(h => html += `<tr><td>${esc(h.time || "")}</td><td>${esc(h.editor || "")}</td><td>${esc(h.text || "")}</td></tr>`);
  html += `</table>`;
  document.getElementById("swapHistory").innerHTML = html;
}
function renderSummary(rows, stats, cfg) {
  if (!cfg || cfg.month === undefined) return;
  const normalRows = rows.filter(r=>!r.isBusy);
  const used = rows.reduce((s,r)=>s+r.morningOff.length+r.nightOff.length,0);
  const totalSlots = normalRows.length * ((cfg.morningCap || 0) + (cfg.nightCap || 0));
  const totals = Object.values(stats).map(s=>s.total);
  const min = totals.length ? Math.min(...totals) : 0, max = totals.length ? Math.max(...totals) : 0;
  const summary = document.getElementById("summary");
  summary.className = "ok";
  summary.innerHTML = `ออนไลน์: ${rows.length} วัน / ห้ามหยุด ${(cfg.busyDaysArray || []).length} วัน / วันหยุด ${used}/${totalSlots} ช่อง<br>ความยุติธรรม: คนน้อยสุด ${min} วัน / คนมากสุด ${max} วัน`;
  let html = `<table><tr><th>พนักงาน</th><th>รวม</th><th>ต้นเดือน</th><th>กลางเดือน</th><th>สิ้นเดือน</th></tr>`;
  Object.entries(stats).sort((a,b)=>b[1].total-a[1].total || a[0].localeCompare(b[0])).forEach(([name,s]) => {
    html += `<tr><td>${esc(name)}</td><td>${s.total}</td><td>${s.periods["ต้นเดือน"]}</td><td>${s.periods["กลางเดือน"]}</td><td>${s.periods["สิ้นเดือน"]}</td></tr>`;
  });
  html += `</table>`;
  document.getElementById("fairnessSummary").innerHTML = html;
}
function renderCalendar(year, month, rows) {
  if (!rows.length) return document.getElementById("calendar").innerHTML = "";
  const byDay = {}; rows.forEach(r=>byDay[r.day]=r);
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month+1, 0).getDate();
  let html = `<div class="calendar">`;
  thaiDows.forEach(d=>html += `<div class="dow">${d}</div>`);
  for(let i=0;i<first;i++) html += `<div class="day empty"></div>`;
  for(let d=1; d<=days; d++) {
    const r = byDay[d];
    html += `<div class="day ${r.isBusy ? "busy-day" : ""}">
      <div class="date-num">${d}</div><div class="period">${r.period}</div>
      ${r.isBusy ? `<div class="busy-label">ห้ามหยุด</div>` : ""}
      ${shiftBlock("morning","กะเช้า",r.morningOff,r.morningWork)}
      ${shiftBlock("night","กะดึก",r.nightOff,r.nightWork)}
    </div>`;
  }
  html += `</div>`;
  document.getElementById("calendar").innerHTML = html;
}
function shiftBlock(cls,title,off,work) { return `<div class="shift ${cls}"><b>${title}</b><br>หยุด: ${pill(off,"off")}<br>ทำงาน: ${pill(work,"work")}</div>`; }
function pill(list,type) {
  if(!list.length) return "—";
  const cls = type === "work" ? "work" : "off";
  return list.map(x=>`<span class="${cls}">${esc(x)}</span>`).join("");
}
function downloadCSV() {
  if(!lastRows.length) return alert("กรุณาสร้างปฏิทินก่อน");
  const personRows = [];
  Object.entries(lastPersonOff).forEach(([name,items]) => personRows.push([name, items.map(i=>`${i.date} ${i.shift} ${i.period}`).join(" | ")]));
  const historyRows = swapHistory.map(h => [h.time, h.editor, h.text]);
  const csv = [
    ["Date","Period","Status","Morning Off","Morning Working","Night Off","Night Working"],
    ...lastRows.map(r=>[r.date,r.period,r.isBusy?"ห้ามหยุด":"สุ่มวันหยุด",r.morningOff.join(" | "),r.morningWork.join(" | "),r.nightOff.join(" | "),r.nightWork.join(" | ")]),
    [], ["Person","Days Off"], ...personRows, [], ["Time","Editor","History"], ...historyRows
  ].map(row=>row.map(cell=>`"${String(cell??"").replaceAll('"','""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download="online-shift-holiday-calendar.csv"; a.click();
  URL.revokeObjectURL(url);
}
function clearLocalOnly() {
  document.getElementById("calendar").innerHTML="";
  document.getElementById("personSummary").innerHTML="ยังไม่มีข้อมูล";
  document.getElementById("fairnessSummary").innerHTML="ยังไม่มีข้อมูล";
  document.getElementById("swapHistory").innerHTML="ยังไม่มีประวัติ";
}
function esc(str) { return String(str).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function escAttr(str) { return esc(str).replaceAll("`","&#096;"); }
