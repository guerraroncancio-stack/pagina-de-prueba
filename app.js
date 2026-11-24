(() => {
  const cfg = window.NATIONAL_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !String(cfg.SUPABASE_URL).includes("PEGA_AQUI") &&
    !String(cfg.SUPABASE_ANON_KEY).includes("PEGA_AQUI");
  const client = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const dateFmt = value => value ? new Date(value).toLocaleString("es-CO",{dateStyle:"medium",timeStyle:"short"}) : "FECHA POR CONFIRMAR";
  let events = [], adminEvents = [], news = [], results = [], approvedTeams = [], currentProfile = null, channel = null;
  let activeFilter = "all";

  function toast(message) {
    const el = $("toast"); el.textContent = message; el.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => el.hidden = true, 4200);
  }
  function feedback(id, message, good=false) {
    const el = $(id); if (!el) return;
    el.textContent = message; el.style.color = good ? "#68d99a" : "#ff7781";
  }
  function kindName(kind) { return ({scrim:"SCRIM",tournament:"TORNEO",league:"LIGA"})[kind] || "COMPETENCIA"; }
  function statusName(status) { return ({open:"INSCRIPCIONES ABIERTAS",closed:"INSCRIPCIONES CERRADAS",live:"EN CURSO",completed:"FINALIZADO",draft:"BORRADOR",pending:"PENDIENTE",approved:"APROBADA",rejected:"RECHAZADA"})[status] || status; }
  function isConfigured() {
    if (client) return true;
    $("competitionStatus").textContent = "PLATAFORMA EN CONFIGURACIÓN";
    $("competitionGrid").innerHTML = '<div class="empty-card">EL CALENDARIO SE ACTIVARÁ CUANDO SE CONECTE LA BASE DE DATOS.</div>';
    $("teamGrid").innerHTML = '<div class="empty-card">LOS EQUIPOS APROBADOS APARECERÁN AQUÍ.</div>';
    $("newsGrid").innerHTML = '<div class="empty-card">PRÓXIMAMENTE, ANUNCIOS OFICIALES.</div>';
    $("resultsBody").innerHTML = '<tr><td colspan="5" class="empty-cell">RESULTADOS PENDIENTES DE PUBLICACIÓN.</td></tr>';
    $("regCompetition").innerHTML = '<option value="">Plataforma pendiente de configuración</option>';
    $("submitRegistration").disabled = true;
    $("submitRegistration").style.opacity = ".45";
    return false;
  }

  function renderEvents() {
    const filtered = events.filter(e => activeFilter === "all" || e.kind === activeFilter);
    $("competitionGrid").innerHTML = filtered.length ? filtered.map(e => `
      <article class="event-card">
        <div class="event-visual"><img src="${esc(window.NATIONAL_LOGO_URL || "https://i.ibb.co/gMTM59MG/Whats-App-Image-2026-11-23-at-8-07-42-PM.jpg")}" alt=""><strong>${esc(kindName(e.kind))}</strong></div>
        <div class="event-body"><span class="status-pill">${esc(statusName(e.status))}</span><h3>${esc(e.title)}</h3><p>${esc(e.description || "Información oficial de la competencia.")}</p>
        <div class="event-meta"><span>${esc(e.game || "FREE FIRE")}</span><span>${esc(dateFmt(e.starts_at))}</span></div>
        <div class="event-meta"><span>${esc(e.format || "FORMATO POR ANUNCIAR")}</span><span>${Number(e.slots)||0} CUPOS</span></div>
        <div class="event-actions"><span class="tiny muted">${esc(e.maps || "MAPAS POR DEFINIR")}</span>${e.status==="open" ? `<button type="button" data-register="${e.id}">INSCRIBIR EQUIPO ↗</button>` : `<span class="tiny muted">${esc(statusName(e.status))}</span>`}</div></div>
      </article>`).join("") : '<div class="empty-card">NO HAY COMPETENCIAS PUBLICADAS EN ESTA CATEGORÍA.</div>';
    $("competitionCount").textContent = String(events.length).padStart(2,"0");
    $("competitionStatus").textContent = `${events.length} EVENTO(S) PUBLICADO(S)`;
    const open = events.filter(e => e.status === "open");
    $("regCompetition").innerHTML = '<option value="">Selecciona una competencia abierta</option>' + open.map(e => `<option value="${e.id}">${esc(e.title)} · ${esc(kindName(e.kind))} · ${dateFmt(e.starts_at)}</option>`).join("");
  }
  function renderTeams() {
    $("teamGrid").innerHTML = approvedTeams.length ? approvedTeams.map(t => `<article class="team-card"><div class="team-logo">${esc((t.tag || t.team_name || "NT").slice(0,4))}</div><div><h3>${esc(t.team_name)}</h3><p>${esc(t.tag || "")} · ${esc(t.competition_title || "NATIONAL TOURNAMENTS")}</p></div></article>`).join("") : '<div class="empty-card">LOS EQUIPOS APROBADOS SE MOSTRARÁN AQUÍ.</div>';
  }
  function renderNews() {
    $("newsGrid").innerHTML = news.length ? news.map(n => `<article class="news-card"><div class="news-photo" ${n.image_url ? `style="background-image:linear-gradient(0deg,#08090c66,#08090c11),url('${esc(n.image_url)}')"` : ""}></div><div><small>NATIONAL / COMUNICADO</small><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></div></article>`).join("") : '<div class="empty-card">NO HAY NOTICIAS PUBLICADAS.</div>';
  }
  function renderResults() {
    $("resultsBody").innerHTML = results.length ? results.map((r,i) => `<tr><td>${String(r.position || i+1).padStart(2,"0")}</td><td>${esc(r.team_name)}</td><td>${esc(r.event_title)}</td><td>${Number(r.kills)||0}</td><td><b>${Number(r.points)||0}</b></td></tr>`).join("") : '<tr><td colspan="5" class="empty-cell">AÚN NO HAY RESULTADOS PUBLICADOS.</td></tr>';
  }
  function renderAll() { renderEvents(); renderTeams(); renderNews(); renderResults(); }

  async function loadPublic() {
    if (!client) return;
    const [ev, ns, rs, ts] = await Promise.all([
      client.from("competitions").select("id,title,kind,game,starts_at,slots,format,maps,description,status").neq("status","draft").order("starts_at",{ascending:true}),
      client.from("news").select("id,title,body,image_url,created_at").eq("published",true).order("created_at",{ascending:false}).limit(6),
      client.from("results").select("id,team_name,event_title,kills,points,position,created_at").eq("published",true).order("points",{ascending:false}).limit(30),
      client.rpc("get_public_teams")
    ]);
    for (const r of [ev,ns,rs,ts]) if (r.error) console.warn(r.error.message);
    events = ev.data || []; news = ns.data || []; results = rs.data || []; approvedTeams = ts.data || [];
    renderAll();
    if (currentProfile) await loadAdminData();
  }

  function openLogin() { $("adminGate").hidden = false; $("loginEmail").focus(); }
  function closeLogin() { $("adminGate").hidden = true; $("loginForm").reset(); feedback("loginFeedback",""); }
  function showWorkspace(profile, user) {
    currentProfile = profile;
    $("adminGate").hidden = true; $("adminWorkspace").hidden = false;
    $("adminUserEmail").textContent = user.email || "STAFF";
    $("adminUserRole").textContent = profile.role === "admin" ? "ADMINISTRADOR" : "STAFF AUTORIZADO";
    document.querySelectorAll(".admin-only").forEach(el => el.hidden = profile.role !== "admin");
    switchAdminPage("overview");
    loadAdminData();
    subscribeRealtime();
  }
  function hideWorkspace() {
    currentProfile = null; $("adminWorkspace").hidden = true;
    if (channel && client) client.removeChannel(channel);
    channel = null;
  }
  async function checkSession() {
    if (!client) return;
    const {data:{session}} = await client.auth.getSession();
    if (!session) return;
    const {data:profile,error} = await client.from("profiles").select("id,display_name,role").eq("id",session.user.id).single();
    if (!error && profile && ["admin","staff"].includes(profile.role)) showWorkspace(profile,session.user);
    else await client.auth.signOut();
  }
  function switchAdminPage(page) {
    document.querySelectorAll(".admin-page").forEach(p => p.classList.toggle("active",p.id === `page-${page}`));
    document.querySelectorAll(".admin-nav").forEach(b => b.classList.toggle("active",b.dataset.page === page));
    const titles = {overview:"RESUMEN GENERAL",competitions:"GESTIÓN DE COMPETICIONES",registrations:"SOLICITUDES DE EQUIPOS",results:"RESULTADOS OFICIALES",news:"COMUNICADOS",staff:"CONTROL DE ACCESO"};
    $("adminPageTitle").textContent = titles[page] || "NATIONAL CONTROL";
  }
  async function loadAdminData() {
    if (!client || !currentProfile) return;
    const [ev,reg,ns,rs] = await Promise.all([
      client.from("competitions").select("*").order("created_at",{ascending:false}),
      client.from("registrations").select("*,competitions(title,kind,starts_at)").order("created_at",{ascending:false}),
      client.from("news").select("*").order("created_at",{ascending:false}),
      client.from("results").select("*").order("created_at",{ascending:false})
    ]);
    if (ev.error || reg.error || ns.error || rs.error) {
      toast("No se pudieron cargar algunos datos. Revisa las políticas de acceso.");
      console.error(ev.error,reg.error,ns.error,rs.error); return;
    }
    const regs = reg.data || [], allEvents = ev.data || [];
    adminEvents = allEvents;
    $("metricEvents").textContent = allEvents.length;
    $("metricPending").textContent = regs.filter(r=>r.status==="pending").length;
    $("metricApproved").textContent = regs.filter(r=>r.status==="approved").length;
    $("metricNews").textContent = (ns.data || []).filter(n=>n.published).length;
    $("recentRegistrations").innerHTML = regs.slice(0,5).map(r => `<div class="admin-list-item"><div><b>${esc(r.team_name)} · ${esc(r.tag)}</b><small>${esc(r.competitions?.title || "Competencia")} · ${esc(statusName(r.status))}</small></div><button class="mini-action" data-goto="registrations">REVISAR</button></div>`).join("") || '<div class="empty-card">SIN SOLICITUDES TODAVÍA.</div>';
    $("adminCompetitionList").innerHTML = allEvents.map(e => `<div class="admin-list-item"><div><b>${esc(e.title)}</b><small>${esc(kindName(e.kind))} · ${esc(statusName(e.status))} · ${Number(e.slots)} cupos</small></div><div class="admin-actions"><button class="mini-action" data-edit-event="${e.id}">EDITAR</button><button class="mini-action delete" data-delete-event="${e.id}">ELIMINAR</button></div></div>`).join("") || '<div class="empty-card">NO HAY COMPETENCIAS.</div>';
    renderAdminRegistrations(regs);
    $("adminResultList").innerHTML = (rs.data || []).map(r => `<div class="admin-list-item"><div><b>${esc(r.team_name)} · ${Number(r.points)} pts</b><small>${esc(r.event_title)} · ${Number(r.kills)} kills</small></div><button class="mini-action delete" data-delete-result="${r.id}">ELIMINAR</button></div>`).join("");
    $("adminNewsList").innerHTML = (ns.data || []).map(n => `<div class="admin-list-item"><div><b>${esc(n.title)}</b><small>${n.published?"PUBLICADA":"BORRADOR"}</small></div><button class="mini-action delete" data-delete-news="${n.id}">ELIMINAR</button></div>`).join("");
    if (currentProfile.role === "admin") {
      const {data:profiles,error:pErr} = await client.from("profiles").select("id,display_name,role,created_at").order("created_at",{ascending:true});
      if (pErr) console.warn(pErr.message);
      $("staffList").innerHTML = (profiles || []).map(p => `<div class="admin-list-item"><div><b>${esc(p.display_name || "Usuario")}</b><small>${esc(p.id)} · ${esc(p.role)}</small></div><select class="role-select" data-role-user="${p.id}"><option value="staff" ${p.role==="staff"?"selected":""}>STAFF</option><option value="admin" ${p.role==="admin"?"selected":""}>ADMINISTRADOR</option><option value="creator" ${p.role==="creator"?"selected":""}>CREADOR</option><option value="vip" ${p.role==="vip"?"selected":""}>VIP</option><option value="team" ${p.role==="team"?"selected":""}>EQUIPO</option></select></div>`).join("") || '<div class="empty-card">NO HAY CUENTAS.</div>';
    }
  }
  function renderAdminRegistrations(regs) {
    const filter = $("registrationFilter").value;
    const list = regs.filter(r => filter==="all" || r.status===filter);
    $("adminRegistrationList").innerHTML = list.map(r => {
      const players = Array.isArray(r.players) ? r.players.join(" · ") : "";
      return `<article class="admin-list-item"><div class="registration-admin-copy"><b>${esc(r.team_name)} <span style="color:#ff6875">[${esc(r.tag)}]</span></b><small>${esc(r.competitions?.title || "Competencia")} · ${esc(r.manager_name)} · ${esc(r.manager_phone)}</small><small>Discord: ${esc(r.manager_discord || "No indicado")}</small><small>Roster: ${esc(players)}</small><small>Estado: ${esc(statusName(r.status))} · ${dateFmt(r.created_at)}</small></div><div class="admin-actions">${r.status!=="approved"?`<button class="mini-action approve" data-approve-reg="${r.id}">APROBAR</button>`:""}${r.status!=="rejected"?`<button class="mini-action reject" data-reject-reg="${r.id}">RECHAZAR</button>`:""}<button class="mini-action" data-copy-phone="${esc(r.manager_phone)}">COPIAR TEL.</button></div></article>`;
    }).join("") || '<div class="empty-card">NO HAY SOLICITUDES EN ESTE FILTRO.</div>';
  }
  function subscribeRealtime() {
    if (!client || channel) return;
    channel = client.channel("national-live-updates")
      .on("postgres_changes",{event:"*",schema:"public",table:"competitions"},loadPublic)
      .on("postgres_changes",{event:"*",schema:"public",table:"registrations"},loadPublic)
      .on("postgres_changes",{event:"*",schema:"public",table:"news"},loadPublic)
      .on("postgres_changes",{event:"*",schema:"public",table:"results"},loadPublic)
      .subscribe();
  }

  async function handleRegistration(e) {
    e.preventDefault();
    if (!client) return toast("La plataforma todavía no está conectada.");
    const players = $("regPlayers").value.split("\n").map(x=>x.replace(/^\s*\d+[.)-]?\s*/,"").trim()).filter(Boolean);
    if (players.length < 4 || players.length > 5) return feedback("registrationFeedback","El roster debe tener 4 titulares y máximo 1 suplente.");
    const accessCode = (crypto.randomUUID ? crypto.randomUUID().replaceAll("-","") : `${Date.now()}${Math.random().toString(36).slice(2)}`).toUpperCase();
    $("submitRegistration").disabled = true;
    const payload = {competition_id:$("regCompetition").value,team_name:$("regTeam").value.trim(),tag:$("regTag").value.trim(),manager_name:$("regManager").value.trim(),manager_phone:$("regPhone").value.trim(),manager_discord:$("regDiscord").value.trim() || null,players,access_code:accessCode,status:"pending"};
    const {error} = await client.from("registrations").insert(payload);
    $("submitRegistration").disabled = false;
    if (error) {
      feedback("registrationFeedback",error.message.includes("SLOTS_FULL") ? "Los cupos de esta competencia ya se completaron." : "No se pudo enviar la solicitud. Verifica que la competencia siga abierta.");
      console.error(error); return;
    }
    $("registrationForm").reset();
    feedback("registrationFeedback",`SOLICITUD RECIBIDA. GUARDA ESTE CÓDIGO: ${accessCode}`,true);
    toast("Inscripción enviada correctamente. Guarda tu código.");
  }

  async function trackRegistration(e) {
    e.preventDefault();
    if (!client) return toast("La plataforma todavía no está conectada.");
    $("trackingResult").textContent = "Consultando solicitud…";
    const {data,error} = await client.rpc("check_registration",{p_code:$("trackingCode").value.trim().toUpperCase()});
    if (error || !data || data.error) { $("trackingResult").textContent = "No encontramos una solicitud con ese código."; return; }
    let msg = `Estado: ${statusName(data.status)} · Competencia: ${data.competition_title}`;
    if (data.status === "approved" && data.room_id) msg += ` · ID de sala: ${data.room_id} · Contraseña: ${data.room_password || "Por anunciar"}`;
    $("trackingResult").textContent = msg;
  }

  async function saveCompetition(e) {
    e.preventDefault(); if (!client || !currentProfile) return;
    const id = $("eventId").value || undefined;
    const row = {title:$("eventTitle").value.trim(),kind:$("eventKind").value,starts_at:new Date($("eventDate").value).toISOString(),slots:Number($("eventSlots").value),format:$("eventFormat").value.trim(),maps:$("eventMaps").value.trim(),status:$("eventStatus").value,game:$("eventGame").value.trim() || "Free Fire",description:$("eventDescription").value.trim(),created_by:currentProfile.id};
    let query = client.from("competitions");
    const res = id ? await query.update(row).eq("id",id).select("id").single() : await query.insert(row).select("id").single();
    if (res.error) return feedback("eventFeedback",res.error.message);
    const eventId = id || res.data.id;
    const roomId = $("eventRoomId").value.trim(), roomPassword = $("eventRoomPassword").value.trim();
    if (roomId || roomPassword) {
      const room = await client.from("competition_rooms").upsert({competition_id:eventId,room_id:roomId,room_password:roomPassword,updated_at:new Date().toISOString()});
      if (room.error) return feedback("eventFeedback","Competencia guardada, pero no se guardaron los datos privados de sala: "+room.error.message);
    } else {
      await client.from("competition_rooms").delete().eq("competition_id",eventId);
    }
    $("competitionForm").reset(); $("eventId").value=""; $("eventSlots").value=12; $("eventGame").value="Free Fire";
    feedback("eventFeedback","COMPETENCIA GUARDADA CORRECTAMENTE.",true); await loadPublic();
  }
  function editCompetition(id) {
    const e = adminEvents.find(x=>x.id===id);
    if (!e) return;
    $("eventId").value=e.id; $("eventTitle").value=e.title; $("eventKind").value=e.kind;
    const d = new Date(e.starts_at); $("eventDate").value = new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
    $("eventSlots").value=e.slots; $("eventFormat").value=e.format||""; $("eventMaps").value=e.maps||"";
    $("eventStatus").value=e.status; $("eventGame").value=e.game||"Free Fire"; $("eventDescription").value=e.description||"";
    client.from("competition_rooms").select("*").eq("competition_id",id).maybeSingle().then(({data})=>{ $("eventRoomId").value=data?.room_id||""; $("eventRoomPassword").value=data?.room_password||""; });
    $("competitionForm").scrollIntoView({behavior:"smooth"});
  }
  async function deleteCompetition(id) {
    if (!confirm("¿Eliminar esta competencia y sus inscripciones?")) return;
    const {error} = await client.from("competitions").delete().eq("id",id);
    if (error) toast(error.message); else { toast("Competencia eliminada."); await loadPublic(); }
  }
  async function changeRegistration(id,status) {
    const {error} = await client.from("registrations").update({status}).eq("id",id);
    if (error) toast(error.message); else { toast(status==="approved"?"Equipo aprobado. El manager ya puede consultar la sala si fue configurada.":"Solicitud actualizada."); await loadAdminData(); await loadPublic(); }
  }
  async function addResult(e) {
    e.preventDefault();
    const row={team_name:$("resultTeam").value.trim(),event_title:$("resultEvent").value.trim(),kills:Number($("resultKills").value)||0,points:Number($("resultPoints").value)||0,position:Number($("resultPosition").value)||1,published:true,created_by:currentProfile.id};
    const {error}=await client.from("results").insert(row);
    if(error)return feedback("resultFeedback",error.message);
    $("resultForm").reset();feedback("resultFeedback","RESULTADO PUBLICADO.",true);await loadPublic();await loadAdminData();
  }
  async function addNews(e) {
    e.preventDefault();
    const row={title:$("newsTitle").value.trim(),body:$("newsBody").value.trim(),image_url:$("newsImage").value.trim()||null,published:true,created_by:currentProfile.id};
    const {error}=await client.from("news").insert(row);
    if(error)return feedback("newsFeedback",error.message);
    $("newsForm").reset();feedback("newsFeedback","NOTICIA PUBLICADA.",true);await loadPublic();await loadAdminData();
  }
  async function updateRole(id,role) {
    if (currentProfile?.role !== "admin") return;
    if (!confirm(`¿Cambiar el rol de esta cuenta a ${role.toUpperCase()}?`)) return;
    const {error}=await client.from("profiles").update({role}).eq("id",id);
    if(error)toast(error.message);else{toast("Permisos actualizados.");await loadAdminData();}
  }

  document.addEventListener("click", async e => {
    const reg = e.target.closest("[data-register]");
    if (reg) { $("regCompetition").value=reg.dataset.register; $("registration").scrollIntoView({behavior:"smooth"}); }
    const nav = e.target.closest("[data-page]");
    if (nav) switchAdminPage(nav.dataset.page);
    const goto = e.target.closest("[data-goto]");
    if (goto) switchAdminPage(goto.dataset.goto);
    const edit = e.target.closest("[data-edit-event]");
    if (edit) editCompetition(edit.dataset.editEvent);
    const del = e.target.closest("[data-delete-event]");
    if (del) deleteCompetition(del.dataset.deleteEvent);
    const approve = e.target.closest("[data-approve-reg]");
    if (approve) changeRegistration(approve.dataset.approveReg,"approved");
    const reject = e.target.closest("[data-reject-reg]");
    if (reject) changeRegistration(reject.dataset.rejectReg,"rejected");
    const copy = e.target.closest("[data-copy-phone]");
    if (copy) { try { await navigator.clipboard.writeText(copy.dataset.copyPhone); toast("Número copiado."); } catch { toast(copy.dataset.copyPhone); } }
    const dr = e.target.closest("[data-delete-result]");
    if (dr && confirm("¿Eliminar este resultado?")) { const {error}=await client.from("results").delete().eq("id",dr.dataset.deleteResult); if(error)toast(error.message);else loadAdminData(); }
    const dn = e.target.closest("[data-delete-news]");
    if (dn && confirm("¿Eliminar esta noticia?")) { const {error}=await client.from("news").delete().eq("id",dn.dataset.deleteNews); if(error)toast(error.message);else{await loadAdminData();await loadPublic();} }
  });
  document.addEventListener("change",e=>{
    if (e.target.matches("[data-role-user]")) updateRole(e.target.dataset.roleUser,e.target.value);
  });

  $("mobileToggle").addEventListener("click",()=> $("mainNav").classList.toggle("open"));
  $("mainNav").querySelectorAll("a").forEach(a=>a.addEventListener("click",()=> $("mainNav").classList.remove("open")));
  $("competitionFilters").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;activeFilter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));renderEvents();});
  $("registrationForm").addEventListener("submit",handleRegistration);
  $("trackingForm").addEventListener("submit",trackRegistration);
  $("staffAccess").addEventListener("click",()=>{if(!client){toast("Primero configura Supabase siguiendo el README.");return;}openLogin();});
  $("closeGate").addEventListener("click",closeLogin);
  $("loginForm").addEventListener("submit",async e=>{
    e.preventDefault();if(!client)return;
    const {data,error}=await client.auth.signInWithPassword({email:$("loginEmail").value.trim(),password:$("loginPassword").value});
    if(error)return feedback("loginFeedback","No se pudo iniciar sesión. Revisa tus credenciales.");
    const {data:profile,error:pErr}=await client.from("profiles").select("id,display_name,role").eq("id",data.user.id).single();
    if(pErr||!profile||!["admin","staff"].includes(profile.role)){await client.auth.signOut();return feedback("loginFeedback","Esta cuenta no tiene permisos autorizados.");}
    showWorkspace(profile,data.user);
  });
  $("logoutButton").addEventListener("click",async()=>{if(client)await client.auth.signOut();hideWorkspace();toast("Sesión cerrada.");});
  $("competitionForm").addEventListener("submit",saveCompetition);
  $("resetEventForm").addEventListener("click",()=>{$("competitionForm").reset();$("eventId").value="";$("eventSlots").value=12;$("eventGame").value="Free Fire";});
  $("registrationFilter").addEventListener("change",()=>{if(client&&currentProfile)loadAdminData();});
  $("resultForm").addEventListener("submit",addResult);
  $("newsForm").addEventListener("submit",addNews);

  window.NTApp = { get client(){ return client; }, get profile(){ return currentProfile; }, refresh: loadPublic, refreshAdmin: loadAdminData };

  if (isConfigured()) {
    loadPublic().catch(err=>{console.error(err);toast("No se pudo cargar la plataforma. Revisa la configuración.");});
    checkSession();
    client.auth.onAuthStateChange((_event,session)=>{if(!session)hideWorkspace();});
    client.channel("national-public-live")
      .on("postgres_changes",{event:"*",schema:"public",table:"competitions"},loadPublic)
      .on("postgres_changes",{event:"*",schema:"public",table:"news"},loadPublic)
      .on("postgres_changes",{event:"*",schema:"public",table:"results"},loadPublic)
      .subscribe();
  } else isConfigured();
})();
