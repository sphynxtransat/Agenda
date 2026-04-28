const DAY_FR=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const DAY_FULL=['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const CATS={
  travail:{label:'Travail',color:'#0891b2',bg:'#ecfeff'},
  formation:{label:'Formation',color:'#d97706',bg:'#fffbeb'},
  lecture:{label:'Lecture',color:'#059669',bg:'#ecfdf5'},
  musique:{label:'Musique',color:'#7c3aed',bg:'#f5f3ff'},
  meditation:{label:'Méditation',color:'#0284c7',bg:'#f0f9ff'},
  personnel:{label:'Personnel',color:'#92400e',bg:'#fdf8f0'},
};
const TODAY=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels'}).format(new Date());
const START_H=6,END_H=24,HOUR_H=52;
const AI_API_URL='https://aiprimetech.io/v1/messages';
const AI_PROXY_URL='https://solitary-cell-9dbd.sphynxtransat.workers.dev/';
const SYNC_INTERVAL_MS=10000;

function loadLS(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}}
function saveLS(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

// ── State ─────────────────────────────────────────────────────────────────────
let selDate = loadLS('arc-date', TODAY);
let currentView = 'day';
let taskSort = 'priority';
let aiTab = 'plan';
let aiStep = 'idle';
let aiErr = '';
let aiSuggs = [];
let aiSel = new Set();
let aiPlanMeta = null;
let aiPlanMode = 'advance';
let chatHistory = loadLS('arc-chat', []);
let notes = loadLS('arc-notes', {});
let chatLoading = false;
let editingEventId = null;
let mcViewDate = new Date();
let notifScheduled = {};
let renderQueued = false;
let syncInterval = null;
let syncPullInFlight = false;
let pushSyncTimer = null;

const PROFILE_DEFAULTS = {
  chronotype:'middle',maxBlock:'90',buffer:'15',deepWork:'morning',
  workStart:'08:00',workEnd:'19:00',lunchStart:'12:30',lunchEnd:'13:30',
  exercise:'none',dayContext:'normal',energy:'medium',apiKey:'',
  darkMode:false,accentColor:'0891b2'
};
let profile = loadLS('arc-profile', PROFILE_DEFAULTS);

let events = loadLS('arc-events', [
  {id:1,title:'Réunion équipe',date:TODAY,startTime:'09:00',endTime:'10:00',category:'travail',notes:'',customColor:null,recurrence:'none',recurrenceDays:[],recurrenceEnd:null,reminder:null},
  {id:2,title:'Deep Work',date:TODAY,startTime:'14:00',endTime:'16:00',category:'travail',notes:'',customColor:null,recurrence:'none',recurrenceDays:[],recurrenceEnd:null,reminder:null},
  {id:3,title:'Méditation',date:TODAY,startTime:'20:00',endTime:'20:30',category:'meditation',notes:'',customColor:null,recurrence:'none',recurrenceDays:[],recurrenceEnd:null,reminder:null},
]);

let tasks = loadLS('arc-tasks', [
  {id:1,title:'Préparer présentation Q2',category:'travail',priority:'haute',duration:90,done:false,dueDate:null,subtasks:[]},
  {id:2,title:'Lire Atomic Habits — ch.5',category:'lecture',priority:'normale',duration:45,done:false,dueDate:null,subtasks:[]},
  {id:3,title:'Envoyer rapport mensuel',category:'travail',priority:'haute',duration:20,done:false,dueDate:null,subtasks:[]},
  {id:4,title:'Séance méditation 20 min',category:'meditation',priority:'normale',duration:20,done:false,dueDate:null,subtasks:[]},
]);

// ── Helpers ───────────────────────────────────────────────────────────────────
function toMins(t){const[h,m]=t.split(':').map(Number);return h*60+m;}
function fromMins(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function parseDate(d){const[y,mo,day]=d.split('-').map(Number);return new Date(y,mo-1,day);}
function fmtDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function addDays(d,n){const r=parseDate(d);r.setDate(r.getDate()+n);return fmtDate(r);}
function getWeek(d){const dt=parseDate(d),day=dt.getDay(),mon=new Date(dt);mon.setDate(dt.getDate()-((day+6)%7));return Array.from({length:7},(_,i)=>{const x=new Date(mon);x.setDate(mon.getDate()+i);return fmtDate(x);});}
function nowMins(){const n=new Date();return n.getHours()*60+n.getMinutes();}
function evColor(ev){return ev.customColor||CATS[ev.category]?.color||'#aaa';}
function evBg(ev){if(ev.customColor){const h=ev.customColor.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return`rgba(${r},${g},${b},0.12)`;}return CATS[ev.category]?.bg||'#f5f5f5';}

// Recurring: check if event occurs on a given date
function eventOccursOn(ev, date) {
  if(ev.recurrence==='none') return ev.date===date;
  const base=parseDate(ev.date), target=parseDate(date);
  if(target<base) return false;
  if(ev.recurrenceEnd&&target>parseDate(ev.recurrenceEnd)) return false;
  if(ev.recurrence==='daily') return true;
  if(ev.recurrence==='weekly'){
    const days=ev.recurrenceDays.length?ev.recurrenceDays:[parseDate(ev.date).getDay()];
    return days.includes(target.getDay());
  }
  if(ev.recurrence==='monthly') return target.getDate()===base.getDate();
  if(ev.recurrence==='yearly') return target.getDate()===base.getDate()&&target.getMonth()===base.getMonth();
  return false;
}

function getEventsForDate(date) {
  return events.filter(ev=>eventOccursOn(ev,date));
}

// ── Save with sync ────────────────────────────────────────────────────────────
function saveWithSync(k,v){
  saveLS(k,v);
  if(k==='arc-events'||k==='arc-tasks'){
    syncPush();
    localStorage.setItem('arc-sync-time',String(Date.now()));
  }
}


// ── Accent color ──────────────────────────────────────────────────────────────
function setAccent(hex,el){
  document.documentElement.style.setProperty('--accent','#'+hex);
  document.documentElement.style.setProperty('--accent-bg','rgba('+parseInt(hex.slice(0,2),16)+','+parseInt(hex.slice(2,4),16)+','+parseInt(hex.slice(4,6),16)+',.1)');
  profile.accentColor=hex;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('sel',s.dataset.c===hex));
}
function applyAccent(hex){setAccent(hex,null);}

// ── Notifications ─────────────────────────────────────────────────────────────
function requestNotifPermission(){
  if('Notification' in window&&Notification.permission==='default'){
    Notification.requestPermission();
  }
}
function scheduleNotifications(){
  Object.values(notifScheduled).forEach(t=>clearTimeout(t));
  notifScheduled={};
  events.forEach(ev=>{
    if(!ev.reminder)return;
    const dates=ev.recurrence==='none'?[ev.date]:getWeek(selDate);
    dates.forEach(date=>{
      if(!eventOccursOn(ev,date))return;
      const evTime=parseDate(date);
      evTime.setHours(parseInt(ev.startTime.split(':')[0]));
      evTime.setMinutes(parseInt(ev.startTime.split(':')[1])-ev.reminder);
      const ms=evTime.getTime()-Date.now();
      if(ms>0&&ms<86400000){
        const key=ev.id+'_'+date;
        notifScheduled[key]=setTimeout(()=>{
          if(Notification.permission==='granted'){
            new Notification('📅 '+ev.title,{body:'Dans '+ev.reminder+' min — '+ev.startTime,icon:''});
          }
        },ms);
      }
    });
  });
}

// ── Render all ────────────────────────────────────────────────────────────────
function renderNote(){
  const el=document.getElementById('noteArea');
  if(!el||document.activeElement===el)return;
  el.value=notes[selDate]||'';
}
function saveNote(val){notes[selDate]=val;saveLS('arc-notes',notes);syncPush();}
function renderNow(){
  renderSidebarHead();
  renderWeekStrip();
  renderMiniCal();
  renderTasks();
  renderNote();
  if(currentView==='day') renderDayView();
  else renderWeekView();
  renderAI();
  updateAIToggle();
}
function renderAll(){
  if(renderQueued)return;
  renderQueued=true;
  requestAnimationFrame(()=>{
    renderQueued=false;
    renderNow();
  });
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function renderSidebarHead(){
  const dt=parseDate(selDate);
  document.getElementById('sbDateBig').textContent=DAY_FULL[dt.getDay()]+' '+dt.getDate()+' '+MONTHS[dt.getMonth()];
  document.getElementById('sbDateSub').textContent=dt.getFullYear();
  document.getElementById('mainDateTitle').textContent=currentView==='week'?'Semaine du '+getWeek(selDate)[0].split('-').reverse().slice(0,2).join('/'):DAY_FULL[dt.getDay()]+' '+dt.getDate()+' '+MONTHS[dt.getMonth()];
}

function renderWeekStrip(){
  const week=getWeek(selDate);
  const strip=document.getElementById('weekStrip');strip.innerHTML='';
  week.forEach(d=>{
    const dt=parseDate(d),isSel=d===selDate,isToday=d===TODAY;
    const evs=getEventsForDate(d);
    const dotColor=evs.length?(isSel?'rgba(255,255,255,.55)':evColor(evs[0])):'transparent';
    const div=document.createElement('div');
    div.className='ws-day'+(isSel?' sel':'')+(isToday?' today-d':'');
    div.onclick=()=>selectDate(d);
    div.innerHTML=`<span class="ws-lbl">${DAY_FR[dt.getDay()]}</span><span class="ws-num">${dt.getDate()}</span><div class="ws-dot" style="background:${dotColor}"></div>`;
    strip.appendChild(div);
  });
}

function renderMiniCal(){
  const y=mcViewDate.getFullYear(),mo=mcViewDate.getMonth();
  document.getElementById('mcTitle').textContent=MONTHS[mo]+' '+y;
  const first=new Date(y,mo,1),startDay=(first.getDay()+6)%7,daysInMo=new Date(y,mo+1,0).getDate();
  const grid=document.getElementById('mcGrid');grid.innerHTML='';
  ['L','M','M','J','V','S','D'].forEach(l=>{const d=document.createElement('div');d.className='mc-dlbl';d.textContent=l;grid.appendChild(d);});
  for(let i=0;i<startDay;i++){const dt2=new Date(y,mo,1-startDay+i);const ds=fmtDate(dt2);const c=document.createElement('div');c.className='mc-cell mc-other';c.textContent=dt2.getDate();c.onclick=()=>{selectDate(ds);mcViewDate=new Date(parseDate(ds));mcViewDate.setDate(1);renderMiniCal();};grid.appendChild(c);}
  for(let i=1;i<=daysInMo;i++){const ds=y+'-'+String(mo+1).padStart(2,'0')+'-'+String(i).padStart(2,'0');const evs=getEventsForDate(ds);const c=document.createElement('div');c.className='mc-cell'+(ds===TODAY?' mc-today':'')+(ds===selDate?' mc-sel':'')+(evs.length&&ds!==selDate?' mc-has':'');c.textContent=i;c.onclick=()=>selectDate(ds);grid.appendChild(c);}
}
function moveMonth(n){mcViewDate.setMonth(mcViewDate.getMonth()+n);renderMiniCal();}

// ── Tasks ─────────────────────────────────────────────────────────────────────
function getSortedTasks(){
  const arr=[...tasks];
  if(taskSort==='priority'){
    const order={haute:0,normale:1,basse:2};
    arr.sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;return(order[a.priority||'normale']||1)-(order[b.priority||'normale']||1);});
  } else if(taskSort==='dueDate'){
    arr.sort((a,b)=>{if(a.done!==b.done)return a.done?1:-1;if(!a.dueDate&&!b.dueDate)return 0;if(!a.dueDate)return 1;if(!b.dueDate)return -1;return a.dueDate.localeCompare(b.dueDate);});
  }
  return arr;
}
function setTaskSort(by){
  taskSort=by;
  document.getElementById('sortPrio').classList.toggle('on',by==='priority');
  document.getElementById('sortDue').classList.toggle('on',by==='dueDate');
  renderTasks();
}

