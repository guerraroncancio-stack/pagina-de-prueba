(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = v => v ? new Date(v).toLocaleString("es-CO",{dateStyle:"medium",timeStyle:"short"}) : "Fecha por confirmar";
  const fileExt = f => (f.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g,"");
  const publicBucket = "national-public-assets";
  const privateBucket = "national-private-assets";
  let teams = [], activities = [], scores = [];
  const client = () => window.NTApp?.client;
  const profile = () => window.NTApp?.profile;
  const feedback = (id,msg,ok=false) => { const el=$(id); if(el){el.textContent=msg;el.classList.toggle("success",ok);} };
  const upload = async (file, folder, isPublic=false) => {
    if(!file) return null;
    const c=client(); const path=`${folder}/${crypto.randomUUID()}.${fileExt(file)}`;
    const target=isPublic?publicBucket:privateBucket;
    const {error}=await c.storage.from(target).upload(path,file,{upsert:false,contentType:file.type});
    if(error) throw error;
    if(isPublic) return c.storage.from(publicBucket).getPublicUrl(path).data.publicUrl;
    return path;
  };
  function buildPlayerFields(){
    const host=$("playerProfileFields"); if(!host)return;
    host.innerHTML=Array.from({length:7},(_,i)=>`<fieldset class="player-profile-card"><legend>JUGADOR ${i+1}${i<6?" *":" (OPCIONAL)"}</legend>
      <label>NICK DEL JUEGO<input data-player="nick"  ${i<6 ? "required" : ""} maxlength="40" placeholder="Nick exacto"></label>
      <div class="form-grid"><label>ID DEL JUEGO<input data-player="game_id"  ${i<6 ? "required" : ""} maxlength="40"></label><label>EDAD<input data-player="age" type="number" min="1" max="99"  ${i<6 ? "required" : ""}></label></div>
      <label>PAÍS<input data-player="country"  ${i<6 ? "required" : ""} maxlength="50" placeholder="Colombia"></label>
      <label>FOTO DE CUENTA / PERFIL<input data-player="account_photo" type="file" accept="image/*"  ${i<6 ? "required" : ""}></label>
      <label>FOTO REAL DEL JUGADOR<input data-player="real_photo" type="file" accept="image/*"  ${i<6 ? "required" : ""}></label>
    </fieldset>`).join("");
  }
  function readRoster(){
    const cards=[...document.querySelectorAll(".player-profile-card")];
    return cards.map((card,i)=>({card,index:i+1,nick:card.querySelector('[data-player="nick"]').value.trim(),game_id:card.querySelector('[data-player="game_id"]').value.trim(),age:Number(card.querySelector('[data-player="age"]').value),country:card.querySelector('[data-player="country"]').value.trim(),account:card.querySelector('[data-player="account_photo"]').files[0],real:card.querySelector('[data-player="real_photo"]').files[0]})).filter(p=>p.nick || p.game_id || p.account || p.real);
  }
  async function registerTeam(e){
    e.preventDefault(); const c=client(); if(!c)return feedback("teamProfileFeedback","Conecta primero la plataforma con Supabase.");
    const roster=readRoster(); if(roster.length<6||roster.length>7)return feedback("teamProfileFeedback","El roster debe tener entre 6 y 7 jugadores.");
    if(roster.slice(0,6).some(p=>!p.nick||!p.game_id||!p.age||!p.country||!p.account||!p.real))return feedback("teamProfileFeedback","Completa todos los datos y las dos fotos de cada uno de los 6 titulares.");
    const btn=$("saveTeamProfile");btn.disabled=true;
    try{
      const logo=await upload($("profileTeamLogo").files[0],"team-logos",true);
      const {data:team,error}=await c.from("teams").insert({name:$("profileTeamName").value.trim(),tag:$("profileTeamTag").value.trim(),manager_name:$("profileManager").value.trim(),country:$("profileCountry").value.trim(),logo_url:logo,status:"pending"}).select("id").single();
      if(error)throw error;
      const players=[];
      for(const p of roster){
        const account=await upload(p.account,`private/${team.id}/accounts`,false);
        const real=await upload(p.real,`private/${team.id}/players`,false);
        players.push({team_id:team.id,slot:p.index,nick:p.nick,game_id:p.game_id,age:p.age,country:p.country,account_photo_path:account,real_photo_path:real});
      }
      const {error:pe}=await c.from("team_players").insert(players); if(pe)throw pe;
      $("teamProfileForm").reset();feedback("teamProfileFeedback","Equipo enviado al directorio. Quedará visible cuando el staff lo apruebe.",true);await loadAll();
    }catch(err){feedback("teamProfileFeedback",`No se pudo registrar: ${err.message}`);console.error(err);}
    finally{btn.disabled=false;}
  }
  async function loadAll(){
    const c=client(); if(!c)return;
    const [t,a,s]=await Promise.all([
      c.from("teams").select("id,name,tag,country,logo_url,status,created_at").eq("status","approved").order("name"),
      c.from("activities").select("*").eq("published",true).order("starts_at"),
      c.from("team_scores").select("team_id,event_title,placement,placement_points,kills,booyah,total_points,teams(name,tag,logo_url)").order("total_points",{ascending:false})
    ]);
    if(!t.error){teams=t.data||[];renderTeams();}
    if(!a.error){activities=a.data||[];renderActivities();}
    if(!s.error){scores=s.data||[];renderLeaderboard();}
    if(profile())loadStaff();
  }
  function renderTeams(){
    const host=$("teamGrid"); if(!host)return;
    if(!teams.length){host.innerHTML='<div class="loading-card">AÚN NO HAY EQUIPOS APROBADOS.</div>';return;}
    host.innerHTML=teams.map(t=>`<article class="team-card"><img class="team-logo" src="${esc(t.logo_url||"")}" alt="Logo ${esc(t.name)}"><div><b>${esc(t.name)}</b><small>[${esc(t.tag)}] · ${esc(t.country)}</small></div></article>`).join("");
  }
  function renderActivities(){
    const host=$("activityGrid");if(!host)return;
    host.innerHTML=activities.length?activities.map(a=>`<article class="event-card extended-event">${a.image_url?`<img class="activity-cover" src="${esc(a.image_url)}" alt="">`:""}<div class="event-card-body"><span class="micro">${esc(a.kind.toUpperCase())} · ${fmt(a.starts_at)}</span><h3>${esc(a.title)}</h3><p>${esc(a.description||"Actividad oficial de National Tournaments.")}</p><div class="activity-meta"><span>INSCRIPCIÓN: ${esc(a.fee_text||"Por confirmar")}</span><span>PREMIOS: ${esc(a.prize_text||"Por confirmar")}</span><span>PAGO: ${esc(a.payment_instructions||"Consultar con organización")}</span><span>GRUPO: ${esc(a.group_link||"Por anunciar")}</span><span>SALAS: ${Number(a.room_count)||0}</span></div><button class="button primary" data-activity-join="${a.id}">INSCRIBIR EQUIPO ↗</button>${a.link_url?`<a class="text-link" href="${esc(a.link_url)}" target="_blank" rel="noopener">LINK / GRUPO ↗</a>`:""}</div></article>`).join(""):'<div class="loading-card">NO HAY ACTIVIDADES PUBLICADAS.</div>';
  }
  function renderLeaderboard(){
    const body=$("leaderboardBody");if(!body)return;
    const agg=new Map();
    scores.forEach(s=>{const id=s.team_id;const cur=agg.get(id)||{team:s.teams,placement:0,kills:0,booyah:0,total:0};cur.placement+=Number(s.placement_points)||0;cur.kills+=Number(s.kills)||0;cur.booyah+=Number(s.booyah)||0;cur.total+=Number(s.total_points)||0;agg.set(id,cur);});
    const rows=[...agg.values()].sort((a,b)=>b.total-a.total);
    body.innerHTML=rows.length?rows.map((r,i)=>`<tr><td>${i+1}</td><td><b>${esc(r.team?.name||"Equipo")}</b> <small>[${esc(r.team?.tag||"")}]</small></td><td>${r.placement}</td><td>${r.kills}</td><td>${r.booyah}</td><td><b>${r.total}</b></td></tr>`).join(""):'<tr><td colspan="6" class="empty-cell">AÚN NO HAY PUNTUACIONES.</td></tr>';
  }
  function ensureJoinDialog(){
    if($("activityJoinDialog"))return;
    document.body.insertAdjacentHTML("beforeend",`<div class="admin-gate" id="activityJoinDialog" hidden><div class="gate-card"><button class="close-gate" id="closeJoinDialog" type="button">×</button><span class="micro">ACTIVITY CHECK-IN</span><h2>INSCRIBIR <em>EQUIPO.</em></h2><form id="activityJoinForm"><input id="joinActivityId" type="hidden"><label>EQUIPO REGISTRADO<select id="joinTeam" required></select></label><label>NOMBRE DEL MANAGER<input id="joinManager" required></label><label>COMPROBANTE DE PAGO<input id="joinProof" type="file" accept="image/*" required></label><button class="button primary full" type="submit">ENVIAR INSCRIPCIÓN ↗</button><p id="joinFeedback" class="form-feedback"></p></form></div></div>`);
    $("closeJoinDialog").addEventListener("click",()=>$("activityJoinDialog").hidden=true);
    $("activityJoinForm").addEventListener("submit",submitActivityJoin);
  }
  function joinActivity(id){
    ensureJoinDialog();$("joinActivityId").value=id;
    $("joinTeam").innerHTML=teams.map(t=>`<option value="${t.id}">${esc(t.name)} [${esc(t.tag)}]</option>`).join("");
    $("activityJoinDialog").hidden=false;
  }
  async function submitActivityJoin(e){
    e.preventDefault();const c=client();const btn=e.submitter; if(btn)btn.disabled=true;
    try{
      const proof=await upload($("joinProof").files[0],"payment-proofs",false);
      const {error}=await c.from("activity_entries").insert({activity_id:$("joinActivityId").value,team_id:$("joinTeam").value,manager_name:$("joinManager").value.trim(),payment_proof_url:proof,status:"pending"});
      if(error)throw error;
      feedback("joinFeedback","SOLICITUD Y COMPROBANTE ENVIADOS. EL STAFF VALIDARÁ EL PAGO.",true);
      setTimeout(()=>{$("activityJoinDialog").hidden=true;$("activityJoinForm").reset();},1400);
    }catch(err){feedback("joinFeedback",err.message);}
    finally{if(btn)btn.disabled=false;}
  }
  async function saveActivity(e){
    const c=client();if(!c)return;
    const teamName=prompt("Nombre exacto del equipo registrado:");if(!teamName)return;
    const team=teams.find(t=>t.name.toLowerCase()===teamName.trim().toLowerCase());
    if(!team)return alert("No encontramos ese equipo en el directorio público.");
    const a=activities.find(x=>x.id===id);if(!a)return;
    const manager=prompt("Nombre del manager:");if(!manager)return;
    const proof=prompt("¿Tienes comprobante de pago? Escribe la URL de la imagen (opcional).")||null;
    const {error}=await c.from("activity_entries").insert({activity_id:id,team_id:team.id,manager_name:manager,payment_proof_url:proof,status:"pending"});
    if(error)alert("No se pudo enviar la inscripción: "+error.message);else alert("Solicitud enviada. El staff validará el registro y el pago.");
  }
  async function saveActivity(e){
    e.preventDefault();const c=client();if(!c||!profile())return;
    const file=$("activityImage").files[0];let image_url=null;
    try{if(file)image_url=await upload(file,"activity-covers",true);}catch(err){return feedback("activityFeedback",err.message);}
    const row={title:$("activityTitle").value.trim(),kind:$("activityKind").value,starts_at:new Date($("activityDate").value).toISOString(),fee_text:$("activityFee").value.trim(),prize_text:$("activityPrize").value.trim(),payment_instructions:$("activityPayment").value.trim(),link_url:$("activityLink").value.trim()||null,group_link:$("activityGroup").value.trim()||null,room_count:Number($("activityRooms").value)||0,image_url,description:$("activityDescription").value.trim(),published:true,created_by:profile().id};
    const {error}=await c.from("activities").insert(row);if(error)return feedback("activityFeedback",error.message);
    $("activityAdminForm").reset();feedback("activityFeedback","ACTIVIDAD PUBLICADA.",true);await loadAll();
  }
  async function saveScore(e){
    e.preventDefault();const c=client();if(!c||!profile())return;
    const team_id=$("scoreTeam").value;if(!team_id)return feedback("scoreFeedback","Primero registra y aprueba un equipo.");
    const placement_points=Number($("scorePlacement").value)||0,kills=Number($("scoreKills").value)||0,booyah=Number($("scoreBooyah").value)||0;
    const row={team_id,event_title:$("scoreEvent").value.trim(),placement:Number($("scorePosition").value)||1,placement_points,kills,booyah,total_points:placement_points+kills+booyah,created_by:profile().id};
    const {error}=await c.from("team_scores").insert(row);if(error)return feedback("scoreFeedback",error.message);
    $("scoreAdminForm").reset();feedback("scoreFeedback","PUNTUACIÓN GUARDADA Y SUMADA AL RANKING.",true);await loadAll();
  }
  async function loadStaff(){
    const c=client();if(!c||!profile())return;
    const [t,a,entries,players]=await Promise.all([c.from("teams").select("id,name,tag,status,manager_name").order("created_at",{ascending:false}),c.from("activities").select("*").order("created_at",{ascending:false}),c.from("activity_entries").select("*,teams(name,tag),activities(title)").order("created_at",{ascending:false}),c.from("team_players").select("*,teams(name,tag)").order("team_id").order("slot")]);
    if(!t.error)$("adminTeamDirectory").innerHTML=(t.data||[]).map(x=>`<div class="admin-list-item"><div><b>${esc(x.name)} [${esc(x.tag)}]</b><small>${esc(x.manager_name)} · ${esc(x.status)}</small></div><button class="mini-action" data-team-approve="${x.id}">APROBAR</button></div>`).join("")||"Sin equipos";
    if(!a.error)$("adminActivityList").innerHTML=(a.data||[]).map(x=>`<div class="admin-list-item"><div><b>${esc(x.title)}</b><small>${esc(x.kind)} · ${fmt(x.starts_at)}</small></div><button class="mini-action" data-activity-delete="${x.id}">ELIMINAR</button></div>`).join("");
    if(!entries.error)$("adminActivityList").insertAdjacentHTML("beforeend",`<h3>INSCRIPCIONES A ACTIVIDADES</h3>${(entries.data||[]).map(x=>`<div class="admin-list-item"><div><b>${esc(x.teams?.name||"Equipo")}</b><small>${esc(x.activities?.title||"Actividad")} · ${esc(x.status)} · ${esc(x.manager_name)}</small></div><div class="admin-actions"><button class="mini-action" data-payment-proof="${esc(x.payment_proof_url||"")}">VER COMPROBANTE</button><button class="mini-action approve" data-entry-approve="${x.id}">VALIDAR PAGO / APROBAR</button></div></div>`).join("")}`);
    if(!players.error)$("adminTeamDirectory").insertAdjacentHTML("beforeend",`<h3>FICHAS DE JUGADORES (DATOS PRIVADOS)</h3>${(players.data||[]).map(x=>`<div class="admin-list-item"><div><b>${esc(x.teams?.name||"Equipo")} · ${esc(x.nick)}</b><small>ID: ${esc(x.game_id)} · ${esc(x.age)} años · ${esc(x.country)} · Slot ${x.slot}</small></div><div class="admin-actions"><button class="mini-action" data-private-photo="${esc(x.account_photo_path)}">FOTO CUENTA</button><button class="mini-action" data-private-photo="${esc(x.real_photo_path)}">FOTO JUGADOR</button></div></div>`).join("")}`);
    $("scoreTeam").innerHTML=(t.data||[]).filter(x=>x.status==="approved").map(x=>`<option value="${x.id}">${esc(x.name)} [${esc(x.tag)}]</option>`).join("");
    $("adminScoreList").innerHTML='<p class="muted">Las puntuaciones publicadas se acumulan automáticamente en el ranking general.</p>';
  }
  document.addEventListener("submit",e=>{if(e.target.id==="teamProfileForm")registerTeam(e);if(e.target.id==="activityAdminForm")saveActivity(e);if(e.target.id==="scoreAdminForm")saveScore(e);});
  document.addEventListener("click",async e=>{
    const join=e.target.closest("[data-activity-join]");if(join)joinActivity(join.dataset.activityJoin);
    const approve=e.target.closest("[data-team-approve]");if(approve){const c=client();const {error}=await c.from("teams").update({status:"approved"}).eq("id",approve.dataset.teamApprove);if(error)alert(error.message);else loadAll();}
    const del=e.target.closest("[data-activity-delete]");if(del&&confirm("¿Eliminar esta actividad?")){const {error}=await client().from("activities").delete().eq("id",del.dataset.activityDelete);if(error)alert(error.message);else loadAll();}
    const entry=e.target.closest("[data-entry-approve]");if(entry){const {error}=await client().from("activity_entries").update({status:"approved"}).eq("id",entry.dataset.entryApprove);if(error)alert(error.message);else loadStaff();}
    const proof=e.target.closest("[data-payment-proof]");if(proof){const path=proof.dataset.paymentProof;if(!path)return alert("No se adjuntó comprobante.");const {data,error}=await client().storage.from(privateBucket).createSignedUrl(path,300);if(error)alert(error.message);else window.open(data.signedUrl,"_blank","noopener");}
    const photo=e.target.closest("[data-private-photo]");if(photo){const {data,error}=await client().storage.from(privateBucket).createSignedUrl(photo.dataset.privatePhoto,300);if(error)alert(error.message);else window.open(data.signedUrl,"_blank","noopener");}
  });
  document.addEventListener("DOMContentLoaded",()=>{buildPlayerFields();$("teamProfileForm")?.addEventListener("submit",registerTeam);});
  const wait=setInterval(()=>{if(window.NTApp){clearInterval(wait);loadAll();}},100);
})();
