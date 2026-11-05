"use strict";
/* DF Academy · Partite — PWA
   Dati su Google Sheets tramite Apps Script (vedi config.js). */
const API=window.DF_CONFIG&&window.DF_CONFIG.API_URL;
const $=id=>document.getElementById(id);
const COACHPHOTO="";
const BALL='<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6l2.6 1.9-1 3.1H6.4l-1-3.1z" fill="currentColor"/></svg>';
const LS={get(k){try{return JSON.parse(localStorage.getItem("df_"+k))}catch(_){return null}},set(k,v){try{localStorage.setItem("df_"+k,JSON.stringify(v))}catch(_){}},del(k){try{localStorage.removeItem("df_"+k)}catch(_){}}};
let S=normState({}),VERSION=null,SESSION=LS.get("session");
let livePick=false,liveConfirm=null,filter="Tutte",editingId=null,confirmId=null,confirmPlayer=null,readOnly=true,saving=false,pollTimer=null;

const newId=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
function normState(st){st=st||{};return{matches:st.matches||[],players:st.players||[],live:st.live||null,
  settings:Object.assign({kid:"",team:"DF Academy",season:"Annata 2018 · Stagione 2026/27",coach:"",coachAlias:""},st.settings||{})}}

/* ---------- comunicazione con Google Sheets ---------- */
async function api(action,data){
  if(!API)throw{code:"config"};
  let r;
  try{r=await fetch(API,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(Object.assign({action},data||{}))})}
  catch(_){throw{code:"offline"}}
  let j;try{j=await r.json()}catch(_){throw{code:"risposta"}}
  if(!j.ok){const e={code:j.error||"errore",data:j};throw e}
  return j;
}
const ERR={offline:"Nessuna connessione. Mostro gli ultimi dati scaricati.",config:"App non configurata: manca l'indirizzo del foglio Google in config.js.",
  credenziali_errate:"Utente o password non corretti.",credenziali_mancanti:"Inserisci utente e password.",sessione_scaduta:"Sessione scaduta: accedi di nuovo.",
  sessione_non_valida:"Sessione non valida: accedi di nuovo.",accesso_richiesto:"Accedi per vedere le partite.",non_autorizzato:"Il tuo utente può solo consultare.",
  conflitto:"I dati sono stati modificati da un altro dispositivo: ho caricato la versione aggiornata, ripeti la modifica."};
const errMsg=e=>ERR[e&&e.code]||"Qualcosa non ha funzionato, riprova tra poco.";

async function commit(mut){
  if(readOnly||saving)return false;
  const next=JSON.parse(JSON.stringify(S));mut(next);
  saving=true;setStatus("Salvataggio in corso…",false);
  try{const j=await api("save",{token:SESSION.token,state:next,baseVersion:VERSION});
    VERSION=j.version;S=normState(next);LS.set("cache",{state:S,version:VERSION});saving=false;render();setStatus("Salvato.",false);setTimeout(()=>{if($("status").textContent==="Salvato.")setStatus("",false)},2500);schedulePoll();return true}
  catch(e){saving=false;
    if(e.code==="conflitto"&&e.data&&e.data.state){S=normState(e.data.state);VERSION=e.data.version;render()}
    if(["sessione_scaduta","sessione_non_valida","accesso_richiesto"].includes(e.code)){logout(errMsg(e));return false}
    setStatus(errMsg(e),true);return false}
}
function setStatus(t,warn){const el=$("status");el.textContent=t;el.className="status"+(warn?" warn":"");el.hidden=!t}