function renderTasks(){
  const list=document.getElementById('taskList');list.innerHTML='';
  const sorted=getSortedTasks();
  if(!sorted.length){return;}
  sorted.forEach(t=>{
    const cat=CATS[t.category]||CATS.personnel;
    const pClass={haute:'prio-haute',normale:'prio-normale',basse:'prio-basse'}[t.priority||'normale'];
    const pLabel={haute:'Haute',normale:'Normale',basse:'Basse'}[t.priority||'normale'];
    const isOverdue=t.dueDate&&!t.done&&t.dueDate<TODAY;
    const dueStr=t.dueDate?new Date(t.dueDate+'T00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}):'';
    const subtasksDone=(t.subtasks||[]).filter(s=>s.done).length;
    const subtasksTotal=(t.subtasks||[]).length;
    const div=document.createElement('div');div.className='task-item';
    div.innerHTML=`
      <div class="task-row">
        <div class="task-check${t.done?' ck':''}" onclick="toggleTask(${t.id})">${t.done?'✓':''}</div>
        <div class="task-body">
          <div class="task-lbl${t.done?' done':''}">${t.title}</div>
          <div class="task-meta">
            <div class="task-dot" style="background:${cat.color}"></div>
            <span class="prio-badge ${pClass}">${pLabel}</span>
            ${t.duration?`<span style="font-size:9px;color:var(--text3)">⏱${t.duration}min</span>`:''}
            ${dueStr?`<span class="due-badge${isOverdue?' overdue':''}">📅${dueStr}</span>`:''}
            ${subtasksTotal?`<span style="font-size:9px;color:var(--text3)">${subtasksDone}/${subtasksTotal} sous-tâches</span>`:''}
          </div>
        </div>
        <button class="expand-btn" onclick="toggleSubtasks(${t.id},this)" title="Sous-tâches">▸</button>
        <button class="task-del" onclick="deleteTask(${t.id})">×</button>
      </div>
      <div class="subtask-list" id="sub_${t.id}" style="display:none">
        ${(t.subtasks||[]).map(s=>`
          <div class="subtask-item">
            <div class="subtask-check${s.done?' ck':''}" onclick="toggleSubtask(${t.id},${s.id})">${s.done?'✓':''}</div>
            <span class="subtask-lbl${s.done?' done':''}" onclick="toggleSubtask(${t.id},${s.id})">${s.title}</span>
            <button class="subtask-del" onclick="deleteSubtask(${t.id},${s.id})">×</button>
          </div>`).join('')}
        <div class="add-subtask-row">
          <input class="add-subtask-input" id="stin_${t.id}" placeholder="Ajouter une sous-tâche…" onkeydown="if(event.key==='Enter')addSubtask(${t.id})">
          <button class="add-subtask-btn" onclick="addSubtask(${t.id})">+</button>
        </div>
      </div>`;
    list.appendChild(div);
  });
}

function toggleSubtasks(id,btn){
  const el=document.getElementById('sub_'+id);
  const shown=el.style.display!=='none';
  el.style.display=shown?'none':'block';
  btn.textContent=shown?'▸':'▾';
}
function toggleTask(id){tasks=tasks.map(t=>t.id===id?{...t,done:!t.done}:t);saveWithSync('arc-tasks',tasks);renderTasks();}
function deleteTask(id){tasks=tasks.filter(t=>t.id!==id);saveWithSync('arc-tasks',tasks);renderTasks();}
function toggleSubtask(tid,sid){tasks=tasks.map(t=>t.id===tid?{...t,subtasks:(t.subtasks||[]).map(s=>s.id===sid?{...s,done:!s.done}:s)}:t);saveWithSync('arc-tasks',tasks);renderTasks();}
function deleteSubtask(tid,sid){tasks=tasks.map(t=>t.id===tid?{...t,subtasks:(t.subtasks||[]).filter(s=>s.id!==sid)}:t);saveWithSync('arc-tasks',tasks);renderTasks();}
function addSubtask(tid){
  const inp=document.getElementById('stin_'+tid);if(!inp||!inp.value.trim())return;
  tasks=tasks.map(t=>t.id===tid?{...t,subtasks:[...(t.subtasks||[]),{id:Date.now(),title:inp.value.trim(),done:false}]}:t);
  saveWithSync('arc-tasks',tasks);
  const openIds=new Set([...document.querySelectorAll('.subtask-list')].filter(el=>el.style.display!=='none').map(el=>el.id.replace('sub_','')));
  openIds.add(String(tid));
  renderTasks();
  openIds.forEach(id=>{
    const el=document.getElementById('sub_'+id);if(!el)return;
    el.style.display='block';
    const btn=el.previousElementSibling?.querySelector('.expand-btn');
    if(btn)btn.textContent='▾';
  });
}
function showTaskForm(){document.getElementById('taskForm').style.display='block';document.getElementById('taskInput').focus();}
function hideTaskForm(){document.getElementById('taskForm').style.display='none';document.getElementById('taskInput').value='';}
function taskInputKey(e){if(e.key==='Enter')addTask();if(e.key==='Escape')hideTaskForm();}
function addTask(){
  const title=document.getElementById('taskInput').value.trim();if(!title)return;
  const dueVal=document.getElementById('taskDueDate').value;
  tasks.push({id:Date.now(),title,category:document.getElementById('taskCat').value,priority:document.getElementById('taskPrio').value,duration:parseInt(document.getElementById('taskDuration').value),done:false,dueDate:dueVal||null,subtasks:[]});
  saveWithSync('arc-tasks',tasks);renderTasks();hideTaskForm();
  document.getElementById('taskDueDate').value='';
}

// ── Day view ──────────────────────────────────────────────────────────────────
function renderDayView(){
  document.getElementById('dayView').style.display='';
  document.getElementById('weekView').classList.remove('active');
  const grid=document.getElementById('dvGrid');grid.innerHTML='';
  const dayEvs=getEventsForDate(selDate);
  for(let h=START_H;h<END_H;h++){
    const row=document.createElement('div');row.className='hour-row';row.style.height=HOUR_H+'px';
    if(h>START_H)row.innerHTML=`<span class="hour-lbl">${h}h</span>`;
    row.onclick=e=>{if(e.target===row||e.target.classList.contains('hour-lbl'))openNewEventAt(h);};
    grid.appendChild(row);
  }
  if(selDate===TODAY){
    const mins=nowMins(),top=(mins-START_H*60)*(HOUR_H/60);
    if(top>=0){const l=document.createElement('div');l.className='now-line';l.style.top=top+'px';grid.appendChild(l);}
  }
  dayEvs.forEach(ev=>{
    const top=(toMins(ev.startTime)-START_H*60)*(HOUR_H/60);
    const height=Math.max((toMins(ev.endTime)-toMins(ev.startTime))*(HOUR_H/60),20);
    const card=document.createElement('div');card.className='ev-card';
    const col=evColor(ev),bg=evBg(ev);
    card.style.cssText=`top:${top}px;height:${height}px;border-left-color:${col};background:${bg}`;
    const tiny=height<36;
    const recurIcon=ev.recurrence!=='none'?'<span class="ev-recur">↻</span>':'';
    card.innerHTML=`<div class="ev-title" style="color:${col}">${ev.title}</div>${!tiny?`<div class="ev-time" style="color:${col}">${ev.startTime} – ${ev.endTime}${recurIcon}</div>`:''}`;
    card.onclick=()=>openEditEvent(ev.id);
    grid.appendChild(card);
  });
}

// ── Week view ─────────────────────────────────────────────────────────────────
function renderWeekView(){
  document.getElementById('dayView').style.display='none';
  const wv=document.getElementById('weekView');wv.classList.add('active');
  const week=getWeek(selDate);

  // Header
  const hdr=document.getElementById('weekHeader');hdr.innerHTML='';
  const timeHdr=document.createElement('div');timeHdr.className='week-time-lbl';hdr.appendChild(timeHdr);
  week.forEach(d=>{
    const dt=parseDate(d),isToday=d===TODAY;
    const col=document.createElement('div');col.className='week-day-hd'+(isToday?' today':'');
    col.innerHTML=`<div class="week-day-name">${DAY_FR[dt.getDay()]}</div><div class="week-day-num">${dt.getDate()}</div>`;
    col.onclick=()=>selectDate(d);
    hdr.appendChild(col);
  });

  // Body
  const body=document.getElementById('weekBody');body.innerHTML='';
  // Time column
  const timeCol=document.createElement('div');timeCol.className='week-time-col';
  for(let h=START_H;h<END_H;h++){
    const slot=document.createElement('div');slot.className='week-time-slot';slot.style.height=HOUR_H+'px';
    if(h>START_H)slot.innerHTML=`<span>${h}h</span>`;
    timeCol.appendChild(slot);
  }
  body.appendChild(timeCol);

  // Day columns
  week.forEach(d=>{
    const dayCol=document.createElement('div');dayCol.className='week-day-col'+(d===TODAY?' today-col':'');
    dayCol.style.cssText=`position:relative;min-height:${(END_H-START_H)*HOUR_H}px`;

    // Hour lines
    for(let h=START_H;h<END_H;h++){
      const line=document.createElement('div');
      line.style.cssText=`position:absolute;left:0;right:0;top:${(h-START_H)*HOUR_H}px;height:${HOUR_H}px;border-top:1px solid var(--border2);cursor:pointer;`;
      if(h===START_H)line.style.borderTop='none';
      line.onclick=()=>{selectDate(d);openNewEventAt(h);};
      dayCol.appendChild(line);
    }

    // Now line
    if(d===TODAY){
      const mins=nowMins(),top=(mins-START_H*60)*(HOUR_H/60);
      if(top>=0){const nl=document.createElement('div');nl.className='week-now-line';nl.style.top=top+'px';dayCol.appendChild(nl);}
    }

    // Events
    const dayEvs=getEventsForDate(d);
    dayEvs.forEach(ev=>{
      const top=(toMins(ev.startTime)-START_H*60)*(HOUR_H/60);
      const height=Math.max((toMins(ev.endTime)-toMins(ev.startTime))*(HOUR_H/60),18);
      const card=document.createElement('div');card.className='week-ev';
      const col=evColor(ev),bg=evBg(ev);
      card.style.cssText=`top:${top}px;height:${height}px;border-left-color:${col};background:${bg};color:${col}`;
      const compact=height<34;
      card.innerHTML=`<div class="week-ev-title">${ev.title}</div>${compact?'':`<div class="week-ev-time">${ev.startTime} – ${ev.endTime}</div>`}`;
      card.onclick=e=>{e.stopPropagation();openEditEvent(ev.id);};
      dayCol.appendChild(card);
    });

    body.appendChild(dayCol);
  });
}

// ── View toggle ───────────────────────────────────────────────────────────────
function setView(v){
  currentView=v;
  document.getElementById('viewBtnDay').classList.toggle('on',v==='day');
  document.getElementById('viewBtnWeek').classList.toggle('on',v==='week');
  if(v==='day'){renderDayView();}else{renderWeekView();}
  renderSidebarHead();
}

// ── Navigation ────────────────────────────────────────────────────────────────
function selectDate(d){
  selDate=d;saveLS('arc-date',d);
  const dt=parseDate(d);
  if(dt.getMonth()!==mcViewDate.getMonth()||dt.getFullYear()!==mcViewDate.getFullYear()){
    mcViewDate=new Date(dt.getFullYear(),dt.getMonth(),1);
  }
  renderAll();
}
function shiftDay(n){
  if(currentView==='week'){
    selDate=addDays(selDate,n*7);
  } else {
    selDate=addDays(selDate,n);
  }
  saveLS('arc-date',selDate);
  const dt=parseDate(selDate);
  if(dt.getMonth()!==mcViewDate.getMonth()||dt.getFullYear()!==mcViewDate.getFullYear()){
    mcViewDate=new Date(dt.getFullYear(),dt.getMonth(),1);
  }
  renderAll();
}
function goToday(){selectDate(TODAY);}

// ── Event modal ───────────────────────────────────────────────────────────────
function toggleRecurDays(){
  const val=document.getElementById('evRecurrence').value;
  document.getElementById('recurDaysRow').style.display=val==='weekly'?'block':'none';
  document.getElementById('recurEndRow').style.display=val!=='none'?'block':'none';
}
function toggleRecurDay(btn){btn.classList.toggle('on');}

function openNewEvent(){openNewEventAt(9);}
function openNewEventAt(h){
  editingEventId=null;
  document.getElementById('evModalTitle').textContent='Nouvel événement';
  document.getElementById('evTitle').value='';
  document.getElementById('evStart').value=fromMins(h*60);
  document.getElementById('evEnd').value=fromMins(Math.min((h+1)*60,23*60+59));
  document.getElementById('evCat').value='travail';
  document.getElementById('evDate').value=selDate;
  document.getElementById('evNotes').value='';
  document.getElementById('evCustomColor').value='#0891b2';
  document.getElementById('evColorAuto').textContent='Auto';
  document.getElementById('evReminder').value='';
  document.getElementById('evRecurrence').value='none';
  document.getElementById('recurDaysRow').style.display='none';
  document.getElementById('recurEndRow').style.display='none';
  document.getElementById('evRecurEnd').value='';
  document.querySelectorAll('.day-toggle').forEach(b=>b.classList.remove('on'));
  document.getElementById('evDelBtn').style.display='none';
  document.getElementById('evOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('evTitle').focus(),50);
}
function openEditEvent(id){
  const ev=events.find(e=>e.id===id);if(!ev)return;
  editingEventId=id;
  document.getElementById('evModalTitle').textContent="Modifier l'événement";
  document.getElementById('evTitle').value=ev.title;
  document.getElementById('evStart').value=ev.startTime;
  document.getElementById('evEnd').value=ev.endTime;
  document.getElementById('evCat').value=ev.category;
  document.getElementById('evDate').value=ev.date;
  document.getElementById('evNotes').value=ev.notes||'';
  document.getElementById('evCustomColor').value=ev.customColor||'#0891b2';
  document.getElementById('evColorAuto').textContent=ev.customColor?'Effacer':'Auto';
  document.getElementById('evReminder').value=ev.reminder||'';
  document.getElementById('evRecurrence').value=ev.recurrence||'none';
  document.getElementById('recurDaysRow').style.display=ev.recurrence==='weekly'?'block':'none';
  document.getElementById('recurEndRow').style.display=(ev.recurrence&&ev.recurrence!=='none')?'block':'none';
  document.getElementById('evRecurEnd').value=ev.recurrenceEnd||'';
  document.querySelectorAll('.day-toggle').forEach(b=>{b.classList.toggle('on',(ev.recurrenceDays||[]).includes(parseInt(b.dataset.d)));});
  document.getElementById('evDelBtn').style.display='inline-flex';
  document.getElementById('evOverlay').style.display='flex';
  setTimeout(()=>document.getElementById('evTitle').focus(),50);
}
function closeEvModal(e){if(e.target.id==='evOverlay')document.getElementById('evOverlay').style.display='none';}
function saveEvent(){
  const title=document.getElementById('evTitle').value.trim();if(!title)return;
  const startTime=document.getElementById('evStart').value;
  const endTime=document.getElementById('evEnd').value;
  if(!startTime||!endTime||toMins(endTime)<=toMins(startTime)){window.alert('L\'heure de fin doit être après l\'heure de début.');return;}
  const colorInput=document.getElementById('evCustomColor').value;
  const autoBtn=document.getElementById('evColorAuto');
  const customColor=(autoBtn.textContent==='Auto')?null:colorInput;
  const recurDays=[...document.querySelectorAll('.day-toggle.on')].map(b=>parseInt(b.dataset.d));
  const ev={
    id:editingEventId||Date.now(),title,
    startTime,
    endTime,
    category:document.getElementById('evCat').value,
    date:document.getElementById('evDate').value,
    notes:document.getElementById('evNotes').value,
    customColor,
    reminder:document.getElementById('evReminder').value?parseInt(document.getElementById('evReminder').value):null,
    recurrence:document.getElementById('evRecurrence').value,
    recurrenceDays:recurDays,
    recurrenceEnd:document.getElementById('evRecurEnd').value||null,
  };
  if(editingEventId)events=events.map(e=>e.id===editingEventId?ev:e);else events.push(ev);
  saveWithSync('arc-events',events);
  document.getElementById('evOverlay').style.display='none';
  scheduleNotifications();
  renderAll();
}
function deleteEvent(){
  if(!editingEventId)return;
  events=events.filter(e=>e.id!==editingEventId);
  saveWithSync('arc-events',events);
  document.getElementById('evOverlay').style.display='none';
  renderAll();
}

// ── Profile ───────────────────────────────────────────────────────────────────
function openProfile(){
  ['chronotype','deepWork','maxBlock','buffer','exercise','dayContext','energy'].forEach(k=>{
    const id='p'+k.charAt(0).toUpperCase()+k.slice(1);
    const el=document.getElementById(id);if(!el)return;
    el.querySelectorAll('.radio-opt').forEach(o=>o.classList.toggle('sel',o.dataset.v===profile[k]));
  });
  document.getElementById('pWorkStart').value=profile.workStart||'08:00';
  document.getElementById('pWorkEnd').value=profile.workEnd||'19:00';
  document.getElementById('pLunchStart').value=profile.lunchStart||'12:30';
  document.getElementById('pLunchEnd').value=profile.lunchEnd||'13:30';
  document.getElementById('pApiKey').value=profile.apiKey||'';
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('sel',s.dataset.c===(profile.accentColor||'0891b2')));
  document.getElementById('profileOverlay').style.display='flex';
}
function setPref(k,v,el){el.closest('.radio-group').querySelectorAll('.radio-opt').forEach(o=>o.classList.remove('sel'));el.classList.add('sel');profile[k]=v;}
function saveProfile(){
  profile.workStart=document.getElementById('pWorkStart').value;
  profile.workEnd=document.getElementById('pWorkEnd').value;
  profile.lunchStart=document.getElementById('pLunchStart').value;
  profile.lunchEnd=document.getElementById('pLunchEnd').value;
  const k=document.getElementById('pApiKey').value.trim();if(k)profile.apiKey=k;
  saveLS('arc-profile',profile);
  document.getElementById('profileOverlay').style.display='none';
}
function closeProfileModal(e){if(e.target.id==='profileOverlay')document.getElementById('profileOverlay').style.display='none';}

// ── AI ────────────────────────────────────────────────────────────────────────
function updateAIToggle(){
  document.getElementById('aiToggleBtn').className='hbtn'+(showAI?' on':'');
  document.getElementById('aiCol').className='ai-col'+(showAI?'':' closed');
}
let showAI=loadLS('arc-ai',true);
function toggleAI(){showAI=!showAI;saveLS('arc-ai',showAI);updateAIToggle();}

function setAITab(tab){
  aiTab=tab;
  document.getElementById('tabPlan').classList.toggle('on',tab==='plan');
  document.getElementById('tabChat').classList.toggle('on',tab==='chat');
  renderAI();
}

function setPlanMode(mode){
  aiPlanMode=mode;
  renderAI();
}

const planModeOrder=['advance','hold','recover','catchup','clarify'];
const planModeLabels={
  advance:'Priorités',
  hold:'Journée chargée',
  recover:'Journée légère',
  catchup:'Rattrapage',
  clarify:'Organisation'
};
const planModeHints={
  advance:"ce qui compte le plus aujourd'hui",
  hold:'beaucoup à gérer, sans se cramer',
  recover:"alléger pour préserver l'énergie",
  catchup:'reprendre le fil du retard',
  clarify:"mettre de l'ordre et clarifier"
};

function cyclePlanMode(){
  const idx=planModeOrder.indexOf(aiPlanMode);
  const next=planModeOrder[(idx+1)%planModeOrder.length]||'advance';
  setPlanMode(next);
}

function renderCompactActionSections(msgIndex, items){
  const wrapped=items.map((suggestion,index)=>({suggestion,index}));
  const nowItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='now');
  const planItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='plan');
  const laterItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='later');
  return [
    renderActionSection('À faire maintenant','le plus utile tout de suite',nowItems,msgIndex),
    renderActionSection('À planifier','à garder si cela compte',planItems,msgIndex),
    renderActionSection("À reporter","sans urgence aujourd'hui",laterItems,msgIndex)
  ].filter(Boolean).join('');
}

