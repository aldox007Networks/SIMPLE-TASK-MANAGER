import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./supabase";
import {
  Bell, LayoutDashboard, ClipboardList, Building2, Users, LogOut,
  Plus, X, Camera, Check, AlertCircle, ChevronRight, Trash2,
  TrendingUp, Clock, CheckCircle2, FileText, Image as ImageIcon,
  ThumbsUp, Send, User, Download, Shield,
} from "lucide-react";

// ============ UTILIDADES ============
const fmtDate = (ts) =>
  new Date(ts).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function compressImage(file, maxW = 1400, quality = 0.7) {
  return new Promise((resolve) => {
    // Si no es una imagen que el canvas pueda procesar, devolvemos el archivo tal cual
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = (e) => {
      const img = new window.Image();
      img.onerror = () => resolve(null); // p.ej. HEIC que el navegador no decodifica
      img.onload = () => {
        try {
          const scale = Math.min(1, maxW / img.width);
          const c = document.createElement("canvas");
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          c.toBlob((blob) => resolve(blob), "image/jpeg", quality);
        } catch { resolve(null); }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Sube una foto al bucket "fotos" y devuelve { url } o { error }
async function uploadPhoto(file) {
  // 1) Intentamos comprimir; si falla (HEIC, etc.), usamos el archivo original
  let blob = await compressImage(file);
  let ext = "jpg";
  let contentType = "image/jpeg";
  if (!blob) {
    blob = file;
    contentType = file.type || "application/octet-stream";
    ext = (file.name?.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  }
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("fotos").upload(name, blob, { contentType, upsert: false });
  if (error) { console.error("Error al subir foto:", error); return { error: error.message || "No se pudo subir la foto" }; }
  const { data } = supabase.storage.from("fotos").getPublicUrl(name);
  return { url: data.publicUrl };
}

// ============ APP ============
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    (async () => {
      const { data } = await supabase.from("perfiles").select("*").eq("id", session.user.id).single();
      if (data) { setProfile(data); return; }
      // Red de seguridad: si el usuario no tiene perfil, lo creamos ahora
      const meta = session.user.user_metadata || {};
      const { count } = await supabase.from("perfiles").select("*", { count: "exact", head: true });
      const rol = meta.rol || ((count || 0) === 0 ? "admin" : "member");
      const nombre = meta.nombre || session.user.email;
      const { data: nuevo } = await supabase.from("perfiles")
        .upsert({ id: session.user.id, nombre, rol }, { onConflict: "id" })
        .select().single();
      setProfile(nuevo);
    })();
  }, [session]);

  if (loading) return <Splash />;

  if (!session)
    return <Shell bare><Login /></Shell>;

  if (!profile) return <Splash />;

  return (
    <Shell>
      {profile.rol === "admin"
        ? <AdminApp profile={profile} />
        : <MemberApp profile={profile} />}
    </Shell>
  );
}

// ============ HOOK DE DATOS (lee de Supabase + tiempo real) ============
function useData(profile) {
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [activities, setActivities] = useState([]);
  const [notifs, setNotifs] = useState([]);

  const reload = async () => {
    const [u, c, a, n] = await Promise.all([
      supabase.from("perfiles").select("*"),
      supabase.from("empresas").select("*").order("creado", { ascending: false }),
      supabase.from("actividades").select("*, avances(*)").order("creado", { ascending: false }),
      supabase.from("notificaciones").select("*").eq("destinatario", profile.id).order("creado", { ascending: false }),
    ]);
    setUsers(u.data || []);
    setCompanies(c.data || []);
    setActivities((a.data || []).map(normalizeActivity));
    setNotifs(n.data || []);
  };

  useEffect(() => {
    reload();
    const ch = supabase.channel("cambios")
      .on("postgres_changes", { event: "*", schema: "public" }, () => reload())
      .subscribe();
    return () => supabase.removeChannel(ch);
    // eslint-disable-next-line
  }, []);

  return { users, companies, activities, notifs, reload, setNotifs };
}

function normalizeActivity(a) {
  return {
    id: a.id, title: a.titulo, description: a.descripcion,
    companyId: a.empresa_id, assignedTo: a.asignado_a, progress: a.progreso || 0,
    photos: a.fotos || [], approvalRequested: a.aprobacion_solicitada, approved: a.aprobada,
    createdAt: a.creado, createdBy: a.creado_por,
    updates: (a.avances || []).map((u) => ({
      id: u.id, by: u.autor_id, text: u.texto, photos: u.fotos || [], pct: u.progreso, ts: u.creado,
    })).sort((x, y) => new Date(x.ts) - new Date(y.ts)),
  };
}

// ============ ACCIONES (escriben en Supabase) ============
const Api = {
  async pushNotif(toUserId, text, activityId, kind = "info") {
    await supabase.from("notificaciones").insert({ destinatario: toUserId, texto: text, actividad_id: activityId, tipo: kind });
  },
  async createActivity(data, createdBy) {
    const { data: row } = await supabase.from("actividades").insert({
      titulo: data.title, descripcion: data.description, empresa_id: data.companyId,
      asignado_a: data.assignedTo, fotos: data.photos, creado_por: createdBy,
    }).select().single();
    return row;
  },
  async addUpdate(activityId, authorId, text, photos, pct) {
    await supabase.from("avances").insert({ actividad_id: activityId, autor_id: authorId, texto: text, fotos: photos, progreso: pct });
    await supabase.from("actividades").update({ progreso: pct }).eq("id", activityId);
  },
  async setApprovalRequested(activityId, val) {
    await supabase.from("actividades").update({ aprobacion_solicitada: val }).eq("id", activityId);
  },
  async approve(activityId) {
    await supabase.from("actividades").update({ aprobacion_solicitada: false, aprobada: true }).eq("id", activityId);
  },
  async addCompany(c) { await supabase.from("empresas").insert(c); },
  async delCompany(id) { await supabase.from("empresas").delete().eq("id", id); },
  async markNotifsRead(userId) { await supabase.from("notificaciones").update({ leida: true }).eq("destinatario", userId).eq("leida", false); },
  async markNotifRead(id) { await supabase.from("notificaciones").update({ leida: true }).eq("id", id); },
};

// ============ SHELL ============
function Shell({ children, bare }) {
  return (
    <div style={S.root}>
      <style>{CSS}</style>
      <div style={bare ? S.bareWrap : S.appWrap}>{children}</div>
    </div>
  );
}
function Splash() {
  return (
    <div style={{ ...S.root, display: "grid", placeItems: "center" }}>
      <style>{CSS}</style>
      <div style={{ textAlign: "center" }}>
        <img src="/icono-512.png" alt="Centro de Operaciones" style={S.logoMark} />
        <p style={{ color: "var(--muted)", marginTop: 16, letterSpacing: 2, fontSize: 12 }}>CARGANDO…</p>
      </div>
    </div>
  );
}

// ============ LOGIN ============
function Login() {
  const [mode, setMode] = useState("login"); // login | setup
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminExists, setAdminExists] = useState(true);

  // ¿Ya existe algún perfil? Si no, permitimos crear el primer administrador.
  useEffect(() => {
    supabase.from("perfiles").select("*", { count: "exact", head: true })
      .then(({ count }) => setAdminExists((count || 0) > 0));
  }, []);

  const submit = async () => {
    setErr(""); setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
      if (error) setErr("Correo o contraseña incorrectos.");
    } else {
      // Configuración inicial: crea el primer administrador (solo si no existe ninguno)
      const nombre = name.trim() || email.trim();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password: pass,
        options: { data: { nombre, rol: "admin" } },
      });
      if (error) { setErr(error.message); setBusy(false); return; }
      if (data?.user) {
        await supabase.from("perfiles").upsert({ id: data.user.id, nombre, rol: "admin" }, { onConflict: "id" });
      }
      setErr("Administrador creado. Ya puedes iniciar sesión.");
      setMode("login");
    }
    setBusy(false);
  };

  return (
    <div style={S.loginCard}>
      <img src="/icono-512.png" alt="Centro de Operaciones" style={S.logoMark} />
      <h1 style={S.loginTitle}>Centro de Operaciones</h1>
      <p style={S.loginSub}>Control y seguimiento de actividades</p>

      {mode === "setup" && (
        <>
          <label style={S.label}>Nombre completo</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tu nombre" />
        </>
      )}
      <label style={S.label}>Correo</label>
      <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@ejemplo.com" onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label style={S.label}>Contraseña</label>
      <input style={S.input} type="password" value={pass} onChange={(e) => setPass(e.target.value)}
        placeholder="••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />

      {err && <div style={S.errBox}><AlertCircle size={14} /> {err}</div>}

      <button style={{ ...S.btnPrimary, marginTop: 16, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
        {busy ? "Procesando…" : mode === "login" ? "Entrar" : "Crear administrador"}
      </button>

      {!adminExists && (
        <p style={S.hint}>
          {mode === "login"
            ? <>¿Primera vez? <button style={S.linkBtn} onClick={() => { setMode("setup"); setErr(""); }}>Configura la cuenta de administrador</button></>
            : <>¿Ya la creaste? <button style={S.linkBtn} onClick={() => { setMode("login"); setErr(""); }}>Inicia sesión</button></>}
        </p>
      )}
    </div>
  );
}

// ============ TOPBAR ============
function TopBar({ profile, notifs, onLogout, activities, onOpenActivity, reload }) {
  const [open, setOpen] = useState(false);
  const unread = notifs.filter((n) => !n.leida).length;
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  return (
    <div style={S.topbar}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/icono-512.png" alt="Centro de Operaciones" style={S.logoMarkSm} />
        <div>
          <div style={S.topName}>{profile.nombre}</div>
          <div style={S.topRole}>
            {profile.rol === "admin" ? <><Shield size={11} /> Administrador</> : <><User size={11} /> Integrante</>}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div ref={ref} style={{ position: "relative" }}>
          <button style={S.iconBtn} onClick={() => setOpen((o) => !o)}>
            <Bell size={18} />
            {unread > 0 && <span style={S.badge}>{unread > 9 ? "9+" : unread}</span>}
          </button>
          {open && (
            <div style={S.notifPanel}>
              <div style={S.notifHead}>
                <span>Notificaciones</span>
                {unread > 0 && <button style={S.linkBtn} onClick={async () => { await Api.markNotifsRead(profile.id); reload(); }}>Marcar leídas</button>}
              </div>
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {notifs.length === 0 && <div style={S.notifEmpty}>Sin notificaciones todavía.</div>}
                {notifs.map((n) => (
                  <div key={n.id} style={{ ...S.notifItem, opacity: n.leida ? 0.55 : 1 }}
                    onClick={async () => {
                      await Api.markNotifRead(n.id);
                      const act = activities.find((a) => a.id === n.actividad_id);
                      if (act) { onOpenActivity(act.id); setOpen(false); }
                      reload();
                    }}>
                    <div style={{ ...S.notifDot, background: kindColor(n.tipo) }} />
                    <div style={{ flex: 1 }}>
                      <div style={S.notifText}>{n.texto}</div>
                      <div style={S.notifTime}>{fmtDate(n.creado)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <button style={S.iconBtn} onClick={onLogout} title="Salir"><LogOut size={18} /></button>
      </div>
    </div>
  );
}
const kindColor = (k) =>
  ({ assign: "var(--accent)", done: "var(--green)", approval: "var(--amber)", progress: "var(--blue)", info: "var(--muted)" }[k] || "var(--muted)");

// ============ ADMIN ============
function AdminApp({ profile }) {
  const data = useData(profile);
  const [tab, setTab] = useState("dash");
  const [openActId, setOpenActId] = useState(null);
  const openActivity = (id) => { setOpenActId(id); setTab("activities"); };
  const logout = () => supabase.auth.signOut();

  const tabs = [
    { id: "dash", label: "Panel", icon: LayoutDashboard },
    { id: "activities", label: "Actividades", icon: ClipboardList },
    { id: "companies", label: "Empresas", icon: Building2 },
    { id: "team", label: "Equipo", icon: Users },
  ];
  const shared = { ...data, profile, onLogout: logout };

  return (
    <>
      <TopBar {...shared} onOpenActivity={openActivity} />
      <div style={S.body} className="appbody">
        <nav style={S.sidenav} className="sidenav">
          {tabs.map((t) => (
            <button key={t.id} style={tab === t.id ? S.navItemActive : S.navItem} className="navitem"
              onClick={() => { setTab(t.id); setOpenActId(null); }}>
              <t.icon size={18} /> <span className="navlabel">{t.label}</span>
            </button>
          ))}
        </nav>
        <main style={S.main} className="main">
          {tab !== "dash" && !openActId && (
            <button style={S.backBtn} onClick={() => setTab("dash")}>
              <ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Volver al panel
            </button>
          )}
          {tab === "dash" && <Dashboard {...shared} onOpenActivity={openActivity} />}
          {tab === "activities" && <AdminActivities {...shared} openActId={openActId} setOpenActId={setOpenActId} />}
          {tab === "companies" && <Companies {...shared} />}
          {tab === "team" && <Team {...shared} />}
          <Footer />
        </main>
      </div>
    </>
  );
}

// ============ DASHBOARD ============
function Dashboard({ activities, users, companies, onOpenActivity }) {
  const total = activities.length;
  const done = activities.filter((a) => a.progress >= 100).length;
  const inProgress = activities.filter((a) => a.progress > 0 && a.progress < 100).length;
  const pending = activities.filter((a) => a.progress === 0).length;
  const needApproval = activities.filter((a) => a.approvalRequested).length;
  const avg = total ? Math.round(activities.reduce((s, a) => s + a.progress, 0) / total) : 0;

  const [repCompany, setRepCompany] = useState("all");
  const [repMember, setRepMember] = useState("all");
  const [repStatus, setRepStatus] = useState("all");

  const filtered = useMemo(() => activities.filter((a) => {
    if (repCompany !== "all" && a.companyId !== repCompany) return false;
    if (repMember !== "all" && a.assignedTo !== repMember) return false;
    if (repStatus === "done" && a.progress < 100) return false;
    if (repStatus === "progress" && !(a.progress > 0 && a.progress < 100)) return false;
    if (repStatus === "pending" && a.progress !== 0) return false;
    return true;
  }), [activities, repCompany, repMember, repStatus]);

  const exportReport = () => {
    const rows = filtered.map((a) => ({
      Actividad: a.title,
      Empresa: companies.find((c) => c.id === a.companyId)?.nombre || "—",
      Responsable: users.find((u) => u.id === a.assignedTo)?.nombre || "Sin asignar",
      Avance: a.progress + "%",
      Estado: a.progress >= 100 ? "Completada" : a.progress > 0 ? "En progreso" : "Pendiente",
      Actualizaciones: (a.updates || []).length,
      Creada: new Date(a.createdAt).toLocaleString("es-MX"),
    }));
    const headers = ["Actividad", "Empresa", "Responsable", "Avance", "Estado", "Actualizaciones", "Creada"];
    const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `reporte-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHead title="Panel de control" sub="Resumen general de actividades y avances" />
      <div style={S.kpiGrid} className="kpigrid">
        <KpiCard icon={ClipboardList} label="Actividades totales" value={total} tone="accent" />
        <KpiCard icon={TrendingUp} label="Avance promedio" value={avg + "%"} tone="blue" />
        <KpiCard icon={Clock} label="En progreso" value={inProgress} tone="amber" />
        <KpiCard icon={CheckCircle2} label="Completadas" value={done} tone="green" />
      </div>
      {needApproval > 0 && (
        <div style={S.alertStrip}><ThumbsUp size={16} /><span><b>{needApproval}</b> actividad(es) esperan tu visto bueno.</span></div>
      )}
      <div style={S.twoCol} className="twocol">
        <div style={S.panel}>
          <h3 style={S.panelTitle}>Distribución de estados</h3>
          <BarRow label="Pendientes" value={pending} total={total} color="var(--muted)" />
          <BarRow label="En progreso" value={inProgress} total={total} color="var(--amber)" />
          <BarRow label="Completadas" value={done} total={total} color="var(--green)" />
          <div style={S.divider} />
          <h3 style={S.panelTitle}>Avance por empresa</h3>
          {companies.length === 0 && <Empty mini text="Aún no hay empresas registradas." />}
          {companies.map((c) => {
            const acts = activities.filter((a) => a.companyId === c.id);
            const cavg = acts.length ? Math.round(acts.reduce((s, a) => s + a.progress, 0) / acts.length) : 0;
            return <BarRow key={c.id} label={`${c.nombre} (${acts.length})`} value={cavg} total={100} color="var(--accent)" pct />;
          })}
        </div>
        <div style={S.panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={S.panelTitle}>Reportes personalizados</h3>
            <button style={S.btnSm} onClick={exportReport} disabled={!filtered.length}><Download size={14} /> Exportar CSV</button>
          </div>
          <div style={S.filterRow} className="filterrow">
            <select style={S.select} value={repCompany} onChange={(e) => setRepCompany(e.target.value)}>
              <option value="all">Todas las empresas</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select style={S.select} value={repMember} onChange={(e) => setRepMember(e.target.value)}>
              <option value="all">Todo el equipo</option>
              {users.filter((u) => u.rol === "member").map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
            <select style={S.select} value={repStatus} onChange={(e) => setRepStatus(e.target.value)}>
              <option value="all">Todos los estados</option>
              <option value="pending">Pendientes</option>
              <option value="progress">En progreso</option>
              <option value="done">Completadas</option>
            </select>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>{filtered.length} resultado(s)</div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {filtered.map((a) => (
              <div key={a.id} style={S.repRow} onClick={() => onOpenActivity(a.id)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.repTitle}>{a.title}</div>
                  <div style={S.repMeta}>
                    {companies.find((c) => c.id === a.companyId)?.nombre || "—"} · {users.find((u) => u.id === a.assignedTo)?.nombre || "Sin asignar"}
                  </div>
                </div>
                <MiniProgress value={a.progress} />
                <ChevronRight size={16} color="var(--muted)" />
              </div>
            ))}
            {filtered.length === 0 && <Empty mini text="No hay actividades con esos filtros." />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ ADMIN: ACTIVIDADES ============
function AdminActivities({ activities, setOpenActId, openActId, companies, users, profile, reload }) {
  const [creating, setCreating] = useState(false);

  if (openActId) {
    const act = activities.find((a) => a.id === openActId);
    if (act) return <ActivityDetail activity={act} companies={companies} users={users} profile={profile} reload={reload} isAdmin onBack={() => setOpenActId(null)} />;
  }
  const members = users.filter((u) => u.rol === "member");

  return (
    <div>
      <PageHead title="Actividades" sub="Crea, asigna y da seguimiento"
        action={<button style={S.btnPrimary} onClick={() => setCreating(true)} disabled={!members.length || !companies.length}><Plus size={16} /> Nueva actividad</button>} />
      {(!members.length || !companies.length) && (
        <div style={S.alertStrip}><AlertCircle size={16} /><span>Para crear actividades primero registra al menos una <b>empresa</b> y un <b>integrante</b>.</span></div>
      )}
      <div style={S.cardGrid} className="cardgrid">
        {activities.length === 0 && <Empty text="Sin actividades. Crea la primera para empezar." />}
        {activities.map((a) => <ActivityCard key={a.id} a={a} companies={companies} users={users} onClick={() => setOpenActId(a.id)} />)}
      </div>
      {creating && (
        <ActivityForm companies={companies} members={members} onClose={() => setCreating(false)}
          onSave={async (data) => {
            const row = await Api.createActivity(data, profile.id);
            if (row) await Api.pushNotif(data.assignedTo, `Nueva actividad asignada: "${data.title}"`, row.id, "assign");
            setCreating(false); reload();
          }} />
      )}
    </div>
  );
}

function ActivityCard({ a, companies, users, onClick }) {
  const comp = companies.find((c) => c.id === a.companyId);
  const who = users.find((u) => u.id === a.assignedTo);
  const status = a.progress >= 100 ? "done" : a.progress > 0 ? "progress" : "pending";
  return (
    <div style={S.actCard} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <StatusPill status={status} />
        {a.approvalRequested && <span style={S.approvalTag}><ThumbsUp size={11} /> V°B° pendiente</span>}
      </div>
      <h4 style={S.actCardTitle}>{a.title}</h4>
      <p style={S.actCardDesc}>{a.description}</p>
      <div style={S.actCardMeta}>
        <span><Building2 size={12} /> {comp?.nombre || "—"}</span>
        <span><User size={12} /> {who?.nombre || "Sin asignar"}</span>
      </div>
      {a.photos?.length > 0 && <div style={S.thumbRow}>{a.photos.slice(0, 4).map((p, i) => <img key={i} src={p} style={S.thumb} alt="" />)}</div>}
      <MiniProgress value={a.progress} full />
    </div>
  );
}

// ============ FORM ACTIVIDAD ============
function ActivityForm({ companies, members, onClose, onSave }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id || "");
  const [assignedTo, setAssignedTo] = useState(members[0]?.id || "");
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoErr, setPhotoErr] = useState("");

  const addPhotos = async (files) => {
    setBusy(true); setPhotoErr("");
    const arr = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const r = await uploadPhoto(f);
      if (r.url) arr.push(r.url);
      else if (r.error) setPhotoErr("No se pudo subir una foto: " + r.error);
    }
    setPhotos((p) => [...p, ...arr].slice(0, 8));
    setBusy(false);
  };

  return (
    <Modal title="Nueva actividad" onClose={onClose}>
      <label style={S.label}>Título</label>
      <input style={S.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej. Instalación de red en sucursal norte" />
      <label style={S.label}>Descripción detallada</label>
      <textarea style={S.textarea} rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Alcance, materiales, condiciones y resultado esperado…" />
      <div style={S.formRow} className="formrow">
        <div style={{ flex: 1 }}>
          <label style={S.label}>Empresa</label>
          <select style={S.select} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={S.label}>Asignar a</label>
          <select style={S.select} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </div>
      </div>
      <label style={S.label}>Fotos de referencia</label>
      <PhotoUploader photos={photos} setPhotos={setPhotos} addPhotos={addPhotos} busy={busy} />
      {photoErr && <div style={S.errBox}><AlertCircle size={14} /> {photoErr}</div>}
      <div style={S.modalActions}>
        <button style={S.btnGhost} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} disabled={!title.trim() || !companyId || !assignedTo || saving || busy}
          onClick={async () => { setSaving(true); await onSave({ title: title.trim(), description: description.trim(), companyId, assignedTo, photos }); }}>
          {saving ? "Guardando…" : "Crear y asignar"}
        </button>
      </div>
    </Modal>
  );
}

function PhotoUploader({ photos, setPhotos, addPhotos, busy }) {
  const ref = useRef();
  return (
    <div>
      <div style={S.uploadZone} onClick={() => ref.current?.click()}>
        <Camera size={20} color="var(--accent)" />
        <span>{busy ? "Subiendo…" : "Toca para agregar fotos"}</span>
        <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => e.target.files && addPhotos(e.target.files)} />
      </div>
      {photos.length > 0 && (
        <div style={S.thumbGrid}>
          {photos.map((p, i) => (
            <div key={i} style={S.thumbWrap}>
              <img src={p} style={S.thumbLg} alt="" />
              <button style={S.thumbDel} onClick={() => setPhotos((ph) => ph.filter((_, j) => j !== i))}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ DETALLE ACTIVIDAD ============
function ActivityDetail({ activity: a, companies, users, profile, reload, isAdmin, onBack }) {
  const comp = companies.find((c) => c.id === a.companyId);
  const who = users.find((u) => u.id === a.assignedTo);
  const admin = users.find((u) => u.rol === "admin");
  const status = a.progress >= 100 ? "done" : a.progress > 0 ? "progress" : "pending";

  const [text, setText] = useState("");
  const [pct, setPct] = useState(a.progress);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoErr, setPhotoErr] = useState("");

  const addPhotos = async (files) => {
    setBusy(true); setPhotoErr("");
    const arr = [];
    for (const f of Array.from(files).slice(0, 4)) {
      const r = await uploadPhoto(f);
      if (r.url) arr.push(r.url);
      else if (r.error) setPhotoErr("No se pudo subir una foto: " + r.error);
    }
    setPhotos((p) => [...p, ...arr].slice(0, 6));
    setBusy(false);
  };

  const submitUpdate = async () => {
    if (!text.trim() && photos.length === 0 && pct === a.progress) return;
    setSaving(true);
    await Api.addUpdate(a.id, profile.id, text.trim(), photos, pct);
    const reached100 = pct >= 100 && a.progress < 100;
    if (admin) {
      if (reached100) await Api.pushNotif(admin.id, `"${a.title}" se completó al 100% (${profile.nombre})`, a.id, "done");
      else await Api.pushNotif(admin.id, `Avance en "${a.title}": ${pct}% (${profile.nombre})`, a.id, "progress");
    }
    setText(""); setPhotos([]); setSaving(false); reload();
  };

  const requestApproval = async () => {
    await Api.setApprovalRequested(a.id, true);
    if (admin) await Api.pushNotif(admin.id, `${who?.nombre || "Un integrante"} solicita tu visto bueno en "${a.title}"`, a.id, "approval");
    reload();
  };
  const giveApproval = async () => {
    await Api.approve(a.id);
    await Api.pushNotif(a.assignedTo, `El administrador dio el visto bueno en "${a.title}". Puedes continuar.`, a.id, "done");
    reload();
  };

  return (
    <div>
      <button style={S.backBtn} onClick={onBack}><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Volver</button>
      <div style={S.detailHead} className="detailhead">
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <StatusPill status={status} />
            {a.approvalRequested && <span style={S.approvalTag}><ThumbsUp size={11} /> V°B° pendiente</span>}
            {a.approved && <span style={S.okTag}><Check size={11} /> Aprobada</span>}
          </div>
          <h2 style={S.detailTitle}>{a.title}</h2>
          <div style={S.detailMeta}>
            <span><Building2 size={13} /> {comp?.nombre || "—"}</span>
            <span><User size={13} /> {who?.nombre || "Sin asignar"}</span>
            <span><Clock size={13} /> {fmtDate(a.createdAt)}</span>
          </div>
        </div>
        <div style={S.bigProgress}><ProgressRing value={a.progress} /></div>
      </div>

      {a.description && <div style={S.panel}><h3 style={S.panelTitle}><FileText size={14} /> Descripción</h3><p style={S.descText}>{a.description}</p></div>}
      {a.photos?.length > 0 && (
        <div style={S.panel}><h3 style={S.panelTitle}><ImageIcon size={14} /> Fotos de referencia</h3>
          <div style={S.thumbGrid}>{a.photos.map((p, i) => <img key={i} src={p} style={S.thumbLg} alt="" />)}</div></div>
      )}

      {isAdmin && a.approvalRequested && (
        <div style={S.approvalPanel}>
          <div><ThumbsUp size={18} /> <b>{who?.nombre}</b> solicita tu visto bueno para continuar.</div>
          <button style={{ ...S.btnPrimary, width: "auto" }} onClick={giveApproval}><Check size={16} /> Dar visto bueno</button>
        </div>
      )}

      {!isAdmin && a.assignedTo === profile.id && (
        <div style={S.panel}>
          <h3 style={S.panelTitle}><Send size={14} /> Reportar avance</h3>
          <textarea style={S.textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe lo realizado, observaciones o pendientes…" />
          <PhotoUploader photos={photos} setPhotos={setPhotos} addPhotos={addPhotos} busy={busy} />
          {photoErr && <div style={S.errBox}><AlertCircle size={14} /> {photoErr}</div>}
          <label style={S.label}>Porcentaje de avance: <b style={{ color: "var(--accent)" }}>{pct}%</b></label>
          <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={S.range} />
          <div style={S.updateActions} className="actionrow">
            <button style={S.btnGhost} onClick={requestApproval} disabled={a.approvalRequested}><ThumbsUp size={15} /> {a.approvalRequested ? "V°B° solicitado" : "Solicitar visto bueno"}</button>
            <button style={S.btnPrimary} onClick={submitUpdate} disabled={saving || busy}>{saving ? "Guardando…" : pct >= 100 ? "Marcar 100% y notificar" : "Guardar avance"}</button>
          </div>
        </div>
      )}

      <div style={S.panel}>
        <h3 style={S.panelTitle}><ClipboardList size={14} /> Bitácora de avances</h3>
        {(!a.updates || a.updates.length === 0) && <Empty mini text="Aún no hay avances reportados." />}
        <div style={S.timeline}>
          {[...(a.updates || [])].reverse().map((u) => {
            const author = users.find((x) => x.id === u.by);
            return (
              <div key={u.id} style={S.timeItem}>
                <div style={S.timeDot} />
                <div style={S.timeBody}>
                  <div style={S.timeHead}><b>{author?.nombre || "—"}</b><span style={S.timePct}>{u.pct}%</span><span style={S.timeDate}>{fmtDate(u.ts)}</span></div>
                  {u.text && <p style={S.timeText}>{u.text}</p>}
                  {u.photos?.length > 0 && <div style={S.thumbGrid}>{u.photos.map((p, i) => <img key={i} src={p} style={S.thumbLg} alt="" />)}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============ EMPRESAS ============
function Companies({ companies, activities, reload }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState(""); const [contact, setContact] = useState(""); const [address, setAddress] = useState("");

  const save = async () => {
    if (!name.trim()) return;
    await Api.addCompany({ nombre: name.trim(), contacto: contact.trim(), direccion: address.trim() });
    setName(""); setContact(""); setAddress(""); setAdding(false); reload();
  };

  return (
    <div>
      <PageHead title="Catálogo de empresas" sub="Lugares donde se ejecutan las actividades"
        action={<button style={S.btnPrimary} onClick={() => setAdding(true)}><Plus size={16} /> Agregar empresa</button>} />
      <div style={S.cardGrid} className="cardgrid">
        {companies.length === 0 && <Empty text="Sin empresas registradas." />}
        {companies.map((c) => {
          const count = activities.filter((a) => a.companyId === c.id).length;
          return (
            <div key={c.id} style={S.entityCard}>
              <div style={S.entityIcon}><Building2 size={20} /></div>
              <div style={{ flex: 1 }}>
                <h4 style={S.entityName}>{c.nombre}</h4>
                {c.contacto && <div style={S.entityMeta}>{c.contacto}</div>}
                {c.direccion && <div style={S.entityMeta}>{c.direccion}</div>}
                <div style={S.entityTag}>{count} actividad(es)</div>
              </div>
              <button style={S.iconBtnSm} onClick={async () => { await Api.delCompany(c.id); reload(); }}><Trash2 size={15} /></button>
            </div>
          );
        })}
      </div>
      {adding && (
        <Modal title="Agregar empresa" onClose={() => setAdding(false)}>
          <label style={S.label}>Nombre</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Comercializadora del Pacífico" />
          <label style={S.label}>Contacto (opcional)</label>
          <input style={S.input} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Nombre / teléfono" />
          <label style={S.label}>Dirección (opcional)</label>
          <input style={S.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, ciudad" />
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setAdding(false)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={save} disabled={!name.trim()}>Guardar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ EQUIPO ============
function Team({ users, activities, reload }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const members = users.filter((u) => u.rol === "member");

  const save = async () => {
    setErr(""); setOkMsg("");
    if (!name.trim() || !email.trim() || !pass.trim()) { setErr("Completa todos los campos."); return; }
    if (pass.trim().length < 6) { setErr("La contraseña debe tener al menos 6 caracteres."); return; }
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("crear-integrante", {
        body: { nombre: name.trim(), email: email.trim(), password: pass.trim() },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) { setErr(data?.error || "No se pudo crear el integrante."); setBusy(false); return; }
      setOkMsg(`Integrante creado. Comparte estos datos: correo ${email.trim()} y la contraseña que asignaste.`);
      setName(""); setEmail(""); setPass(""); setAdding(false); reload();
    } catch (e) {
      setErr("Error de conexión con el servidor.");
    }
    setBusy(false);
  };

  return (
    <div>
      <PageHead title="Equipo de trabajo" sub="Integrantes que ejecutan las actividades"
        action={<button style={S.btnPrimary} onClick={() => { setAdding(true); setOkMsg(""); }}><Plus size={16} /> Agregar integrante</button>} />
      {okMsg && <div style={{ ...S.infoBox, background: "rgba(34,197,94,.1)", borderColor: "rgba(34,197,94,.3)", color: "var(--green)" }}><Check size={16} /><span>{okMsg}</span></div>}
      <div style={S.cardGrid} className="cardgrid">
        {members.length === 0 && <Empty text="Aún no hay integrantes. Usa 'Agregar integrante' para crear sus cuentas." />}
        {members.map((m) => {
          const assigned = activities.filter((a) => a.assignedTo === m.id);
          const doneN = assigned.filter((a) => a.progress >= 100).length;
          return (
            <div key={m.id} style={S.entityCard}>
              <div style={S.avatar}>{m.nombre.slice(0, 2).toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <h4 style={S.entityName}>{m.nombre}</h4>
                <div style={S.entityTag}>{assigned.length} asignadas · {doneN} completadas</div>
              </div>
            </div>
          );
        })}
      </div>
      {adding && (
        <Modal title="Agregar integrante" onClose={() => setAdding(false)}>
          <label style={S.label}>Nombre completo</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Juan Pérez" />
          <label style={S.label}>Correo</label>
          <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@correo.com" />
          <label style={S.label}>Contraseña temporal</label>
          <input style={S.input} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Mínimo 6 caracteres" />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Comparte el correo y esta contraseña con el integrante. Podrá cambiarla después.</p>
          {err && <div style={S.errBox}><AlertCircle size={14} /> {err}</div>}
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setAdding(false)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={save} disabled={busy}>{busy ? "Creando…" : "Crear integrante"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ APP INTEGRANTE ============
function MemberApp({ profile }) {
  const data = useData(profile);
  const [openActId, setOpenActId] = useState(null);
  const logout = () => supabase.auth.signOut();
  const mine = data.activities.filter((a) => a.assignedTo === profile.id);
  const shared = { ...data, profile, onLogout: logout };

  if (openActId) {
    const act = data.activities.find((a) => a.id === openActId);
    if (act) return (
      <>
        <TopBar {...shared} onOpenActivity={setOpenActId} />
        <div style={S.body} className="appbody"><main style={{ ...S.main, marginLeft: 0 }} className="main">
          <ActivityDetail activity={act} companies={data.companies} users={data.users} profile={profile} reload={data.reload} isAdmin={false} onBack={() => setOpenActId(null)} />
          <Footer />
        </main></div>
      </>
    );
  }

  const pending = mine.filter((a) => a.progress < 100);
  const done = mine.filter((a) => a.progress >= 100);
  return (
    <>
      <TopBar {...shared} onOpenActivity={setOpenActId} />
      <div style={S.body} className="appbody">
        <main style={{ ...S.main, marginLeft: 0 }} className="main">
          <PageHead title={`Hola, ${profile.nombre.split(" ")[0]}`} sub="Tus actividades asignadas" />
          <div style={S.kpiGrid} className="kpigrid">
            <KpiCard icon={ClipboardList} label="Asignadas" value={mine.length} tone="accent" />
            <KpiCard icon={Clock} label="Por completar" value={pending.length} tone="amber" />
            <KpiCard icon={CheckCircle2} label="Completadas" value={done.length} tone="green" />
          </div>
          <div style={S.cardGrid} className="cardgrid">
            {mine.length === 0 && <Empty text="No tienes actividades asignadas todavía." />}
            {mine.map((a) => <ActivityCard key={a.id} a={a} companies={data.companies} users={data.users} onClick={() => setOpenActId(a.id)} />)}
          </div>
          <Footer />
        </main>
      </div>
    </>
  );
}

// ============ UI COMPARTIDOS ============
function PageHead({ title, sub, action }) {
  return <div style={S.pageHead}><div><h1 style={S.pageTitle}>{title}</h1>{sub && <p style={S.pageSub}>{sub}</p>}</div>{action}</div>;
}
function KpiCard({ icon: Icon, label, value, tone }) {
  return <div style={{ ...S.kpiCard, borderTopColor: `var(--${tone})` }}><div style={{ ...S.kpiIcon, color: `var(--${tone})` }}><Icon size={18} /></div><div style={S.kpiValue}>{value}</div><div style={S.kpiLabel}>{label}</div></div>;
}
function StatusPill({ status }) {
  const map = { done: { t: "Completada", c: "var(--green)" }, progress: { t: "En progreso", c: "var(--amber)" }, pending: { t: "Pendiente", c: "var(--muted)" } };
  const s = map[status];
  return <span style={{ ...S.pill, color: s.c, borderColor: s.c }}>{s.t}</span>;
}
function MiniProgress({ value, full }) {
  return <div style={{ ...S.miniProgWrap, width: full ? "100%" : 80 }}><div style={S.miniProgBar}><div style={{ ...S.miniProgFill, width: value + "%" }} /></div><span style={S.miniProgTxt}>{value}%</span></div>;
}
function ProgressRing({ value }) {
  const r = 34, c = 2 * Math.PI * r, off = c - (value / 100) * c;
  const color = value >= 100 ? "var(--green)" : value > 0 ? "var(--accent)" : "var(--muted)";
  return (
    <svg width="84" height="84" viewBox="0 0 84 84">
      <circle cx="42" cy="42" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 42 42)" style={{ transition: "stroke-dashoffset .5s" }} />
      <text x="42" y="48" textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--text)">{value}%</text>
    </svg>
  );
}
function BarRow({ label, value, total, color, pct }) {
  const w = total ? (value / total) * 100 : 0;
  return <div style={S.barRow}><div style={S.barLabel}>{label}</div><div style={S.barTrack}><div style={{ ...S.barFill, width: w + "%", background: color }} /></div><div style={S.barVal}>{pct ? value + "%" : value}</div></div>;
}
function Modal({ title, children, onClose }) {
  return <div style={S.overlay} onClick={onClose}><div style={S.modal} onClick={(e) => e.stopPropagation()}><div style={S.modalHead}><h3 style={S.modalTitle}>{title}</h3><button style={S.iconBtnSm} onClick={onClose}><X size={18} /></button></div><div style={S.modalBody}>{children}</div></div></div>;
}
function Empty({ text, mini }) {
  return <div style={{ ...S.empty, padding: mini ? "20px" : "48px 24px" }}><ClipboardList size={mini ? 20 : 32} color="var(--muted)" /><p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>{text}</p></div>;
}

function Footer() {
  return (
    <div style={S.footer}>
      <img src="/logo-op.png" alt="Centro de Operaciones" style={S.footerLogo} />
      <div style={S.footerText}>All rights reserved · Aldox Networks © 2026</div>
    </div>
  );
}

// ============ ESTILOS ============
const S = {
  root: { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--body)" },
  appWrap: { minHeight: "100vh" },
  bareWrap: { minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 },
  logoMark: { width: 64, height: 64, borderRadius: 14, display: "block", margin: "0 auto" },
  logoMarkSm: { width: 38, height: 38, borderRadius: 10, display: "block" },
  loginCard: { width: "100%", maxWidth: 380, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 32 },
  loginTitle: { fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, textAlign: "center", margin: "18px 0 4px" },
  loginSub: { textAlign: "center", color: "var(--muted)", fontSize: 13, margin: "0 0 24px" },
  hint: { textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 16 },
  label: { display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted)", margin: "14px 0 6px", letterSpacing: .3 },
  input: { width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 14, fontFamily: "var(--body)", outline: "none" },
  textarea: { width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 14, fontFamily: "var(--body)", outline: "none", resize: "vertical" },
  select: { width: "100%", boxSizing: "border-box", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 13px", color: "var(--text)", fontSize: 14, fontFamily: "var(--body)", outline: "none", cursor: "pointer" },
  range: { width: "100%", accentColor: "var(--accent)", marginTop: 6 },
  btnPrimary: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "var(--accent)", color: "#1a1a1a", border: "none", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)", width: "100%" },
  btnGhost: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "transparent", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)", width: "100%" },
  btnSm: { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  linkBtn: { background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, cursor: "pointer", fontWeight: 600, padding: 0 },
  errBox: { display: "flex", alignItems: "center", gap: 7, background: "rgba(220,80,80,.12)", color: "#f87171", padding: "9px 12px", borderRadius: 8, fontSize: 12.5, marginTop: 12, lineHeight: 1.4 },
  infoBox: { display: "flex", alignItems: "center", gap: 10, background: "rgba(96,165,250,.1)", border: "1px solid rgba(96,165,250,.3)", color: "var(--blue)", padding: "12px 16px", borderRadius: 12, fontSize: 13, marginBottom: 20, lineHeight: 1.45 },
  topbar: { height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", background: "var(--surface)", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, zIndex: 50 },
  topName: { fontSize: 14, fontWeight: 700 },
  topRole: { fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 },
  iconBtn: { position: "relative", width: 40, height: 40, borderRadius: 10, background: "var(--bg)", border: "1px solid var(--line)", color: "var(--text)", display: "grid", placeItems: "center", cursor: "pointer" },
  iconBtnSm: { width: 32, height: 32, borderRadius: 8, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)", display: "grid", placeItems: "center", cursor: "pointer" },
  badge: { position: "absolute", top: -5, right: -5, minWidth: 19, height: 19, padding: "0 5px", borderRadius: 10, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", border: "2px solid var(--surface)", boxSizing: "content-box" },
  notifPanel: { position: "absolute", top: 48, right: 0, width: 320, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.5)", zIndex: 100, overflow: "hidden" },
  notifHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line)", fontSize: 13, fontWeight: 700 },
  notifEmpty: { padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 },
  notifItem: { display: "flex", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--line)", cursor: "pointer" },
  notifDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  notifText: { fontSize: 13, lineHeight: 1.4 },
  notifTime: { fontSize: 11, color: "var(--muted)", marginTop: 3 },
  body: { display: "flex" },
  sidenav: { width: 210, padding: 16, borderRight: "1px solid var(--line)", minHeight: "calc(100vh - 60px)", position: "sticky", top: 60, alignSelf: "flex-start", background: "var(--surface)" },
  navItem: { display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "11px 13px", borderRadius: 10, background: "transparent", border: "none", color: "var(--muted)", fontSize: 14, fontWeight: 600, cursor: "pointer", marginBottom: 4, fontFamily: "var(--body)", textAlign: "left" },
  navItemActive: { display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "11px 13px", borderRadius: 10, background: "var(--bg)", border: "none", color: "var(--accent)", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 4, fontFamily: "var(--body)", textAlign: "left" },
  main: { flex: 1, padding: 28, maxWidth: 1080, margin: "0 auto", width: "100%", boxSizing: "border-box" },
  pageHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 24, flexWrap: "wrap" },
  pageTitle: { fontFamily: "var(--display)", fontSize: 28, fontWeight: 700, margin: 0 },
  pageSub: { color: "var(--muted)", fontSize: 13.5, margin: "4px 0 0" },
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 14, marginBottom: 22 },
  kpiCard: { background: "var(--surface)", border: "1px solid var(--line)", borderTop: "3px solid", borderRadius: 14, padding: "18px 18px 16px" },
  kpiIcon: { marginBottom: 10 },
  kpiValue: { fontFamily: "var(--display)", fontSize: 32, fontWeight: 700, lineHeight: 1 },
  kpiLabel: { fontSize: 12.5, color: "var(--muted)", marginTop: 5 },
  alertStrip: { display: "flex", alignItems: "center", gap: 10, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", color: "var(--amber)", padding: "12px 16px", borderRadius: 12, fontSize: 13.5, marginBottom: 20 },
  twoCol: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 },
  panel: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 20, marginBottom: 18 },
  panelTitle: { display: "flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 700, margin: "0 0 14px", fontFamily: "var(--body)" },
  divider: { height: 1, background: "var(--line)", margin: "18px 0" },
  barRow: { display: "flex", alignItems: "center", gap: 12, marginBottom: 11 },
  barLabel: { width: 150, fontSize: 12.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  barTrack: { flex: 1, height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4, transition: "width .5s" },
  barVal: { width: 40, textAlign: "right", fontSize: 12.5, fontFamily: "var(--mono)", fontWeight: 600 },
  filterRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 },
  repRow: { display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--line)", cursor: "pointer" },
  repTitle: { fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  repMeta: { fontSize: 11.5, color: "var(--muted)", marginTop: 2 },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 },
  actCard: { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, cursor: "pointer", transition: "border-color .2s" },
  actCardTitle: { fontSize: 16, fontWeight: 700, margin: "12px 0 6px", fontFamily: "var(--body)" },
  actCardDesc: { fontSize: 13, color: "var(--muted)", margin: "0 0 14px", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  actCardMeta: { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted)", marginBottom: 12 },
  thumbRow: { display: "flex", gap: 5, marginBottom: 12 },
  thumb: { width: 40, height: 40, borderRadius: 7, objectFit: "cover", border: "1px solid var(--line)" },
  thumbGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 },
  thumbLg: { width: 88, height: 88, borderRadius: 9, objectFit: "cover", border: "1px solid var(--line)" },
  thumbWrap: { position: "relative" },
  thumbDel: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, background: "#1a1a1a", border: "1px solid var(--line)", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer" },
  pill: { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, border: "1px solid", letterSpacing: .3 },
  approvalTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--amber)", background: "rgba(245,158,11,.12)", padding: "3px 9px", borderRadius: 20 },
  okTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--green)", background: "rgba(34,197,94,.12)", padding: "3px 9px", borderRadius: 20 },
  miniProgWrap: { display: "flex", alignItems: "center", gap: 8 },
  miniProgBar: { flex: 1, height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" },
  miniProgFill: { height: "100%", background: "var(--accent)", borderRadius: 3, transition: "width .4s" },
  miniProgTxt: { fontSize: 11.5, fontFamily: "var(--mono)", fontWeight: 600, color: "var(--muted)", minWidth: 32, textAlign: "right" },
  entityCard: { display: "flex", alignItems: "flex-start", gap: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18 },
  entityIcon: { width: 44, height: 44, borderRadius: 11, background: "var(--bg)", color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 },
  avatar: { width: 44, height: 44, borderRadius: 11, background: "linear-gradient(135deg,var(--accent),#b45309)", color: "#1a1a1a", display: "grid", placeItems: "center", fontWeight: 800, fontSize: 15, flexShrink: 0, fontFamily: "var(--display)" },
  entityName: { fontSize: 15.5, fontWeight: 700, margin: 0 },
  entityMeta: { fontSize: 12.5, color: "var(--muted)", marginTop: 3 },
  entityTag: { display: "inline-block", fontSize: 11.5, color: "var(--accent)", background: "var(--bg)", padding: "3px 9px", borderRadius: 6, marginTop: 8, fontWeight: 600 },
  backBtn: { display: "inline-flex", alignItems: "center", gap: 5, background: "transparent", border: "none", color: "var(--muted)", fontSize: 13.5, cursor: "pointer", marginBottom: 16, fontWeight: 600, fontFamily: "var(--body)" },
  detailHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 20 },
  detailTitle: { fontFamily: "var(--display)", fontSize: 26, fontWeight: 700, margin: "0 0 10px" },
  detailMeta: { display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12.5, color: "var(--muted)" },
  bigProgress: { flexShrink: 0 },
  descText: { fontSize: 14, lineHeight: 1.65, color: "var(--text)", margin: 0, whiteSpace: "pre-wrap" },
  approvalPanel: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 14, padding: 18, marginBottom: 18, flexWrap: "wrap" },
  updateActions: { display: "flex", gap: 10, marginTop: 14 },
  timeline: { position: "relative" },
  timeItem: { display: "flex", gap: 14, paddingBottom: 18 },
  timeDot: { width: 11, height: 11, borderRadius: 6, background: "var(--accent)", marginTop: 4, flexShrink: 0, boxShadow: "0 0 0 4px var(--bg)" },
  timeBody: { flex: 1, borderLeft: "1px solid var(--line)", marginLeft: -19, paddingLeft: 24, paddingBottom: 4 },
  timeHead: { display: "flex", alignItems: "center", gap: 10, fontSize: 13, flexWrap: "wrap" },
  timePct: { fontFamily: "var(--mono)", fontWeight: 700, color: "var(--accent)", fontSize: 12.5 },
  timeDate: { fontSize: 11.5, color: "var(--muted)", marginLeft: "auto" },
  timeText: { fontSize: 13.5, lineHeight: 1.55, margin: "7px 0 0", whiteSpace: "pre-wrap" },
  uploadZone: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: "20px", border: "1.5px dashed var(--line)", borderRadius: 12, cursor: "pointer", color: "var(--muted)", fontSize: 13, background: "var(--bg)" },
  formRow: { display: "flex", gap: 14 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", display: "grid", placeItems: "center", padding: 20, zIndex: 200 },
  modal: { width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18 },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 20px", borderBottom: "1px solid var(--line)", position: "sticky", top: 0, background: "var(--surface)" },
  modalTitle: { fontFamily: "var(--display)", fontSize: 19, fontWeight: 700, margin: 0 },
  modalBody: { padding: 20 },
  modalActions: { display: "flex", gap: 12, marginTop: 22 },
  empty: { gridColumn: "1/-1", textAlign: "center", border: "1.5px dashed var(--line)", borderRadius: 14 },
  footer: { marginTop: 36, paddingTop: 24, borderTop: "1px solid var(--line)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, opacity: 0.85 },
  footerLogo: { width: 44, height: 44, display: "block" },
  footerText: { fontSize: 11.5, color: "var(--muted)", letterSpacing: 0.3, textAlign: "center" },
};

const CSS = `
:root{
  --bg:#13151a; --surface:#1b1e25; --line:#2c313b; --text:#eef0f4; --muted:#8c93a3;
  --accent:#f59e0b; --green:#22c55e; --amber:#fbbf24; --blue:#60a5fa;
  --display:'Archivo','Arial Narrow',sans-serif; --body:'Inter',system-ui,sans-serif; --mono:'Roboto Mono',monospace;
}
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@500;600;700&display=swap');
*{margin:0;box-sizing:border-box}
html,body{margin:0;max-width:100%;overflow-x:hidden}
img{max-width:100%}
button:hover{filter:brightness(1.08)}
.actCard:hover{border-color:var(--accent)!important}
input:focus,textarea:focus,select:focus{border-color:var(--accent)!important}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
@media(max-width:760px){
  /* El menú lateral pasa a ser barra inferior fija */
  .appbody{ display:block !important; }
  .sidenav{
    position:fixed !important; bottom:0; left:0; right:0; top:auto !important;
    width:100% !important; min-height:0 !important;
    display:flex !important; flex-direction:row !important;
    justify-content:space-around; align-items:center;
    padding:6px 4px !important; gap:2px;
    border-right:none !important; border-top:1px solid var(--line);
    z-index:60; box-sizing:border-box;
  }
  .navitem, .navitem.active{ flex-direction:column !important; gap:3px !important;
    font-size:10px !important; padding:7px 4px !important; margin:0 !important;
    flex:1; text-align:center !important; justify-content:center !important; }
  .navlabel{ display:block !important; font-size:10px; }
  .main{ padding:16px !important; padding-bottom:84px !important; max-width:100% !important; }
  /* Columnas dobles se apilan */
  .twocol{ grid-template-columns:1fr !important; }
  .filterrow{ grid-template-columns:1fr !important; }
  .detailhead{ flex-direction:column !important; align-items:flex-start !important; }
  .topbar{ padding:0 14px !important; }
  /* Evitar desbordes: rejillas a una columna en móvil */
  .cardgrid{ grid-template-columns:1fr !important; }
  .kpigrid{ grid-template-columns:1fr 1fr !important; }
  /* Botones de acción y filas de formulario se apilan */
  .actionrow{ flex-direction:column !important; }
  .formrow{ flex-direction:column !important; gap:0 !important; }
}
`;