/* ---------- calcoli ---------- */
const result=m=>m.gf>m.ga?"V":m.gf<m.ga?"P":"N";
const norm=s=>(s||"").trim().toLowerCase();
const isKid=n=>!!S.settings.kid&&norm(n)===norm(S.settings.kid);
const sorted=()=>[...S.matches].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.n||0)-(a.n||0));
function fmtDate(d){if(!d)return"";const [y,m,g]=d.split("-").map(Number);return new Date(y,m-1,g).toLocaleDateString("it-IT",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

/* ---------- render ---------- */
function render(){
  const set=S.settings;
  $("teamName").textContent=set.team||"DF Academy";
  $("seasonLine").textContent=set.season||"Stagione 2026/27";
  $("lblUs").textContent="Gol "+(set.team||"DF");
  
  $("settingsBtn").hidden=readOnly;$("addBtn").hidden=readOnly;$("addPlayerForm").hidden=readOnly;
  const list=sorted();
  const team=esc(set.team||"DF Academy");
  let v=0,n=0,p=0,gf=0,ga=0;list.forEach(m=>{const r=result(m);r==="V"?v++:r==="N"?n++:p++;gf+=m.gf||0;ga+=m.ga||0});
  $("sPlayed").textContent=list.length;$("sRecord").textContent=`${v}·${n}·${p}`;$("sGF").textContent=gf;$("sGA").textContent=ga;
  const last=list.slice(0,5).reverse();
  $("formDots").innerHTML=last.map(m=>{const r=result(m);return `<span class="dot r-${r}" title="${esc(m.opp)} ${m.gf}-${m.ga}">${r}</span>`}).join("");
  $("formEmpty").hidden=last.length>0;
  const chronAll=[...list].sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.n||0)-(b.n||0));
  let streak=0;for(let i=chronAll.length-1;i>=0&&result(chronAll[i])==="V";i--)streak++;
  const avg=list.length?(gf/list.length):0;
  $("sStreak").textContent=streak;$("sAvg").textContent=avg.toLocaleString("it-IT",{maximumFractionDigits:1});
  // diretta
  renderLive();
  $("compList").innerHTML=[...new Set(["Campionato",...S.matches.map(m=>m.comp).filter(Boolean)])].map(c=>`<option value="${esc(c)}">`).join("");
  // momento della stagione
  const best=[...list].sort((a,b)=>(b.gf-b.ga)-(a.gf-a.ga))[0];
  const hl=[];
  if(list.length){
    hl.push(v===list.length?[`${v} su ${v}`,"vittorie in stagione, nessuna sconfitta"]:[`${streak}`,streak===1?"vittoria di fila":"vittorie di fila"]);
    hl.push([`${gf} gol`,`fatti in ${list.length} partite, ${ga} subiti`]);
    if(best)hl.push([`${best.gf}–${best.ga}`,`la vittoria più larga, contro ${best.opp}`]);
  }
  $("highlight").innerHTML=hl.map(([a,b])=>`<div class="hl"><strong>${esc(a)}</strong><span>${esc(b)}</span></div>`).join("");
  // casa / trasferta
  const ha=["casa","trasferta"].map(w=>{const ms=list.filter(m=>(m.where==="trasferta"?"trasferta":"casa")===w);const o={w,n:ms.length,v:0,nn:0,p:0,gf:0,ga:0};ms.forEach(m=>{const r=result(m);r==="V"?o.v++:r==="N"?o.nn++:o.p++;o.gf+=m.gf;o.ga+=m.ga});return o});
  const haMax=Math.max(1,...ha.map(o=>Math.max(o.gf,o.ga)));
  $("homeAway").innerHTML=ha.map(o=>`<div class="ha-col"><h4><span>${o.w==="casa"?"In casa":"In trasferta"}</span><span class="num">${o.n} part.</span></h4>
    <div class="ha-row"><span>V · N · P</span><span class="num">${o.v} · ${o.nn} · ${o.p}</span><span></span></div>
    <div class="ha-row"><span>Gol fatti</span><span class="tr"><i style="width:${o.gf/haMax*100}%"></i></span><span class="n">${o.gf}</span></div>
    <div class="ha-row"><span>Gol subiti</span><span class="tr"><i class="ga" style="width:${o.ga/haMax*100}%"></i></span><span class="n">${o.ga}</span></div>
    <div class="ha-row"><span>Media gol</span><span class="num">${o.n?(o.gf/o.n).toLocaleString("it-IT",{maximumFractionDigits:1}):"–"} a partita</span><span></span></div></div>`).join("");

  // marcatori
  const tally={};list.forEach(m=>(m.scorers||[]).forEach(s=>{const k=norm(s.name);if(!k)return;tally[k]=tally[k]||{name:s.name.trim(),goals:0,games:0};tally[k].goals+=Number(s.goals)||0;tally[k].games++}));
  const rank=Object.values(tally).sort((a,b)=>b.goals-a.goals||a.name.localeCompare(b.name));
  const max=rank[0]?rank[0].goals:1;
  // rosa
  const pres={};list.forEach(m=>(m.presenti||[]).forEach(n=>{const k=norm(n);pres[k]=(pres[k]||0)+1}));
  const ROLES=[["Portiere","POR","Portieri"],["Difensore","DIF","Difensori"],["Centrocampista","CEN","Centrocampisti"],["Attaccante","ATT","Attaccanti"],["Da definire","?","Ruolo da definire"]];
  $("rosterCount").textContent=S.players.length?`${S.players.length} giocatori`:"";
  const groups=ROLES.map(([role,tag,plural])=>{const ps=S.players.filter(x=>x.role===role).sort((a,b)=>a.name.localeCompare(b.name));
    if(!ps.length)return"";
    return `<div class="role-group"><h3><span>${plural}</span><span class="num">${ps.length}</span></h3>${ps.map(x=>{
      const g=tally[norm(x.name)]?tally[norm(x.name)].goals:0;
      const del=readOnly?"":(confirmPlayer===x.id
        ?`<button type="button" class="btn btn-danger btn-sm" data-pact="del" data-id="${x.id}" aria-label="Conferma rimozione di ${esc(x.name)}">Rimuovi</button>`
        :`<button type="button" class="x" data-pact="ask" data-id="${x.id}" aria-label="Rimuovi ${esc(x.name)}">✕</button>`);
      return `<div class="player ${isKid(x.name)?"me":""}"><span class="role-tag ${tag}">${tag}</span><span class="pname"><button type="button" class="pbtn" data-pl="${x.id}">${esc(x.name)}</button></span><span class="pg" title="Presenze e gol in stagione">${pres[norm(x.name)]?`<span class="pres">${pres[norm(x.name)]} pres.</span>`:""}${g?BALL+g:""}</span>${del}</div>`}).join("")}</div>`}).join("");
  const cp=COACHPHOTO?`<img class="coach-photo" alt="${esc(set.coach)}" src="${COACHPHOTO}">`:"";
  const coach=set.coach?`<div class="role-group coach"><h3><span>Allenatore</span></h3>${cp}<div class="player"><span class="role-tag ALL">ALL</span><span class="pname">${esc(set.coach)}${set.coachAlias?` <span class="alias">“${esc(set.coachAlias)}”</span>`:""}</span><span></span><span></span></div></div>`:"";
  // grafici
  (function(){
    const chron=[...list].sort((a,b)=>(a.date||"").localeCompare(b.date||"")||(a.n||0)-(b.n||0));
    const svg=$("chartGoals");const W=Math.max(420,chron.length*58+40),H=210,pl=28,pr=8,pt=18,pb=38;
    const max=Math.max(1,...chron.map(m=>Math.max(m.gf,m.ga)));
    const step=max>20?10:max>10?5:2;const top=Math.ceil(max/step)*step;
    const y=v=>pt+(H-pt-pb)*(1-v/top);const cw=(W-pl-pr)/Math.max(1,chron.length),bw=Math.min(16,cw*0.3);
    let s=`<g>`;for(let v=0;v<=top;v+=step){s+=`<line class="grid" x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${v}</text>`}s+=`</g>`;
    const bar=(x,v,c)=>{const h=Math.max(0,y(0)-y(v));if(!h)return"";const r=Math.min(4,h/2,bw/2);const x2=x+bw,yt=y(v),yb=y(0);return `<path class="${c}" d="M${x},${yb}V${yt+r}Q${x},${yt} ${x+r},${yt}H${x2-r}Q${x2},${yt} ${x2},${yt+r}V${yb}Z"/>`};
    chron.forEach((m,i)=>{const cx=pl+cw*i+cw/2;const w=(m.opp||"").split(" ");const label=(w.length>1&&w[0].length<=3?(w[0]===w[0].toUpperCase()?w[1]:w[0][0]+". "+w[1]):w[0]).slice(0,10);
      s+=`<g class="col" data-i="${i}">${bar(cx-bw-1,m.gf,"bar-gf")}${bar(cx+1,m.ga,"bar-ga")}`+
        `<text class="val" x="${cx-bw/2-1}" y="${y(m.gf)-4}" text-anchor="middle">${m.gf}</text>`+
        `<text x="${cx}" y="${H-pb+15}" text-anchor="middle">${esc(label)}</text>`+
        `<text x="${cx}" y="${H-pb+28}" text-anchor="middle">${m.date?m.date.slice(8,10)+"/"+m.date.slice(5,7):""}</text>`+
        `<rect class="hit" x="${pl+cw*i}" y="${pt}" width="${cw}" height="${H-pt}"/></g>`});
    svg.setAttribute("viewBox",`0 0 ${W} ${H}`);svg.innerHTML=s;
    const card=svg.closest(".chart-card");let tip=card.querySelector(".tip");if(!tip){tip=document.createElement("div");tip.className="tip";tip.hidden=true;card.appendChild(tip)}
    const show=e=>{const g=e.target.closest(".col");if(!g){tip.hidden=true;return}const m=chron[+g.dataset.i];const r=card.getBoundingClientRect(),br=g.getBoundingClientRect();
      tip.textContent=`${m.where==="trasferta"?m.opp+" – DF":"DF – "+m.opp}: ${m.where==="trasferta"?m.ga+"–"+m.gf:m.gf+"–"+m.ga}`;tip.style.left=(br.left-r.left+br.width/2)+"px";tip.style.top=(br.top-r.top+24)+"px";tip.hidden=false};
    svg.onpointermove=show;svg.onclick=show;svg.onpointerleave=()=>{tip.hidden=true};
    // presenze
    const pl2=S.players.map(p=>({n:p.name,v:pres[norm(p.name)]||0})).sort((a,b)=>b.v-a.v||a.n.localeCompare(b.n));
    const pm=Math.max(1,chron.length);
    $("presTotal").textContent=`su ${chron.length} partite`;
    $("chartPres").innerHTML=pl2.map(p=>{const sh=p.n.split(" ");const short=sh.length>1?sh[0][0]+". "+sh.slice(1).join(" "):p.n;
      return `<div class="hbar" title="${esc(p.n)}: ${p.v} presenze"><span class="nm">${esc(short)}</span><span class="tr"><i style="width:${p.v/pm*100}%"></i></span><span class="n">${p.v}</span></div>`}).join("");
  })();
  $("roster").innerHTML=(S.players.length||coach)?coach+groups:`<div class="empty" style="grid-column:1/-1">Ancora nessun giocatore in rosa.</div>`;
  const names=[...new Set([...S.players.map(x=>x.name),...rank.map(s=>s.name)])].sort((a,b)=>a.localeCompare(b));
  $("playerList").innerHTML=names.map(x=>`<option value="${esc(x)}">`).join("");
  $("oppList").innerHTML=[...new Set(list.map(m=>m.opp).filter(Boolean))].map(o=>`<option value="${esc(o)}">`).join("");
  // filtri
  const comps=["Tutte",...new Set(list.map(m=>m.comp).filter(Boolean))];
  if(!comps.includes(filter))filter="Tutte";
  $("filters").innerHTML=comps.length>2?comps.map(c=>`<button type="button" class="chip-f" data-c="${esc(c)}" aria-pressed="${c===filter}">${esc(c)}</button>`).join(""):"";
  // partite
  const shown=list.filter(m=>filter==="Tutte"||m.comp===filter);
  $("matches").innerHTML=shown.length?shown.map(m=>{const r=result(m);const lab={V:"Vittoria",N:"Pareggio",P:"Sconfitta"}[r];
    const home=m.where!=="trasferta";
    const teams=home?`<span class="us">${team}</span> – ${esc(m.opp)}`:`${esc(m.opp)} – <span class="us">${team}</span>`;
    const score=home?`${m.gf}–${m.ga}`:`${m.ga}–${m.gf}`;
    const goals=(m.scorers||[]).filter(s=>s.name).map(s=>`<span class="g ${isKid(s.name)?"me":""}">${BALL}${esc(s.name)}${s.goals>1?` ×${s.goals}`:""}</span>`).join("");
    const share=`<button type="button" class="btn btn-ghost btn-sm share-btn" data-act="share" data-id="${m.id}">Condividi</button>`;
    const act=share+(readOnly?"":(confirmId===m.id
      ?`<span class="confirm">Eliminare questa partita?</span><button type="button" class="btn btn-ghost btn-sm" data-act="nodel">No</button><button type="button" class="btn btn-danger btn-sm" data-act="del" data-id="${m.id}">Elimina</button>`
      :`<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${m.id}">Modifica</button><button type="button" class="btn btn-ghost btn-sm" data-act="askdel" data-id="${m.id}">Elimina</button>`));
    return `<article class="match ${r}">
      <div class="meta"><span>${m.date?esc(fmtDate(m.date)):(m.n?m.n+"ª partita":"Data da inserire")}</span><span>·</span><span>${esc(m.comp||"")}</span><span>·</span><span>${home?"In casa":"Trasferta"}</span><span class="pill r-${r}">${lab}</span></div>
      <div class="score num" aria-label="Risultato">${score}</div>
      <div class="teams">${teams}</div>
      ${goals?`<div class="goals-list">${goals}</div>`:""}
      ${(m.presenti||[]).length?`<div class="present"><span class="label">In campo (${m.presenti.length})</span> ${m.presenti.map(n=>`<span class="${isKid(n)?"me":""}">${esc(n.split(" ").slice(-1)[0])}${S.players.filter(p=>p.name.split(" ").slice(-1)[0]===n.split(" ").slice(-1)[0]).length>1?" "+esc(n[0])+".":""}</span>`).join(", ")}</div>`:""}
      ${m.note?`<div class="note"><span class="label">Commento</span>${esc(m.note)}</div>`:(readOnly?"":`<button type="button" class="add-note" data-act="note" data-id="${m.id}">+ Aggiungi commento</button>`)}
      ${act?`<div class="actions">${act}</div>`:""}
    </article>`}).join("")
    :(list.length?`<div class="empty">Nessuna partita in questa competizione.</div>`
      :`<div class="empty"><strong>Ancora nessuna partita</strong>Le partite compariranno qui dopo il prossimo fischio finale.</div>`);
}