function renderActionSection(title,note,items,msgIndex){
  if(!items.length)return '';
  const [lead,...rest]=items;
  return `<div class="ai-sec compact">
    <div class="ai-sec-head"><div class="ai-sec-title">${title}</div>${note?`<div class="ai-sec-note">${note}</div>`:''}</div>
    ${[lead,...rest].map(item=>renderSuggestionCard(item.suggestion,false,`applyChatAction(${msgIndex},${item.index})`,'Cliquer pour ajouter')).join('')}
  </div>`;
}

function escapeHtml(str){
  return String(str||'').replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function normalizeAISuggestion(raw, source){
  if(!raw||typeof raw!=='object')return null;
  const type=raw.type||source||'event';
  if(type==='create_task' || type==='task'){
    if(!raw.title)return null;
    return {
      type:'task',
      title:raw.title,
      category:CATS[raw.category]?raw.category:'personnel',
      priority:['haute','normale','basse'].includes(raw.priority)?raw.priority:'normale',
      duration:parseInt(raw.duration)||30,
      dueDate:raw.dueDate||selDate,
      note:raw.note||'',
      subtasks:Array.isArray(raw.subtasks)?raw.subtasks.filter(Boolean).slice(0,5):[]
    };
  }
  if(!raw.title||!raw.startTime||!raw.endTime||!CATS[raw.category])return null;
  return {
    type:'event',
    title:raw.title,
    startTime:raw.startTime,
    endTime:raw.endTime,
    category:raw.category,
    note:raw.note||'',
    taskTitle:raw.taskTitle||'',
    date:raw.date||selDate
  };
}

function applyAISuggestion(s){
  if(!s)return;
  if(s.type==='task'){
    tasks.push({
      id:Date.now()+Math.floor(Math.random()*1000),
      title:s.title,
      category:s.category,
      priority:s.priority,
      duration:s.duration,
      done:false,
      dueDate:s.dueDate||null,
      subtasks:(s.subtasks||[]).map((title,i)=>({id:Date.now()+i+1,title,done:false}))
    });
    saveWithSync('arc-tasks',tasks);
    renderTasks();
    return;
  }
  events.push({
    id:Date.now()+Math.floor(Math.random()*1000),
    title:s.title,
    startTime:s.startTime,
    endTime:s.endTime,
    category:s.category,
    notes:s.note||'',
    date:s.date||selDate,
    customColor:null,
    recurrence:'none',
    recurrenceDays:[],
    recurrenceEnd:null,
    reminder:null
  });
  saveWithSync('arc-events',events);
  scheduleNotifications();
  renderAll();
}

function applyChatAction(msgIndex, actionIndex){
  const msg=chatHistory[msgIndex];
  const action=msg?.actions?.[actionIndex];
  if(!action)return;
  applyAISuggestion(action);
  chatHistory=chatHistory.map((m,i)=>i!==msgIndex?m:{...m,actions:(m.actions||[]).filter((_,idx)=>idx!==actionIndex)});
  saveLS('arc-chat',chatHistory);
  renderAI();
}

function renderSuggestionCard(s, sel, onClick, badgeText){
  const cat=CATS[s.category]||CATS.personnel;
  const isTask=s.type==='task';
  const metaChips=isTask
    ?[
      `<span class="meta-chip">${escapeHtml(cat.label)}</span>`,
      `<span class="meta-chip">Priorité ${escapeHtml(s.priority||'normale')}</span>`,
      s.dueDate?`<span class="meta-chip">À faire ${escapeHtml(s.dueDate)}</span>`:''
    ].filter(Boolean).join('')
    :[
      `<span class="meta-chip">${escapeHtml(s.startTime)} – ${escapeHtml(s.endTime)}</span>`,
      `<span class="meta-chip">${escapeHtml(cat.label)}</span>`,
      s.date&&s.date!==selDate?`<span class="meta-chip">${escapeHtml(s.date)}</span>`:''
    ].filter(Boolean).join('');
  const kind=isTask?'To-do recommandée':'Créneau recommandé';
  const kindIcon=isTask?'✓':'◌';
  const title=s.title;
  return `<div class="ai-sugg${sel?' sel':''}" ${onClick?`onclick="${onClick}"`:''}>
    <div class="ai-s-bar" style="background:${cat.color}"></div>
    <div style="flex:1">
      <div class="ai-s-top">
        <div class="ai-s-kind">${kindIcon} ${escapeHtml(kind)}</div>
        <div class="ai-s-badge">${sel?'Sélectionné':(badgeText||'Cliquer pour choisir')}</div>
      </div>
      <div class="ai-s-meta">${metaChips}</div>
      <div class="ai-s-title">${escapeHtml(title)}</div>
      ${s.note?`<div class="ai-s-note">${escapeHtml(s.note)}</div>`:''}
      ${isTask&&s.subtasks?.length?`<div style="font-size:10px;color:var(--text3);margin-top:6px">${s.subtasks.length} sous-tâche(s)</div>`:''}
    </div>
    <div class="ai-s-ck" style="color:${sel?'var(--accent)':'var(--border)'}">${sel?'✓':'○'}</div>
  </div>`;
}

function suggestionBucket(s){
  const note=(s.note||'').toLowerCase();
  const title=(s.title||'').toLowerCase();
  if(note.includes('report')||note.includes('plus tard')||title.includes('report'))return 'later';
  if(s.type==='task')return 'plan';
  const nowStart=nowMins();
  if(s.type==='event' && s.date===selDate && Math.abs(toMins(s.startTime)-nowStart)<=120)return 'now';
  return 'plan';
}

function renderSuggestionSection(title,note,items,selectedMode){
  if(!items.length)return '';
  const [lead,...rest]=items;
  const leadCard=lead?renderSuggestionCard(lead.suggestion,selectedMode?aiSel.has(lead.index):false,selectedMode?`toggleAISugg(${lead.index})`:'' ).replace('class="ai-sugg','class="ai-sugg featured'):'';
  return `<div class="ai-sec">
    <div class="ai-sec-head"><div class="ai-sec-title">${title}</div>${note?`<div class="ai-sec-note">${note}</div>`:''}</div>
    ${leadCard}
    ${rest.map(item=>renderSuggestionCard(item.suggestion,selectedMode?aiSel.has(item.index):false,selectedMode?`toggleAISugg(${item.index})`:'' )).join('')}
  </div>`;
}

function getAssistantContext(){
  const dayEvs=getEventsForDate(selDate).sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const pending=tasks.filter(t=>!t.done);
  const dt=parseDate(selDate);
  const p=profile;
  const byPrio={haute:[],normale:[],basse:[]};
  pending.forEach(t=>(byPrio[t.priority||'normale']).push(t));
  const existStr=dayEvs.length?dayEvs.map(e=>`${e.startTime}-${e.endTime}: ${e.title} (${CATS[e.category]?.label||'Personnel'})`).join('\n  '):'Aucun';
  const taskLines=[
    ...byPrio.haute.map(t=>`[HAUTE PRIORITÉ — ${t.duration||60}min] ${t.title} (${CATS[t.category]?.label||'Personnel'})`),
    ...byPrio.normale.map(t=>`[NORMALE — ${t.duration||60}min] ${t.title} (${CATS[t.category]?.label||'Personnel'})`),
    ...byPrio.basse.map(t=>`[BASSE — ${t.duration||60}min] ${t.title} (${CATS[t.category]?.label||'Personnel'})`)
  ];
  const taskStr=taskLines.length?taskLines.join('\n  '):'Aucune tâche';
  const peakMap={early:'7h-11h',middle:'9h-12h et 15h-17h',late:'11h-14h et 17h-20h'};
  const energyMap={low:'énergie basse',medium:'énergie moyenne',high:'énergie élevée'};
  const ctxMap={normal:'journée standard',creative:'journée créative',meetings:'journée riche en réunions',deep:'journée deep work',recovery:'journée de récupération'};
  return {
    dt,
    p,
    dayEvs,
    pending,
    existStr,
    taskStr,
    chronoStr:peakMap[p.chronotype||'middle'],
    energyStr:energyMap[p.energy||'medium'],
    dayContextStr:ctxMap[p.dayContext||'normal'],
    workWindow:`${p.workStart||'08:00'} → ${p.workEnd||'19:00'}`,
    lunchWindow:`${p.lunchStart||'12:30'} → ${p.lunchEnd||'13:30'}`,
    loadBudget:{low:'60%',medium:'70%',high:'80%'}[p.energy||'medium']
  };
}

function buildPrompt(){
  const {p,existStr,taskStr,chronoStr,energyStr,dayContextStr,workWindow,lunchWindow,loadBudget}=getAssistantContext();
  const modeDesc={
    advance:"mettre les priorités en premier sans surcharger la journée",
    hold:'gérer une journée chargée de façon stable et soutenable',
    recover:"protéger l'énergie et alléger franchement la journée",
    catchup:"rattraper le retard sans créer d'effondrement ensuite",
    clarify:"mettre de l'ordre et dégager une direction claire"
  }[aiPlanMode]||"faire progresser l'essentiel sans surcharger la journée";

  return `Tu es un assistant de régulation humaine de la journée.
Tu n'optimises pas un agenda abstrait : tu aides un être humain avec une énergie variable, une attention limitée et une capacité réelle plus faible que sa capacité théorique.
Tu dois être concret, protecteur, lucide et soutenable.

═══ PROFIL BIOLOGIQUE ═══
• Chronotype : ${chronoStr}
• Fenêtre de deep work préférentielle : ${p.deepWork==='morning'?'matin uniquement':p.deepWork==='afternoon'?'après-midi uniquement':'matin + après-midi'}
• Durée max par bloc de concentration : ${p.maxBlock||90} minutes
• Buffer recommandé entre tâches : ${p.buffer||15} minutes
• Niveau d'énergie du jour : ${energyStr}
• Contexte du jour : ${dayContextStr}
• Style demandé : ${modeDesc}
• Charge visée de la journée : environ ${loadBudget} de la capacité perçue

═══ HORAIRES ═══
• Journée de travail : ${workWindow}
• Déjeuner : ${lunchWindow} (non négociable)

═══ ÉVÉNEMENTS FIXÉS (ne pas chevaucher) ═══
  ${existStr}

═══ TÂCHES À PLANIFIER ═══
  ${taskStr}

═══ CONSIGNES ═══
1. Ne remplis jamais toute la journée. Laisse de la marge et protège des temps de respiration.
2. Planifie selon la capacité réelle d'un humain, pas selon une journée idéale.
3. Choisis au maximum 1 à 3 priorités fortes.
4. Une bonne décision peut être de reporter, raccourcir ou supprimer une tâche.
5. Si une tâche est trop coûteuse, propose une version plus petite ou un premier pas.
6. Évite les changements de contexte inutiles.
7. Les tâches exigeantes vont dans les meilleurs créneaux, jamais partout.
8. Si l'énergie est basse ou la journée dense, allège franchement au lieu de compresser.
9. Les formulations doivent être simples, humaines, rassurantes et actionnables.
10. Aide à finir la journée en meilleur état, pas juste avec plus de cases remplies.

═══ FORMAT DE RÉPONSE ═══
Réponds UNIQUEMENT avec un objet JSON valide, rien d'autre :
{
  "summary":"phrase courte qui résume la journée",
  "top3":["priorité 1","priorité 2","priorité 3"],
  "watchouts":["vigilance 1","vigilance 2"],
  "schedule":[
    {"title":"...","startTime":"HH:MM","endTime":"HH:MM","category":"travail|musique|formation|lecture|meditation|personnel","note":"pourquoi ce créneau est utile","taskTitle":"nom de la tâche liée ou vide"}
  ],
  "todos":[
    {"title":"...","category":"travail|musique|formation|lecture|meditation|personnel","priority":"haute|normale|basse","duration":30,"dueDate":"YYYY-MM-DD","note":"pourquoi cette tâche mérite d'être gardée","subtasks":["..."]}
  ]
}`;
}

function showAIErr(msg){const el=document.getElementById('aiErr');if(el){el.textContent=msg;el.style.display='block';}}

async function callAI(apiKey, body){
  if(typeof window.nativeFetch==='function'){
    return window.nativeFetch(AI_API_URL, apiKey, body);
  }
  const res=await fetch(AI_PROXY_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
    body
  });
  if(!res.ok){
    const e=await res.json().catch(()=>({}));
    if(res.status===401){profile.apiKey='';saveLS('arc-profile',profile);}
    throw new Error(e.error?.message||'Erreur API '+res.status);
  }
  return res.json();
}

async function planDay(){
  let apiKey=profile.apiKey||'';
  if(!apiKey){
    const k=window.prompt('Clé API aiprimetech.io\n\nCopiez votre clé depuis aiprimetech.io/keys');
    if(!k||!k.trim())return;
    apiKey=k.trim();profile.apiKey=apiKey;saveLS('arc-profile',profile);
  }
  aiStep='loading';aiSuggs=[];aiSel=new Set();renderAI();
  try{
    const body=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:2000,messages:[{role:'user',content:buildPrompt()}]});
    const data=await callAI(apiKey,body);
    if(!data||!data.content)throw new Error('Réponse invalide');
    const text=(data.content||[]).map(c=>c.text||'').join('');
    const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error('Aucun JSON dans la réponse.');
    const parsed=JSON.parse(m[0]);
    const schedule=Array.isArray(parsed.schedule)?parsed.schedule:[];
    const todos=Array.isArray(parsed.todos)?parsed.todos:[];
    const valid=[
      ...schedule.map(s=>normalizeAISuggestion(s,'event')).filter(Boolean),
      ...todos.map(t=>normalizeAISuggestion(t,'task')).filter(Boolean)
    ];
    if(!valid.length)throw new Error('Aucune suggestion valide générée.');
    aiPlanMeta={
      summary:parsed.summary||'Plan de journée généré',
      top3:Array.isArray(parsed.top3)?parsed.top3.filter(Boolean).slice(0,3):[],
      watchouts:Array.isArray(parsed.watchouts)?parsed.watchouts.filter(Boolean).slice(0,3):[]
    };
    aiSuggs=valid;aiStep='done';renderAI();
  }catch(e){
    if(e.message==='invalid x-api-key'){profile.apiKey='';saveLS('arc-profile',profile);}
    aiErr=e.message;aiStep='error';renderAI();
  }
}