/* ---------- form partita ---------- */
let rowSeq=0;
function scorerRow(name="",goals=1){
  const d=document.createElement("div");d.className="scorer-row";rowSeq++;
  d.innerHTML=`<input type="text" list="playerList" placeholder="Nome" aria-label="Nome marcatore" id="sn${rowSeq}" value="${esc(name)}" autocomplete="off">
    <input type="number" min="1" max="20" inputmode="numeric" aria-label="Gol" value="${goals}" id="sg${rowSeq}">
    <button type="button" class="icon-btn" aria-label="Rimuovi marcatore">✕</button>`;
  d.querySelector("button").onclick=()=>{d.remove();checkScorers()};
  d.querySelectorAll("input").forEach(x=>x.addEventListener("input",checkScorers));
  $("scorerRows").appendChild(d);
}
function readScorers(){return [...document.querySelectorAll(".scorer-row")].map(r=>{const [a,b]=r.querySelectorAll("input");return{name:a.value.trim(),goals:Math.max(1,parseInt(b.value)||1)}}).filter(s=>s.name)}
function checkScorers(){
  const gf=parseInt($("fGF").value)||0;const tot=readScorers().reduce((a,s)=>a+s.goals,0);const h=$("scorerHint");
  if(tot>gf){h.textContent=`I marcatori sommano ${tot} gol ma il risultato ne indica ${gf}.`;h.className="hint warn"}
  else if(gf>0&&tot<gf){h.textContent=`${gf-tot} gol senza marcatore (autogol o da completare).`;h.className="hint"}
  else{h.textContent="";h.className="hint"}
}
function setWhere(v){$("fWhere").querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.v===v)))}
function openForm(m){
  editingId=m?m.id:null;$("formTitle").textContent=m?"Modifica partita":"Nuova partita";
  const t=new Date();const iso=new Date(t.getTime()-t.getTimezoneOffset()*6e4).toISOString().slice(0,10);
  $("fDate").value=m?(m.date||""):iso;$("fComp").value=m?.comp||"Campionato";$("fOpp").value=m?.opp||"";
  setWhere(m?.where||"casa");$("fGF").value=m?.gf??0;$("fGA").value=m?.ga??0;$("fNote").value=m?.note||"";
  const pz=new Set((m?.presenti||[]).map(norm));
  $("presRows").innerHTML=[...S.players].sort((a,b)=>a.name.localeCompare(b.name)).map((p,i)=>`<label class="pres-item"><input type="checkbox" id="pr${i}" value="${esc(p.name)}"${pz.has(norm(p.name))?" checked":""}> ${esc(p.name)}</label>`).join("");
  $("scorerRows").innerHTML="";(m?.scorers||[]).forEach(s=>scorerRow(s.name,s.goals));
  $("formError").hidden=true;checkScorers();$("sheetBg").hidden=false;setTimeout(()=>$("fOpp").focus(),50);
}
const closeForm=()=>{$("sheetBg").hidden=true};
$("addBtn").onclick=()=>openForm(null);
$("cancelBtn").onclick=closeForm;
$("sheetBg").addEventListener("click",e=>{if(e.target===$("sheetBg"))closeForm()});
$("fWhere").addEventListener("click",e=>{const b=e.target.closest("button");if(b)setWhere(b.dataset.v)});
$("addScorer").onclick=()=>{scorerRow();const r=document.querySelectorAll(".scorer-row");r[r.length-1].querySelector("input").focus()};
$("fGF").addEventListener("input",checkScorers);
$("matchForm").addEventListener("submit",async e=>{
  e.preventDefault();const err=$("formError");
  const opp=$("fOpp").value.trim();const date=$("fDate").value;
  if(!opp){err.textContent="Inserisci il nome dell'avversario.";err.hidden=false;return}
  const prev=S.matches.find(x=>x.id===editingId);const m={id:editingId||newId("m"),n:prev?prev.n:(Math.max(0,...S.matches.map(x=>x.n||0))+1),date,opp,comp:$("fComp").value,where:$("fWhere").querySelector('[aria-pressed="true"]').dataset.v,
    gf:Math.max(0,parseInt($("fGF").value)||0),ga:Math.max(0,parseInt($("fGA").value)||0),scorers:readScorers(),presenti:[...document.querySelectorAll("#presRows input:checked")].map(i=>i.value),note:$("fNote").value.trim()};
  $("saveBtn").disabled=true;
  const ok=await commit(st=>{const i=st.matches.findIndex(x=>x.id===m.id);if(i>=0)st.matches[i]=m;else st.matches.push(m)});
  $("saveBtn").disabled=false;
  if(ok)closeForm();else{err.textContent=$("status").textContent||"Salvataggio non riuscito.";err.hidden=false}
});