async function sendChatMessage(){
  const input=document.getElementById('chatInput');
  if(!input||!input.value.trim()||chatLoading)return;
  let apiKey=profile.apiKey||'';
  if(!apiKey){
    const k=window.prompt('Clé API aiprimetech.io\n\nCopiez votre clé depuis aiprimetech.io/keys');
    if(!k||!k.trim())return;
    apiKey=k.trim();profile.apiKey=apiKey;saveLS('arc-profile',profile);
  }
  const msg=input.value.trim();input.value='';
  chatHistory.push({role:'user',content:msg,ts:Date.now()});
  saveLS('arc-chat',chatHistory);
  chatLoading=true;renderAI();
  try{
    const {dt,dayEvs,pending,workWindow,lunchWindow,energyStr,dayContextStr}=getAssistantContext();
    const sysMsg=`Tu es l'assistant personnel de l'utilisateur dans son agenda.
Tu dois être concret, rassurant, utile et orienté action.
Tu aides à choisir quoi faire maintenant, réorganiser une journée, simplifier, prioriser, rédiger une réponse courte ou proposer une prochaine action.
Tu réponds en français.
Tu évites le blabla, les généralités et les listes trop longues.
Quand c'est utile, propose un mini plan en 3 étapes maximum.
Date du jour : ${DAY_FULL[dt.getDay()]} ${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}.
Fenêtre de travail : ${workWindow}. Déjeuner : ${lunchWindow}.
Énergie : ${energyStr}. Contexte : ${dayContextStr}.
Événements du jour : ${dayEvs.length?dayEvs.map(e=>`${e.startTime}-${e.endTime} ${e.title}`).join(', '):'Aucun'}.
Tâches en attente : ${pending.length?pending.map(t=>`${t.title} (${t.priority||'normale'})`).join(', '):'Aucune'}.
Si l'utilisateur est flou, suggère la prochaine meilleure action au lieu de rester abstrait.
Quand c'est pertinent, tu peux proposer des actions cliquables.
Réponds de préférence avec un JSON strict :
{
  "reply":"réponse courte et utile",
  "actions":[
    {"type":"create_event","title":"...","startTime":"HH:MM","endTime":"HH:MM","category":"travail|musique|formation|lecture|meditation|personnel","date":"YYYY-MM-DD","note":"..."},
    {"type":"create_task","title":"...","category":"travail|musique|formation|lecture|meditation|personnel","priority":"haute|normale|basse","duration":30,"dueDate":"YYYY-MM-DD","note":"...","subtasks":["..."]}
  ]
}
Si aucune action n'est utile, mets un tableau vide.`;
    const msgs=[{role:'system',content:sysMsg},...chatHistory.slice(-10).map(m=>({role:m.role,content:m.content}))];
    const body=JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1000,messages:msgs.filter(m=>m.role!=='system'),system:sysMsg});
    const data=await callAI(apiKey,body);
    const raw=(data.content||[]).map(c=>c.text||'').join('');
    let reply=raw, actions=[];
    const match=raw.match(/\{[\s\S]*\}/);
    if(match){
      try{
        const parsed=JSON.parse(match[0]);
        reply=parsed.reply||reply;
        actions=Array.isArray(parsed.actions)?parsed.actions.map(a=>normalizeAISuggestion(a,a.type==='create_task'?'task':'event')).filter(Boolean):[];
      }catch{}
    }
    chatHistory.push({role:'assistant',content:reply,actions,ts:Date.now()});
    saveLS('arc-chat',chatHistory);
  }catch(e){
    chatHistory.push({role:'assistant',content:'⚠ Erreur : '+e.message,actions:[],ts:Date.now()});
    saveLS('arc-chat',chatHistory);
  }
  chatLoading=false;renderAI();
  setTimeout(()=>{const b=document.getElementById('chatMessages');if(b)b.scrollTop=b.scrollHeight;},50);
}