/* ---------- azioni ---------- */
$("matches").addEventListener("click",async e=>{
  const b=e.target.closest("[data-act]");if(!b)return;const id=b.dataset.id;
  if(b.dataset.act==="edit")openForm(S.matches.find(m=>m.id===id));
  if(b.dataset.act==="note"){openForm(S.matches.find(m=>m.id===id));setTimeout(()=>{$("fNote").scrollIntoView({block:"center"});$("fNote").focus()},80)}
  if(b.dataset.act==="share"){const m=S.matches.find(x=>x.id===id);const txt=shareText(m);
    await shareOut(txt,b);return}
  if(b.dataset.act==="askdel"){confirmId=id;render()}
  if(b.dataset.act==="nodel"){confirmId=null;render()}
  if(b.dataset.act==="del"){confirmId=null;await commit(st=>{st.matches=st.matches.filter(m=>m.id!==id)});render()}
});
$("roster").addEventListener("click",async e=>{
  const pb=e.target.closest("[data-pl]");if(pb){openPlayer(pb.dataset.pl);return}
  const b=e.target.closest("[data-pact]");if(!b)return;const id=b.dataset.id;
  if(b.dataset.pact==="ask"){confirmPlayer=id;render();return}
  confirmPlayer=null;await commit(st=>{st.players=st.players.filter(x=>x.id!==id)});render();
});
$("addPlayerForm").addEventListener("submit",async e=>{
  e.preventDefault();const name=$("pName").value.trim().replace(/\s+/g," ");if(!name)return;
  if(S.players.some(x=>norm(x.name)===norm(name))){$("pName").select();setStatus(name+" è già in rosa.",true);return}
  await commit(st=>{st.players.push({id:newId("p"),name,role:$("pRole").value})});
});
$("filters").addEventListener("click",e=>{const b=e.target.closest("[data-c]");if(b){filter=b.dataset.c;render()}});

/* ---------- diretta ---------- */
const nowHM=()=>new Date().toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"});
const shortName=n=>{const p=n.split(" ");return p.length>1?p.slice(1).join(" "):n};
function renderLive(){updateAlertBar();
  const L=S.live,box=$("liveBox"),sec=$("liveSec");const team=S.settings.team||"DF Academy";
  if(!L){sec.hidden=readOnly;box.innerHTML=readOnly?"":`<div class="live-start"><span>Nessuna partita in corso.</span><button type="button" class="btn btn-primary btn-sm" data-live="open">● Avvia diretta</button></div>`;return}
  sec.hidden=false;const home=L.where!=="trasferta";
  const left=home?team:L.opp,right=home?L.opp:team,ls=home?L.gf:L.ga,rs=home?L.ga:L.gf;
  const ev=[...(L.events||[])].reverse().map(e=>`<li class="${e.type}"><span class="t">${esc(e.t)}</span><span class="ev">${esc(e.text)}</span></li>`).join("");
  const pool=(L.presenti&&L.presenti.length?L.presenti:S.players.map(p=>p.name)).slice().sort((a,b)=>shortName(a).localeCompare(shortName(b)));
  const ctrl=readOnly?"":`
    <div class="live-ctrl"><button type="button" class="btn btn-goal" data-live="gol">+ Gol ${esc(team.split(" ")[0])}</button><button type="button" class="btn btn-goal-opp" data-live="golavv">+ Gol ${esc(L.opp)}</button></div>
    ${livePick?`<div class="live-pick"><span class="label">Chi ha segnato?</span><div class="opts">${pool.map(n=>`<button type="button" data-live="scorer" data-n="${esc(n)}">${esc(shortName(n))}</button>`).join("")}<button type="button" data-live="scorer" data-n="">Non so</button></div><button type="button" class="btn btn-ghost btn-sm" data-live="pickclose">Annulla</button></div>`:""}
    <div class="live-quick">${["Inizio partita","Fine primo tempo","Inizio ripresa","Grande parata!","Palo!","Cambio"].map(q=>`<button type="button" data-live="quick" data-q="${q}">${q}</button>`).join("")}</div>
    <form class="live-note" id="liveNote"><input type="text" id="liveNoteTxt" placeholder="Scrivi un aggiornamento…" autocomplete="off"><button type="submit" class="btn btn-ghost btn-sm">Pubblica</button></form>`;
  const foot=readOnly?`<span class="status">La pagina si aggiorna da sola a ogni novità.</span>`:
    (liveConfirm==="end"?`<span class="confirm" style="color:var(--fg)">Chiudere la diretta e salvare la partita?</span><span style="display:flex;gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-live="no">No</button><button type="button" class="btn btn-primary btn-sm" data-live="endok">Salva partita</button></span>`
    :liveConfirm==="cancel"?`<span class="confirm">Annullare la diretta senza salvare?</span><span style="display:flex;gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-live="no">No</button><button type="button" class="btn btn-danger btn-sm" data-live="cancelok">Annulla diretta</button></span>`
    :`<span style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn btn-ghost btn-sm" data-live="undo"${(L.events||[]).length?"":" disabled"}>Annulla ultimo</button><button type="button" class="btn btn-ghost btn-sm" data-live="cancel">Annulla diretta</button></span><button type="button" class="btn btn-primary btn-sm" data-live="end">Fine partita</button>`);
  box.innerHTML=`<div class="live-card">
    <div class="live-top"><span class="live-badge"><i></i>DIRETTA</span><span>${esc(L.comp||"")}</span><span>·</span><span>${home?"In casa":"In trasferta"}</span>${L.updated?`<span>· agg. ${esc(L.updated)}</span>`:""}</div>
    <div class="live-score"><span class="tm ${home?"us":""}">${esc(left)}</span><span class="sc">${ls}–${rs}</span><span class="tm ${home?"":"us"}">${esc(right)}</span></div>
    ${ctrl}
    ${ev?`<ul class="feed">${ev}</ul>`:`<div class="status">Ancora nessun aggiornamento.</div>`}
    <div class="live-foot">${foot}<button type="button" class="btn btn-ghost btn-sm share-btn" data-live="share">Condividi</button></div>
  </div>`;
  const nf=$("liveNote");if(nf)nf.onsubmit=async e=>{e.preventDefault();const t=$("liveNoteTxt").value.trim();if(!t)return;await liveEvent({type:"nota",text:t})};
}
async function liveEvent(e,mut){const t=nowHM();e.t=t;return commit(st=>{const L=st.live;if(!L)return;L.events=L.events||[];L.events.push(e);L.updated=t;if(mut)mut(L)})}
function liveShare(){const L=S.live;const team=S.settings.team||"DF Academy";const home=L.where!=="trasferta";
  const line=home?`${team} ${L.gf}–${L.ga} ${L.opp}`:`${L.opp} ${L.ga}–${L.gf} ${team}`;const last=(L.events||[]).slice(-1)[0];
  return `🔴 IN DIRETTA · ${line}`+(last?`\n${last.t} ${last.text}`:"")}