function toggleAISugg(i){if(aiSel.has(i))aiSel.delete(i);else aiSel.add(i);renderAI();}
function sendQuickChatMessage(text){
  const input=document.getElementById('chatInput');
  if(!input)return;
  input.value=text;
  sendChatMessage();
}
function addAISuggs(){
  [...aiSel].forEach(i=>applyAISuggestion(aiSuggs[i]));
  aiStep='idle';aiSuggs=[];aiSel=new Set();aiPlanMeta=null;renderAll();
}
function resetAI(){aiStep='idle';aiSuggs=[];aiSel=new Set();aiPlanMeta=null;renderAI();}

function renderAI(){
  const body=document.getElementById('aiBody');
  const footer=document.getElementById('aiFooter');
  const pending=tasks.filter(t=>!t.done);
  const p=profile;
  const chronoLabel={early:'🌅 Lève-tôt',middle:'☀️ Intermédiaire',late:'🌙 Couche-tard'}[p.chronotype||'middle'];
  const energyLabel={low:'🪫 Faible',medium:'⚡ Moyen',high:'🔋 Élevé'}[p.energy||'medium'];

  if(aiTab==='chat'){
    // Chat interface
    footer.innerHTML=`<div class="ai-ft-hint">Une question courte suffit. Le reste doit rester en suggestion, pas en boutons.</div>
    <div class="chat-input-row">
      <textarea class="chat-input" id="chatInput" placeholder="Posez une question sur votre journée…" rows="1" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChatMessage();}"></textarea>
      <button class="chat-send" onclick="sendChatMessage()" ${chatLoading?'disabled':''}>➤</button>
    </div>`;
    let html='';
    if(chatHistory.length){
      html+=`<span class="chat-clear" onclick="clearChat()">Effacer l'historique</span>`;
      html+=`<div class="chat-messages" id="chatMessages">`;
      chatHistory.forEach((m,msgIndex)=>{
        let actionsHtml='';
        if(m.actions?.length){
          actionsHtml=`<div class="ai-chat-actions">
            <div class="ai-ft-hint" style="margin:8px 0 6px">Touchez une suggestion pour l'ajouter directement.</div>
            ${renderCompactActionSections(msgIndex,m.actions)}
          </div>`;
        }
        html+=`<div class="chat-msg ${m.role}${m.content.startsWith('⚠')?'':''}">${escapeHtml(m.content).replace(/\n/g,'<br>')}${actionsHtml}</div>`;
      });
      if(chatLoading)html+=`<div class="chat-msg assistant thinking"><div class="spinner" style="width:16px;height:16px;margin:0"></div></div>`;
      html+=`</div>`;
    } else {
      html=`<div class="premium-empty">
        <div class="ai-empty-icon">💬</div>
        <div class="ai-empty-title">Assistant de journée</div>
        <div class="premium-empty-copy">Demande une prochaine action, un arbitrage, un réagencement de journée ou un brief simple. L'assistant doit t'aider à décider vite, pas juste parler.</div>
        <div class="premium-empty-actions">
          <button class="mbtn" style="height:28px;font-size:11px" onclick="sendQuickChatMessage('Quelle est la prochaine meilleure action pour moi maintenant ?')">Action suivante</button>
        </div>
      </div>`;
    }
    body.innerHTML=html;
    setTimeout(()=>{const b=document.getElementById('chatMessages');if(b)b.scrollTop=b.scrollHeight;},30);
    return;
  }

  // Plan tab
  if(aiStep==='idle'){
    footer.innerHTML=`<div class="ai-ft-row">
      <button class="ai-mode-chip" onclick="cyclePlanMode()"><span>Type</span>${escapeHtml(planModeLabels[aiPlanMode]||'Priorités')}</button>
      <button class="ai-plan-btn" style="flex:1;width:auto" onclick="planDay()">✦ Construire ma journée</button>
    </div>
    <div class="ai-ft-hint">${escapeHtml(planModeHints[aiPlanMode]||'un seul réglage, puis le plan fait le reste')}</div>`;
    let html=`<div class="ai-pill-row">
      <span class="ai-pill">${chronoLabel}</span>
      <span class="ai-pill">⏱${p.maxBlock||90}min</span>
      <span class="ai-pill">${energyLabel}</span>
    </div>`;
    html+=`<div class="ai-ctx" style="margin-bottom:10px"><div class="ai-ctx-title">Ce que l'assistant va faire</div><div>Évaluer la capacité réelle du jour, protéger ton énergie, choisir peu mais bien, et décider quoi faire, quoi planifier et quoi reporter.</div></div>`;
    if(pending.length){
      html+=`<div class="ai-ctx"><div class="ai-ctx-title">${pending.length} tâche${pending.length>1?'s':''} en attente</div>`;
      pending.slice(0,5).forEach(t=>{const cat=CATS[t.category]||CATS.personnel;const pClass={haute:'prio-haute',normale:'prio-normale',basse:'prio-basse'}[t.priority||'normale'];html+=`<div class="ai-ctx-item"><span style="width:5px;height:5px;border-radius:50%;background:${cat.color};display:inline-block;flex-shrink:0"></span><span class="prio-badge ${pClass}" style="font-size:9px">${t.priority||'normale'}</span>${t.title}${t.dueDate?` <span style="color:var(--text3);font-size:10px">📅${t.dueDate}</span>`:''}</div>`;});
      if(pending.length>5)html+=`<div style="font-size:11px;color:var(--text3);margin-top:3px">+${pending.length-5} autres…</div>`;
      html+=`</div>`;
    } else {
      html+=`<div class="premium-empty">
        <div class="ai-empty-icon">✦</div>
        <div class="ai-empty-title">Une journée à façonner</div>
        <div class="premium-empty-copy">Le mode Planifier est plus fort quand il a quelques intentions à arbitrer. Ajoute 2 ou 3 tâches importantes, puis laisse l'assistant construire une journée réaliste.</div>
        <div class="premium-empty-actions">
          <button class="mbtn p" style="height:30px;font-size:11px" onclick="showTaskForm()">Ajouter une tâche</button>
        </div>
      </div>`;
    }
    body.innerHTML=html;
  } else if(aiStep==='loading'){
    footer.innerHTML='';
    body.innerHTML=`<div class="loading-state"><div class="spinner"></div><div style="font-weight:600;color:var(--text)">Claude analyse…</div><div style="font-size:12px;text-align:center">Chronotype · Ultradian · Switch cost</div></div>`;
  } else if(aiStep==='error'){
    footer.innerHTML=`<button class="ai-plan-btn" onclick="planDay()">↺ Réessayer</button>`;
    body.innerHTML=`<div class="error-card"><b>⚠ Erreur</b><br>${aiErr}</div>`;
  } else if(aiStep==='done'){
    footer.innerHTML='';
    let html='';
    if(aiPlanMeta){
      html+=`<div class="ai-decision"><div class="ai-decision-title">Décision recommandée</div><div class="ai-decision-body">${escapeHtml(aiPlanMeta.summary)}</div></div><div class="ai-ctx" style="margin-bottom:10px"><div class="ai-ctx-title">Repères du jour</div>`;
      if(aiPlanMeta.top3?.length)html+=`<div style="font-size:11px;color:var(--text2);margin:6px 0 4px">Top priorités</div>${aiPlanMeta.top3.map(t=>`<div class="ai-ctx-item">• ${escapeHtml(t)}</div>`).join('')}`;
      if(aiPlanMeta.watchouts?.length)html+=`<div style="font-size:11px;color:var(--text2);margin:8px 0 4px">Vigilance</div>${aiPlanMeta.watchouts.map(t=>`<div class="ai-ctx-item">• ${escapeHtml(t)}</div>`).join('')}`;
      html+=`</div>`;
    }
    const wrapped=aiSuggs.map((suggestion,index)=>({suggestion,index}));
    const nowItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='now');
    const planItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='plan');
    const laterItems=wrapped.filter(x=>suggestionBucket(x.suggestion)==='later');
    html+=`<div class="ai-ctx" style="margin-bottom:12px"><div class="ai-ctx-title">Sélection</div><div>${aiSuggs.length} proposition${aiSuggs.length>1?'s':''}. Garde seulement celles qui allègent vraiment ta journée ou renforcent ton cap.</div></div>`;
    html+=renderSuggestionSection("À faire maintenant","protège l'élan",nowItems,true);
    html+=renderSuggestionSection('À planifier','créneaux et to-do utiles',planItems,true);
    html+=renderSuggestionSection('À reporter','à garder pour plus tard',laterItems,true);
    if(aiSel.size>0)html+=`<button class="ai-add-btn" onclick="addAISuggs()">Ajouter ${aiSel.size} élément${aiSel.size>1?'s':''} à l'agenda / to-do</button>`;
    html+=`<div style="text-align:center;margin-top:8px"><button class="mbtn" style="font-size:11px;height:28px" onclick="resetAI()">↩ Recommencer</button></div>`;
    body.innerHTML=html;
  }
}