$("liveBox").addEventListener("click",async e=>{const b=e.target.closest("[data-live]");if(!b)return;const a=b.dataset.live;const L=S.live;
  if(a==="open"){openLiveForm();return}
  if(a==="share"){await shareOut(liveShare(),b);return}
  if(a==="gol"){livePick=true;renderLive();return}
  if(a==="pickclose"){livePick=false;renderLive();return}
  if(a==="scorer"){livePick=false;const n=b.dataset.n;const sc=L.gf+1;const txt=`GOL ${S.settings.team||"DF"}! ${n?shortName(n)+" · ":""}${L.where==="trasferta"?(L.ga+"–"+sc):(sc+"–"+L.ga)}`;
    await liveEvent({type:"gol",text:txt,scorer:n},x=>{x.gf+=1});return}
  if(a==="golavv"){const sc=L.ga+1;await liveEvent({type:"golavv",text:`Gol ${L.opp} · ${L.where==="trasferta"?(sc+"–"+L.gf):(L.gf+"–"+sc)}`},x=>{x.ga+=1});return}
  if(a==="quick"){await liveEvent({type:"nota",text:b.dataset.q});return}
  if(a==="undo"){await commit(st=>{const x=st.live;const ev=(x.events||[]).pop();if(ev){if(ev.type==="gol")x.gf=Math.max(0,x.gf-1);if(ev.type==="golavv")x.ga=Math.max(0,x.ga-1)}x.updated=nowHM()});return}
  if(a==="end"||a==="cancel"){liveConfirm=a;renderLive();return}
  if(a==="no"){liveConfirm=null;renderLive();return}
  if(a==="cancelok"){liveConfirm=null;await commit(st=>{st.live=null});return}
  if(a==="endok"){liveConfirm=null;await commit(st=>{const x=st.live;if(!x)return;const tally={};(x.events||[]).filter(ev=>ev.type==="gol"&&ev.scorer).forEach(ev=>{tally[ev.scorer]=(tally[ev.scorer]||0)+1});
    const n=Math.max(0,...st.matches.map(m=>m.n||0))+1;
    st.matches.push({id:newId("m"),n,date:x.date,opp:x.opp,comp:x.comp,where:x.where,gf:x.gf,ga:x.ga,scorers:Object.entries(tally).map(([name,goals])=>({name,goals})),presenti:x.presenti||[],note:""});st.live=null});return}
});
function openLiveForm(){$("lOpp").value="";$("lWhere").value="casa";$("lComp").value="Campionato";$("liveErr").hidden=true;
  $("lPres").innerHTML=[...S.players].sort((a,b)=>a.name.localeCompare(b.name)).map((p,i)=>`<label class="pres-item"><input type="checkbox" id="lp${i}" value="${esc(p.name)}"> ${esc(p.name)}</label>`).join("");
  $("liveBg").hidden=false;setTimeout(()=>$("lOpp").focus(),50)}
$("liveCancel").onclick=()=>$("liveBg").hidden=true;
$("liveBg").addEventListener("click",e=>{if(e.target===$("liveBg"))$("liveBg").hidden=true});
$("liveForm").addEventListener("submit",async e=>{e.preventDefault();const opp=$("lOpp").value.trim();if(!opp){$("liveErr").textContent="Inserisci l'avversario.";$("liveErr").hidden=false;return}
  const t=new Date();const date=new Date(t.getTime()-t.getTimezoneOffset()*6e4).toISOString().slice(0,10);
  const live={opp,where:$("lWhere").value,comp:$("lComp").value.trim()||"Campionato",date,gf:0,ga:0,events:[],updated:nowHM(),presenti:[...document.querySelectorAll("#lPres input:checked")].map(i=>i.value)};
  const ok=await commit(st=>{st.live=live});if(ok)$("liveBg").hidden=true;else{$("liveErr").textContent=$("status").textContent||"Non riesco ad avviare la diretta.";$("liveErr").hidden=false}});