function clearChat(){chatLoading=false;chatHistory=[];saveLS('arc-chat',chatHistory);renderAI();}

function showUpdateApplied(){
  const el=document.getElementById('updateStatus');
  if(!el)return;
  el.classList.add('show');
  clearTimeout(showUpdateApplied._timer);
  showUpdateApplied._timer=setTimeout(()=>el.classList.remove('show'),3500);
}

function setupAutoUpdate(){
  if(!('serviceWorker' in navigator))return;
  let refreshing=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{
    if(refreshing)return;
    refreshing=true;
    try{sessionStorage.setItem('agenda-update-applied','1');}catch{}
    window.location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg=>{
    const promptUpdate=worker=>{
      if(!worker)return;
      worker.postMessage('SKIP_WAITING');
    };
    const watchInstalling=worker=>{
      if(!worker)return;
      worker.addEventListener('statechange',()=>{
        if(worker.state==='installed' && navigator.serviceWorker.controller){
          promptUpdate(reg.waiting||worker);
        }
      });
    };
    if(reg.waiting)promptUpdate(reg.waiting);
    if(reg.installing)watchInstalling(reg.installing);
    reg.addEventListener('updatefound',()=>watchInstalling(reg.installing));
    const checkForUpdates=()=>reg.update().catch(()=>{});
    setInterval(checkForUpdates,120000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdates();});
    window.addEventListener('online',checkForUpdates);
  }).catch(()=>{});
}