/* ---------- condividi ---------- */
async function shareOut(txt,btn){
  if(navigator.share){try{await navigator.share({text:txt});return}catch(e){if(e&&e.name==="AbortError")return}}
  try{await navigator.clipboard.writeText(txt);const o=btn.textContent;btn.textContent="Copiato!";setTimeout(()=>{btn.textContent=o},1800)}
  catch(_){ $("shareText").value=txt;$("shareBg").hidden=false;setTimeout(()=>{$("shareText").focus();$("shareText").select()},50)}}
function shareText(m){const team=S.settings.team||"DF Academy";const home=m.where!=="trasferta";
  const line=home?`${team} ${m.gf}–${m.ga} ${m.opp}`:`${m.opp} ${m.ga}–${m.gf} ${team}`;
  const gl=(m.scorers||[]).filter(s=>s.name).map(s=>`${s.name.split(" ").slice(-1)[0]}${s.goals>1?" "+s.goals:""}`).join(", ");
  return `⚽ ${line}\n${[m.comp,m.date?fmtDate(m.date):""].filter(Boolean).join(" · ")}`+(gl?`\nGol: ${gl}`:"")+(m.note?`\n\n${m.note}`:"");}
$("shareClose").onclick=()=>$("shareBg").hidden=true;
$("shareBg").addEventListener("click",e=>{if(e.target===$("shareBg"))$("shareBg").hidden=true});

/* ---------- scheda giocatore ---------- */
function openPlayer(id){const p=S.players.find(x=>x.id===id);if(!p)return;const k=norm(p.name);
  const chron=[...S.matches].sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.n||0)-(a.n||0));
  const played=chron.filter(m=>(m.presenti||[]).some(n=>norm(n)===k));
  const goals=chron.reduce((t,m)=>t+((m.scorers||[]).filter(s=>norm(s.name)===k).reduce((a,s)=>a+(+s.goals||0),0)),0);
  const rows=chron.map(m=>{const inn=(m.presenti||[]).some(n=>norm(n)===k);const g=(m.scorers||[]).filter(s=>norm(s.name)===k).reduce((a,s)=>a+(+s.goals||0),0);const home=m.where!=="trasferta";
    return `<li class="${inn?"":"out"}"><span>${m.date?m.date.slice(8,10)+"/"+m.date.slice(5,7):"–"}</span><span>${esc(m.opp)} <span class="res">${home?m.gf+"–"+m.ga:m.ga+"–"+m.gf}</span></span><span>${inn?(g?`<span class="gl">${g} ${g>1?"gol":"gol"}</span>`:"in campo"):"assente"}</span></li>`}).join("");
  $("playerSheet").innerHTML=`<h3 id="psName">${esc(p.name)}</h3><span class="label">${esc(p.role||"")}</span>
    <div class="ps-stats"><div><span class="label">Presenze</span><b class="num">${played.length}/${chron.length}</b></div><div><span class="label">Gol</span><b class="num">${goals}</b></div><div><span class="label">Vittorie</span><b class="num">${played.filter(m=>result(m)==="V").length}</b></div></div>
    <ul class="ps-list">${rows}</ul>
    <div class="sheet-actions"><button type="button" class="btn btn-primary" id="psClose">Chiudi</button></div>`;
  $("playerBg").hidden=false;$("psClose").onclick=()=>$("playerBg").hidden=true;setTimeout(()=>$("psClose").focus(),50);}
$("playerBg").addEventListener("click",e=>{if(e.target===$("playerBg"))$("playerBg").hidden=true});

/* ---------- impostazioni ---------- */
$("settingsBtn").onclick=()=>{$("sKid").value=S.settings.kid||"";$("sTeam").value=S.settings.team||"DF Academy";$("sSeason").value=S.settings.season||"";$("sCoach").value=S.settings.coach||"";$("sAlias").value=S.settings.coachAlias||"";$("settingsBg").hidden=false;setTimeout(()=>$("sKid").focus(),50)};
$("settingsCancel").onclick=()=>$("settingsBg").hidden=true;
$("settingsBg").addEventListener("click",e=>{if(e.target===$("settingsBg"))$("settingsBg").hidden=true});
$("settingsForm").addEventListener("submit",async e=>{e.preventDefault();
  const s={kid:$("sKid").value.trim(),team:$("sTeam").value.trim()||"DF Academy",season:$("sSeason").value.trim()||"Stagione 2026/27",coach:$("sCoach").value.trim(),coachAlias:$("sAlias").value.trim()};
  $("settingsBg").hidden=true;await commit(st=>{st.settings=s});});
document.addEventListener("keydown",e=>{if(e.key==="Escape"){closeForm();$("settingsBg").hidden=true;$("playerBg").hidden=true;$("shareBg").hidden=true;$("liveBg").hidden=true}});


/* ---------- accesso ---------- */
function showLogin(msg){$("app").hidden=true;$("login").hidden=false;$("loginErr").textContent=msg||"";$("loginErr").hidden=!msg;setTimeout(()=>$("lgUser").focus(),50)}
function logout(msg){SESSION=null;LS.del("session");LS.del("cache");clearTimeout(pollTimer);S=normState({});VERSION=null;showLogin(msg)}
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();askNotifyOnce();const btn=$("lgBtn");btn.disabled=true;$("loginErr").hidden=true;
  try{const j=await api("login",{user:$("lgUser").value,pass:$("lgPass").value});SESSION={token:j.token,role:j.role,user:j.user};LS.set("session",SESSION);$("lgPass").value="";await boot()}
  catch(err){$("loginErr").textContent=errMsg(err);$("loginErr").hidden=false}
  finally{btn.disabled=false}});
$("logoutBtn").onclick=()=>logout("");

/* ---------- aggiornamento automatico ---------- */
const busy=()=>!$("sheetBg").hidden||!$("settingsBg").hidden||!$("liveBg").hidden||livePick||liveConfirm||(document.activeElement&&document.activeElement.closest&&document.activeElement.closest("#app input,#app textarea,#app select"));
let liveSeen=false,toastTimer;
function showToast(txt,opp){const t=$("goalToast");t.textContent=txt;t.className="goalToast"+(opp?" opp":"");t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.hidden=true},9000)}
function systemNotify(title,body){try{if(!("Notification" in window)||Notification.permission!=="granted")return;
  if(navigator.serviceWorker&&navigator.serviceWorker.ready){navigator.serviceWorker.ready.then(r=>r.showNotification(title,{body,icon:"icons/icon-192.png",badge:"icons/icon-192.png",tag:"df-live",renotify:true,vibrate:[200,100,200]}))}
  else new Notification(title,{body,icon:"icons/icon-192.png"})}catch(_){}}
function notifyLive(prev,now){
  if(!now)return;const team=S.settings.team||"DF Academy";const home=now.where!=="trasferta";
  const score=home?`${team} ${now.gf}–${now.ga} ${now.opp}`:`${now.opp} ${now.ga}–${now.gf} ${team}`;
  if(!prev){const m=`Diretta iniziata: ${team} - ${now.opp}`;showToast("🔴 "+m,false);systemNotify("DF Academy",m);return}
  const pe=(prev.events||[]).length,ne=(now.events||[]);if(ne.length<=pe)return;
  const fresh=ne.slice(pe).filter(e=>e.type==="gol"||e.type==="golavv");if(!fresh.length)return;
  const last=fresh[fresh.length-1],ours=last.type==="gol";
  const head=ours?"⚽ GOL DF ACADEMY!":"Gol avversario";
  showToast(`${head} ${score}${ours&&last.scorer?" · "+last.scorer:""}`,!ours);
  try{if(navigator.vibrate)navigator.vibrate(ours?[250,100,250,100,400]:[300])}catch(_){}
  systemNotify(head,`${score}${ours&&last.scorer?" · segna "+last.scorer:""}`)}
function updateAlertBar(){const b=$("alertBar");if(!b)return;b.hidden=!(S.live&&"Notification" in window&&Notification.permission==="default")}
/* Il permesso lo decide sempre il telefono: lo chiedo da solo al primo tocco (accesso o primo tap), senza che serva cercare il pulsante */
function askNotifyOnce(){try{if("Notification" in window&&Notification.permission==="default"&&!LS.get("askedNotify")){LS.set("askedNotify",1);Notification.requestPermission().then(updateAlertBar).catch(()=>{})}}catch(_){}}
document.addEventListener("click",askNotifyOnce,{once:true,capture:true});
$("alertBtn").onclick=async()=>{try{await Notification.requestPermission()}catch(_){}updateAlertBar()};
async function refresh(force){
  if(!SESSION||saving)return;
  try{
    if(!force&&VERSION){const v=await api("version",{token:SESSION.token});if(v.version===VERSION)return}
    const j=await api("get",{token:SESSION.token});
    if(j.role!==SESSION.role){SESSION.role=j.role;LS.set("session",SESSION)}
    readOnly=j.role!=="admin";
    const prevLive=S.live;S=normState(j.state);VERSION=j.version;LS.set("cache",{state:S,version:VERSION});
    if(liveSeen)notifyLive(prevLive,S.live);liveSeen=true;
    if(force||!busy())render();
    $("offline").hidden=true;
  }catch(e){
    if(["sessione_scaduta","sessione_non_valida","accesso_richiesto"].includes(e.code)){logout(errMsg(e));return}
    if(e.code==="offline")$("offline").hidden=false;
  }
}
function schedulePoll(){clearTimeout(pollTimer);if(!SESSION)return;const ms=S.live?5000:90000;pollTimer=setTimeout(async()=>{if(document.visibilityState==="visible"||S.live)await refresh(false);schedulePoll()},ms)}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&SESSION){refresh(false).then(schedulePoll)}});

/* ---------- avvio ---------- */
async function boot(){
  if(!SESSION){showLogin("");return}
  $("login").hidden=true;$("app").hidden=false;
  readOnly=SESSION.role!=="admin";
  $("whoami").textContent=SESSION.user+(readOnly?"":" · modifica");
  const c=LS.get("cache");if(c&&c.state){S=normState(c.state);VERSION=c.version;render()}else{setStatus("Caricamento delle partite…",false);render()}
  await refresh(true);if($("status").textContent==="Caricamento delle partite…")setStatus("",false);
  maybeSeed();schedulePoll();
}
async function maybeSeed(){
  const box=$("seedBox");box.hidden=true;
  if(readOnly||S.matches.length||S.players.length)return;
  box.hidden=false;
}
$("seedBtn").onclick=async()=>{const b=$("seedBtn");b.disabled=true;
  try{const r=await fetch("seed.json",{cache:"no-store"});const seed=await r.json();
    const ok=await commit(st=>{st.matches=seed.matches||[];st.players=seed.players||[];st.settings=Object.assign(st.settings,seed.settings||{});st.live=null});
    if(ok)$("seedBox").hidden=true}
  catch(_){setStatus("Non riesco a leggere i dati iniziali.",true)}finally{b.disabled=false}};

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}
boot();