// ── FIREBASE SYNC ───────────────────────────────────────────────────────────
const FB_PROJECT = 'agenda-c6346';
const FB_KEY     = 'AIzaSyB5aJU6a0R44DHf3E6VLT-cf5ndTCH_iWM';
const FB_BASE    = 'https://firestore.googleapis.com/v1/projects/' + FB_PROJECT + '/databases/(default)/documents';
const FB_USER    = 'user-arcange'; // shared user ID - single user app

let syncUnsubscribe = null; // for cleanup

// Convert JS value to Firestore field value format
function toFB(val) {
  if (val === null || val === undefined) return {nullValue: null};
  if (typeof val === 'boolean') return {booleanValue: val};
  if (typeof val === 'number') return {integerValue: String(val)};
  if (typeof val === 'string') return {stringValue: val};
  if (Array.isArray(val)) return {arrayValue: {values: val.map(toFB)}};
  if (typeof val === 'object') return {mapValue: {fields: Object.fromEntries(Object.entries(val).map(([k,v]) => [k, toFB(v)]))}};
  return {stringValue: String(val)};
}

// Convert Firestore field value back to JS
function fromFB(fv) {
  if (!fv) return null;
  if ('nullValue'    in fv) return null;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue'  in fv) return fv.doubleValue;
  if ('stringValue'  in fv) return fv.stringValue;
  if ('arrayValue'   in fv) return (fv.arrayValue.values || []).map(fromFB);
  if ('mapValue'     in fv) return Object.fromEntries(Object.entries(fv.mapValue.fields || {}).map(([k,v]) => [k, fromFB(v)]));
  return null;
}

// Write data to Firestore
async function fbWrite(collection, docId, data) {
  const fields = Object.fromEntries(Object.entries(data).map(([k,v]) => [k, toFB(v)]));
  const url = FB_BASE + '/' + collection + '/' + docId + '?key=' + FB_KEY;
  try {
    await fetch(url, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({fields})
    });
  } catch(e) {
    console.warn('Firebase write error:', e.message);
  }
}

// Read data from Firestore
async function fbRead(collection, docId) {
  const url = FB_BASE + '/' + collection + '/' + docId + '?key=' + FB_KEY;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = await res.json();
    if (!doc.fields) return null;
    return Object.fromEntries(Object.entries(doc.fields).map(([k,v]) => [k, fromFB(v)]));
  } catch(e) {
    console.warn('Firebase read error:', e.message);
    return null;
  }
}

// Push local data to Firebase (called after every local change)
async function syncPush() {
  if (pushSyncTimer) clearTimeout(pushSyncTimer);
  pushSyncTimer = setTimeout(async () => {
    const payload = {
      events: events,
      tasks: tasks,
      notes: notes,
      updatedAt: Date.now()
    };
    await fbWrite('agendas', FB_USER, payload);
    updateSyncStatus('pushed');
  }, 350);
}

// Pull data from Firebase and update local state
async function syncPull() {
  if (syncPullInFlight || document.visibilityState === 'hidden') return false;
  syncPullInFlight = true;
  try {
  const data = await fbRead('agendas', FB_USER);
  if (!data) return false;
  // Only update if remote is newer
  const remoteTime = data.updatedAt || 0;
  const localTime  = parseInt(localStorage.getItem('arc-sync-time') || '0');
  if (remoteTime <= localTime) return false;
  events = data.events || events;
  tasks  = data.tasks  || tasks;
  notes  = data.notes  || notes;
  saveLS('arc-events', events);
  saveLS('arc-tasks',  tasks);
  saveLS('arc-notes',  notes);
  localStorage.setItem('arc-sync-time', String(remoteTime));
  return true;
  } finally {
    syncPullInFlight = false;
  }
}

// Long-poll sync: checks Firebase periodically for changes from other devices
function startSync() {
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    const updated = await syncPull();
    if (updated) {
      renderAll();
      updateSyncStatus('pulled');
    }
  }, SYNC_INTERVAL_MS);
  // Initial pull on start
  syncPull().then(updated => {
    if (updated) renderAll();
  });
}

function updateSyncStatus(state) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const now = new Date().toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
  if (state === 'pushed') {
    el.textContent = '✓ Sync ' + now;
    el.style.color = '#059669';
  } else if (state === 'pulled') {
    el.textContent = '↓ Mis à jour ' + now;
    el.style.color = '#0891b2';
  } else if (state === 'error') {
    el.textContent = '⚠ Hors ligne';
    el.style.color = '#d97706';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
mcViewDate=parseDate(selDate);mcViewDate.setDate(1);
// Apply saved profile settings
profile.darkMode=false;
saveLS('arc-profile',profile);
if(profile.accentColor)applyAccent(profile.accentColor);
document.getElementById('sortPrio').classList.add('on');
requestNotifPermission();
try{
  if(sessionStorage.getItem('agenda-update-applied')==='1'){
    sessionStorage.removeItem('agenda-update-applied');
    setTimeout(showUpdateApplied,300);
  }
}catch{}
renderAll();
startSync();
scheduleNotifications();
setupAutoUpdate();
