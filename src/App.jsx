import React, { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "./supabase";
import { registerPushSW, activarNotificaciones, permisoConcedido } from "./push";
import {
  Bell, LayoutDashboard, ClipboardList, Building2, Users, LogOut,
  Plus, X, Camera, Check, AlertCircle, ChevronRight, Trash2,
  TrendingUp, Clock, CheckCircle2, FileText, Image as ImageIcon,
  ThumbsUp, Send, User, Download, Shield, Pencil, Quote, ThumbsDown, Timer,
  Eye, EyeOff,
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

// Helpers: una foto puede ser un string (formato viejo) o { url, descripcion } (nuevo)
const photoUrl = (p) => (typeof p === "string" ? p : p?.url || "");
const photoDesc = (p) => (typeof p === "string" ? "" : p?.descripcion || "");

// Periodicidades disponibles y cuánto suman
const PERIODOS = [
  { id: "diaria", label: "Diaria", dias: 1 },
  { id: "semanal", label: "Semanal", dias: 7 },
  { id: "quincenal", label: "Quincenal", dias: 15 },
  { id: "mensual", label: "Mensual", meses: 1 },
  { id: "bimestral", label: "Bimestral", meses: 2 },
  { id: "trimestral", label: "Trimestral", meses: 3 },
  { id: "semestral", label: "Semestral", meses: 6 },
  { id: "anual", label: "Anual", meses: 12 },
];
const periodoLabel = (id) => PERIODOS.find((p) => p.id === id)?.label || "";

// Calcula la siguiente fecha a partir de una fecha y una periodicidad
function siguienteFecha(fechaBase, periodicidad) {
  const p = PERIODOS.find((x) => x.id === periodicidad);
  if (!p) return null;
  const d = fechaBase ? new Date(fechaBase + "T00:00:00") : new Date();
  if (p.dias) d.setDate(d.getDate() + p.dias);
  if (p.meses) d.setMonth(d.getMonth() + p.meses);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ¿La fecha programada ya pasó? (para marcar "vencida")
function estaVencida(fechaProgramada, progress) {
  if (!fechaProgramada || progress >= 100) return false;
  const hoy = new Date().toISOString().slice(0, 10);
  return fechaProgramada < hoy;
}

// ============ APP ============
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    registerPushSW();
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
      <FraseMotivadora />
      <Lightbox />
      {profile.rol === "admin"
        ? <AdminApp profile={profile} />
        : <MemberApp profile={profile} />}
    </Shell>
  );
}

// Muestra una frase motivadora aleatoria una vez al abrir la app
function FraseMotivadora() {
  const [frase, setFrase] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Solo una vez por apertura de app (no en cada recarga de datos)
    if (sessionStorage.getItem("fraseMostrada")) return;
    (async () => {
      const lista = await Api.getFrases();
      if (lista.length) {
        setFrase(lista[Math.floor(Math.random() * lista.length)]);
        setShow(true);
        sessionStorage.setItem("fraseMostrada", "1");
      }
    })();
  }, []);

  if (!show || !frase) return null;
  return (
    <div style={S.fraseOverlay} onClick={() => setShow(false)}>
      <div style={S.fraseCard} onClick={(e) => e.stopPropagation()}>
        <Quote size={28} color="var(--accent)" />
        <p style={S.fraseText}>{frase.texto}</p>
        <button style={S.btnPrimary} onClick={() => setShow(false)}>Comenzar</button>
      </div>
    </div>
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
    motivoAprobacion: a.motivo_aprobacion,
    rejected: a.rechazada, motivoRechazo: a.motivo_rechazo, fotosRechazo: a.fotos_rechazo || [],
    startedAt: a.iniciada, completedAt: a.completada_en,
    periodicidad: a.periodicidad, fechaProgramada: a.fecha_programada, serieId: a.serie_id,
    updates: (a.avances || []).map((u) => ({
      id: u.id, by: u.autor_id, text: u.texto, photos: u.fotos || [], pct: u.progreso, ts: u.creado,
      solicitaVB: u.solicita_vb, motivoVB: u.motivo_vb,
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
      periodicidad: data.periodicidad || null,
      fecha_programada: data.fechaProgramada || null,
      serie_id: data.serieId || null,
    }).select().single();
    return row;
  },
  async updateActivity(id, data) {
    await supabase.from("actividades").update({
      titulo: data.title, descripcion: data.description, empresa_id: data.companyId,
      asignado_a: data.assignedTo, fotos: data.photos,
      periodicidad: data.periodicidad || null,
      fecha_programada: data.fechaProgramada || null,
    }).eq("id", id);
  },
  async delActivity(id) {
    await supabase.from("avances").delete().eq("actividad_id", id);
    await supabase.from("actividades").delete().eq("id", id);
  },
  async updateAvance(id, text, photos) {
    await supabase.from("avances").update({ texto: text, fotos: photos }).eq("id", id);
  },
  async addUpdate(activityId, authorId, text, photos, pct, activity, vb) {
    const { data: avance } = await supabase.from("avances")
      .insert({ actividad_id: activityId, autor_id: authorId, texto: text, fotos: photos, progreso: pct,
                solicita_vb: vb?.solicita || false, motivo_vb: vb?.motivo || null })
      .select().single();
    const patch = { progreso: pct };
    if (pct > 0 && !activity?.startedAt) patch.iniciada = new Date().toISOString();
    if (pct >= 100 && activity?.progress < 100) patch.completada_en = new Date().toISOString();
    // Si este avance solicita visto bueno, lo marcamos en la actividad y lo vinculamos
    if (vb?.solicita) {
      patch.aprobacion_solicitada = true;
      patch.motivo_aprobacion = vb.motivo || null;
      patch.avance_vb = avance?.id || null;
      patch.rechazada = false;
      patch.motivo_rechazo = null;
    }
    await supabase.from("actividades").update(patch).eq("id", activityId);

    // Si es recurrente y se acaba de completar, generar la siguiente repetición
    if (pct >= 100 && activity?.progress < 100 && activity?.periodicidad) {
      const nuevaFecha = siguienteFecha(activity.fechaProgramada, activity.periodicidad);
      const { data: nueva } = await supabase.from("actividades").insert({
        titulo: activity.title, descripcion: activity.description, empresa_id: activity.companyId,
        asignado_a: activity.assignedTo, fotos: activity.photos, creado_por: activity.createdBy,
        periodicidad: activity.periodicidad, fecha_programada: nuevaFecha,
        serie_id: activity.serieId || activity.id,
      }).select().single();
      // Avisar al responsable de la nueva repetición programada
      if (nueva) {
        await this.pushNotif(activity.assignedTo, `Nueva actividad programada: "${activity.title}" para el ${nuevaFecha}`, nueva.id, "assign");
      }
    }
  },
  async setApprovalRequested(activityId, val, motivo = null) {
    await supabase.from("actividades").update({ aprobacion_solicitada: val, motivo_aprobacion: motivo, rechazada: false, motivo_rechazo: null }).eq("id", activityId);
  },
  async approve(activityId) {
    await supabase.from("actividades").update({ aprobacion_solicitada: false, aprobada: true, rechazada: false }).eq("id", activityId);
  },
  async reject(activityId, motivo, fotos) {
    await supabase.from("actividades").update({ aprobacion_solicitada: false, aprobada: false, rechazada: true, motivo_rechazo: motivo, fotos_rechazo: fotos || [] }).eq("id", activityId);
  },
  async addDetalle(d) {
    await supabase.from("detalles").insert({
      empresa_id: d.companyId, reportado_por: d.reportadoPor,
      titulo: d.titulo, descripcion: d.descripcion, fotos: d.fotos,
    });
  },
  async getDetalles() {
    const { data } = await supabase.from("detalles").select("*").order("creado", { ascending: false });
    return data || [];
  },
  async descartarDetalle(id) {
    await supabase.from("detalles").update({ estado: "descartado" }).eq("id", id);
  },
  async detalleAActividad(detalle, actividadId) {
    await supabase.from("detalles").update({ estado: "convertido", actividad_id: actividadId }).eq("id", detalle.id);
  },
  async addCompany(c) { await supabase.from("empresas").insert(c); },
  async updateCompany(id, c) { await supabase.from("empresas").update(c).eq("id", id); },
  async delCompany(id) { await supabase.from("empresas").delete().eq("id", id); },
  async updateUser(id, p) { await supabase.from("perfiles").update(p).eq("id", id); },
  async addFrase(texto) { await supabase.from("frases").insert({ texto }); },
  async delFrase(id) { await supabase.from("frases").delete().eq("id", id); },
  async getFrases() { const { data } = await supabase.from("frases").select("*"); return data || []; },
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
        <img src="/icono-512.png" alt="iTask" style={S.logoMark} />
        <p style={{ color: "var(--muted)", marginTop: 16, letterSpacing: 2, fontSize: 12 }}>CARGANDO…</p>
      </div>
    </div>
  );
}

// ============ LOGIN ============
function Login() {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
    if (error) setErr("Correo o contraseña incorrectos.");
    setBusy(false);
  };

  return (
    <div style={S.loginCard}>
      <img src="/icono-512.png" alt="iTask" style={S.logoMark} />
      <h1 style={S.loginTitle}>iTask</h1>
      <p style={S.loginSub}>Control y seguimiento de actividades</p>

      <label style={S.label}>Correo</label>
      <input style={S.input} value={email} onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@ejemplo.com" onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label style={S.label}>Contraseña</label>
      <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)}
        placeholder="••••••" onKeyDown={(e) => e.key === "Enter" && submit()} />

      {err && <div style={S.errBox}><AlertCircle size={14} /> {err}</div>}

      <button style={{ ...S.btnPrimary, marginTop: 16, opacity: busy ? 0.6 : 1 }} onClick={submit} disabled={busy}>
        {busy ? "Procesando…" : "Entrar"}
      </button>
    </div>
  );
}

// ============ TOPBAR ============
function TopBar({ profile, notifs, onLogout, activities, onOpenActivity, reload }) {
  const [open, setOpen] = useState(false);
  const [pushOn, setPushOn] = useState(permisoConcedido());
  const [pushMsg, setPushMsg] = useState("");
  const unread = notifs.filter((n) => !n.leida).length;
  const ref = useRef();

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const activar = async () => {
    setPushMsg("");
    const r = await activarNotificaciones(profile.id);
    if (r.ok) { setPushOn(true); setPushMsg("¡Notificaciones activadas!"); }
    else setPushMsg(r.error || "No se pudo activar.");
  };

  return (
    <div style={S.topbar}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src="/icono-512.png" alt="iTask" style={S.logoMarkSm} />
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
              {!pushOn && (
                <div style={S.pushActivar}>
                  <button style={S.btnSm} onClick={activar}><Bell size={13} /> Activar avisos en este celular</button>
                  {pushMsg && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>{pushMsg}</div>}
                </div>
              )}
              {pushOn && pushMsg && <div style={{ ...S.pushActivar, color: "var(--green)", fontSize: 12 }}>{pushMsg}</div>}
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
    { id: "detalles", label: "Detalles", icon: AlertCircle },
    { id: "companies", label: "Empresas", icon: Building2 },
    { id: "team", label: "Equipo", icon: Users },
    { id: "frases", label: "Frases", icon: Quote },
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
          {tab === "detalles" && <DetallesAdmin {...shared} onConvertido={data.reload} />}
          {tab === "companies" && <Companies {...shared} onOpenActivity={openActivity} />}
          {tab === "team" && <Team {...shared} onOpenActivity={openActivity} />}
          {tab === "frases" && <Frases />}
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
  const [verPendientesVB, setVerPendientesVB] = useState(false);

  const pendientesVB = activities.filter((a) => a.approvalRequested);

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
        <KpiCard icon={AlertCircle} label="Por iniciar" value={pending} tone="muted" />
        <KpiCard icon={Clock} label="En progreso" value={inProgress} tone="amber" />
        <KpiCard icon={CheckCircle2} label="Completadas" value={done} tone="green" />
      </div>
      {needApproval > 0 && (
        <div>
          <div style={{ ...S.alertStrip, cursor: "pointer", marginBottom: verPendientesVB ? 8 : 20 }} onClick={() => setVerPendientesVB((v) => !v)}>
            <ThumbsUp size={16} />
            <span style={{ flex: 1 }}><b>{needApproval}</b> actividad(es) esperan tu visto bueno.</span>
            <ChevronRight size={16} style={{ transform: verPendientesVB ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
          </div>
          {verPendientesVB && (
            <div style={{ ...S.panel, marginBottom: 20 }}>
              {pendientesVB.map((a) => (
                <div key={a.id} style={S.repRow} onClick={() => onOpenActivity(a.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.repTitle}>{a.title}</div>
                    <div style={S.repMeta}>
                      {companies.find((c) => c.id === a.companyId)?.nombre || "—"} · {users.find((u) => u.id === a.assignedTo)?.nombre || "Sin asignar"}
                    </div>
                  </div>
                  <span style={S.approvalTag}><ThumbsUp size={11} /> V°B°</span>
                  <ChevronRight size={16} color="var(--muted)" />
                </div>
              ))}
            </div>
          )}
        </div>
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
  const vencida = estaVencida(a.fechaProgramada, a.progress);
  return (
    <div style={{ ...S.actCard, ...(vencida ? { borderColor: "rgba(220,80,80,.5)" } : {}) }} onClick={onClick}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <StatusPill status={status} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {a.periodicidad && <span style={S.recurTag}><Clock size={11} /> {periodoLabel(a.periodicidad)}</span>}
          {a.approvalRequested && <span style={S.approvalTag}><ThumbsUp size={11} /> V°B° pendiente</span>}
        </div>
      </div>
      <h4 style={S.actCardTitle}>{a.title}</h4>
      <p style={S.actCardDesc}>{a.description}</p>
      <div style={S.actCardMeta}>
        <span><Building2 size={12} /> {comp?.nombre || "—"}</span>
        <span><User size={12} /> {who?.nombre || "Sin asignar"}</span>
      </div>
      {a.fechaProgramada && (
        <div style={vencida ? S.fechaVencida : S.fechaProg}>
          <Timer size={12} /> {vencida ? "Vencida: " : "Programada: "}{fmtFecha(a.fechaProgramada)}
        </div>
      )}
      {a.photos?.length > 0 && <div style={S.thumbRow}>{a.photos.slice(0, 4).map((p, i) => <img key={i} src={photoUrl(p)} style={{ ...S.thumb, cursor: "pointer" }} alt="" onClick={(e) => { e.stopPropagation(); openLightbox(a.photos, i); }} />)}</div>}
      <MiniProgress value={a.progress} full />
    </div>
  );
}

// Formatea una fecha YYYY-MM-DD a algo legible (ej. 15 mar 2026)
function fmtFecha(f) {
  if (!f) return "";
  const d = new Date(f + "T00:00:00");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

// ============ FORM ACTIVIDAD ============
function ActivityForm({ companies, members, onClose, onSave, initial }) {
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [companyId, setCompanyId] = useState(initial?.companyId || companies[0]?.id || "");
  const [assignedTo, setAssignedTo] = useState(initial?.assignedTo || members[0]?.id || "");
  const [photos, setPhotos] = useState(initial?.photos || []);
  const [periodicidad, setPeriodicidad] = useState(initial?.periodicidad || "");
  const [fechaProgramada, setFechaProgramada] = useState(initial?.fechaProgramada || "");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const esEdicion = !!initial;

  const addPhotos = async (files) => {
    setBusy(true); setPhotoErr("");
    const arr = [];
    for (const f of Array.from(files).slice(0, 6)) {
      const r = await uploadPhoto(f);
      if (r.url) arr.push({ url: r.url, descripcion: "" });
      else if (r.error) setPhotoErr("No se pudo subir una foto: " + r.error);
    }
    setPhotos((p) => [...p, ...arr].slice(0, 8));
    setBusy(false);
  };

  return (
    <Modal title={esEdicion ? "Editar actividad" : "Nueva actividad"} onClose={onClose}>
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

      <div style={{ borderTop: "1px solid var(--line)", margin: "18px 0 14px" }} />
      <label style={S.label}>Programación (opcional)</label>
      <div style={S.formRow} className="formrow">
        <div style={{ flex: 1 }}>
          <label style={{ ...S.label, fontSize: 12, color: "var(--muted)" }}>Fecha de inicio específica</label>
          <input style={S.input} type="date" value={fechaProgramada || ""} onChange={(e) => setFechaProgramada(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ ...S.label, fontSize: 12, color: "var(--muted)" }}>Repetir</label>
          <select style={S.select} value={periodicidad} onChange={(e) => setPeriodicidad(e.target.value)}>
            <option value="">No se repite</option>
            {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      </div>
      {periodicidad && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
          Al completarse, se generará automáticamente la siguiente ({periodoLabel(periodicidad).toLowerCase()}) para el responsable.
        </p>
      )}

      <div style={S.modalActions}>
        <button style={S.btnGhost} onClick={onClose}>Cancelar</button>
        <button style={S.btnPrimary} disabled={!title.trim() || !companyId || !assignedTo || saving || busy}
          onClick={async () => { setSaving(true); await onSave({ title: title.trim(), description: description.trim(), companyId, assignedTo, photos, periodicidad, fechaProgramada }); }}>
          {saving ? "Guardando…" : esEdicion ? "Guardar cambios" : "Crear y asignar"}
        </button>
      </div>
    </Modal>
  );
}

function PhotoUploader({ photos, setPhotos, addPhotos, busy }) {
  const ref = useRef();
  const setDesc = (i, desc) => setPhotos((ph) => ph.map((p, j) => {
    if (j !== i) return p;
    const url = photoUrl(p);
    return { url, descripcion: desc };
  }));
  return (
    <div>
      <div style={S.uploadZone} onClick={() => ref.current?.click()}>
        <Camera size={20} color="var(--accent)" />
        <span>{busy ? "Subiendo…" : "Toca para agregar fotos"}</span>
        <input ref={ref} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => e.target.files && addPhotos(e.target.files)} />
      </div>
      {photos.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
          {photos.map((p, i) => (
            <div key={i} style={S.photoItem}>
              <div style={S.thumbWrap}>
                <img src={photoUrl(p)} style={S.thumbLg} alt="" />
                <button style={S.thumbDel} onClick={() => setPhotos((ph) => ph.filter((_, j) => j !== i))}><X size={12} /></button>
              </div>
              <input style={{ ...S.input, flex: 1 }} value={photoDesc(p)} onChange={(e) => setDesc(i, e.target.value)}
                placeholder="Descripción de la foto (opcional)" />
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
  const [pideVB, setPideVB] = useState(false); // casilla: solicito visto bueno
  const [motivoVB, setMotivoVB] = useState(""); // motivo de la solicitud
  const [showReject, setShowReject] = useState(false); // modal: admin rechaza
  const [motivoRej, setMotivoRej] = useState("");
  const [fotosRej, setFotosRej] = useState([]);
  const [busyRej, setBusyRej] = useState(false);
  const [editandoAvance, setEditandoAvance] = useState(null); // id del avance en edición
  const [editandoActividad, setEditandoActividad] = useState(false); // modal editar actividad (admin)
  const [editTexto, setEditTexto] = useState("");
  const [editFotos, setEditFotos] = useState([]);
  const [editBusy, setEditBusy] = useState(false);

  const abrirEdicionAvance = (u) => {
    setEditandoAvance(u.id);
    setEditTexto(u.text || "");
    setEditFotos(u.photos || []);
  };
  const guardarEdicionAvance = async () => {
    await Api.updateAvance(editandoAvance, editTexto.trim(), editFotos);
    setEditandoAvance(null); reload();
  };
  const addEditFotos = async (files) => {
    setEditBusy(true);
    const arr = [];
    for (const f of Array.from(files).slice(0, 4)) { const r = await uploadPhoto(f); if (r.url) arr.push({ url: r.url, descripcion: "" }); }
    setEditFotos((p) => [...p, ...arr].slice(0, 6));
    setEditBusy(false);
  };

  const addPhotos = async (files) => {
    setBusy(true); setPhotoErr("");
    const arr = [];
    for (const f of Array.from(files).slice(0, 4)) {
      const r = await uploadPhoto(f);
      if (r.url) arr.push({ url: r.url, descripcion: "" });
      else if (r.error) setPhotoErr("No se pudo subir una foto: " + r.error);
    }
    setPhotos((p) => [...p, ...arr].slice(0, 6));
    setBusy(false);
  };

  const submitUpdate = async () => {
    if (!text.trim() && photos.length === 0 && pct === a.progress && !pideVB) return;
    if (pideVB && !motivoVB.trim()) { setPhotoErr("Escribe el motivo del visto bueno que solicitas."); return; }
    setSaving(true);
    const vb = pideVB ? { solicita: true, motivo: motivoVB.trim() } : null;
    await Api.addUpdate(a.id, profile.id, text.trim(), photos, pct, a, vb);
    const reached100 = pct >= 100 && a.progress < 100;
    if (admin) {
      if (vb) await Api.pushNotif(admin.id, `${profile.nombre} solicita tu visto bueno en "${a.title}" (avance ${pct}%)`, a.id, "approval");
      else if (reached100) await Api.pushNotif(admin.id, `"${a.title}" se completó al 100% (${profile.nombre})`, a.id, "done");
      else await Api.pushNotif(admin.id, `Avance en "${a.title}": ${pct}% (${profile.nombre})`, a.id, "progress");
    }
    setText(""); setPhotos([]); setPideVB(false); setMotivoVB(""); setPhotoErr(""); setSaving(false); reload();
  };

  const giveApproval = async () => {
    await Api.approve(a.id);
    await Api.pushNotif(a.assignedTo, `El administrador dio el visto bueno en "${a.title}". Puedes continuar.`, a.id, "done");
    reload();
  };
  const addFotosRej = async (files) => {
    setBusyRej(true);
    const arr = [];
    for (const f of Array.from(files).slice(0, 4)) { const r = await uploadPhoto(f); if (r.url) arr.push({ url: r.url, descripcion: "" }); }
    setFotosRej((p) => [...p, ...arr].slice(0, 6));
    setBusyRej(false);
  };
  const doReject = async () => {
    await Api.reject(a.id, motivoRej.trim(), fotosRej);
    await Api.pushNotif(a.assignedTo, `El administrador NO aprobó "${a.title}". Revisa la explicación.`, a.id, "approval");
    setShowReject(false); setMotivoRej(""); setFotosRej([]); reload();
  };

  return (
    <div>
      <div style={S.detailTopBar} className="detailtopbar">
        <button style={S.backBtn} onClick={onBack}><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Volver</button>
        {isAdmin && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button style={S.btnGhost} onClick={() => setEditandoActividad(true)}><Pencil size={14} /> Editar</button>
            <button style={S.btnDanger} onClick={async () => {
              if (confirm("¿Desea eliminar esta actividad? Esta acción no se puede deshacer.")) {
                await Api.delActivity(a.id); reload(); onBack();
              }
            }}><Trash2 size={14} /> Eliminar</button>
          </div>
        )}
      </div>
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
          <PhotoGallery photos={a.photos} /></div>
      )}

      {/* Aviso de rechazo (lo ve todo el mundo) */}
      {a.rejected && (
        <div style={{ ...S.approvalPanel, background: "rgba(220,80,80,.1)", borderColor: "rgba(220,80,80,.3)", flexDirection: "column", alignItems: "stretch" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f87171", fontWeight: 700 }}>
            <ThumbsDown size={18} /> Visto bueno NO aprobado
          </div>
          {a.motivoRechazo && <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>{a.motivoRechazo}</p>}
          {a.fotosRechazo?.length > 0 && (
            <PhotoGallery photos={a.fotosRechazo} />
          )}
        </div>
      )}

      {isAdmin && a.approvalRequested && (
        <div style={{ ...S.approvalPanel, flexDirection: "column", alignItems: "stretch", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ThumbsUp size={18} /> <span><b>{who?.nombre}</b> solicita tu visto bueno para continuar.</span>
          </div>
          {a.motivoAprobacion && (
            <div style={{ background: "var(--bg)", borderRadius: 10, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>Motivo de la solicitud:</span><br />{a.motivoAprobacion}
            </div>
          )}
          <div style={S.updateActions} className="actionrow">
            <button style={S.btnGhost} onClick={() => setShowReject(true)}><ThumbsDown size={15} /> Negar</button>
            <button style={S.btnPrimary} onClick={giveApproval}><Check size={16} /> Dar visto bueno</button>
          </div>
        </div>
      )}

      {!isAdmin && a.assignedTo === profile.id && (() => {
        const hoy = new Date().toISOString().slice(0, 10);
        const aunNoInicia = a.fechaProgramada && a.fechaProgramada > hoy;
        if (aunNoInicia) {
          return (
            <div style={S.panel}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#60a5fa" }}>
                <Clock size={18} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Esta actividad inicia el {fmtFecha(a.fechaProgramada)}.</span>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 8, marginBottom: 0 }}>
                Podrás reportar avances a partir de esa fecha.
              </p>
            </div>
          );
        }
        return (
        <div style={S.panel}>
          <h3 style={S.panelTitle}><Send size={14} /> Reportar avance</h3>
          <textarea style={S.textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Describe lo realizado, observaciones o pendientes…" />
          <PhotoUploader photos={photos} setPhotos={setPhotos} addPhotos={addPhotos} busy={busy} />
          {photoErr && <div style={S.errBox}><AlertCircle size={14} /> {photoErr}</div>}
          <label style={S.label}>Porcentaje de avance: <b style={{ color: "var(--accent)" }}>{pct}%</b></label>
          <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={S.range} />

          {/* Casilla: solicitar visto bueno dentro del avance */}
          <div style={S.vbBox}>
            <label style={S.vbCheck}>
              <input type="checkbox" checked={pideVB} onChange={(e) => setPideVB(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
              <span><ThumbsUp size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />Solicito visto bueno del administrador</span>
            </label>
            {pideVB && (
              <textarea style={{ ...S.textarea, marginTop: 10 }} rows={3} value={motivoVB} onChange={(e) => setMotivoVB(e.target.value)}
                placeholder="Explica qué necesitas que el administrador revise o autorice…" />
            )}
          </div>

          <button style={{ ...S.btnPrimary, marginTop: 14 }} onClick={submitUpdate} disabled={saving || busy}>
            {saving ? "Guardando…" : pideVB ? "Guardar avance y solicitar V°B°" : pct >= 100 ? "Marcar 100% y notificar" : "Guardar avance"}
          </button>
        </div>
        );
      })()}

      <div style={S.panel}>
        <h3 style={S.panelTitle}><ClipboardList size={14} /> Bitácora de avances</h3>
        {(!a.updates || a.updates.length === 0) && <Empty mini text="Aún no hay avances reportados." />}
        <div style={S.timeline}>
          {[...(a.updates || [])].reverse().map((u) => {
            const author = users.find((x) => x.id === u.by);
            const puedeEditar = u.by === profile.id; // el autor puede editar su avance
            const enEdicion = editandoAvance === u.id;
            return (
              <div key={u.id} style={S.timeItem}>
                <div style={S.timeDot} />
                <div style={S.timeBody}>
                  <div style={S.timeHead}>
                    <b>{author?.nombre || "—"}</b><span style={S.timePct}>{u.pct}%</span><span style={S.timeDate}>{fmtDate(u.ts)}</span>
                    {puedeEditar && !enEdicion && (
                      <button style={S.iconBtnXs} onClick={() => abrirEdicionAvance(u)} title="Editar redacción"><Pencil size={11} /> Editar</button>
                    )}
                  </div>
                  {enEdicion ? (
                    <div style={{ marginTop: 8 }}>
                      <textarea style={S.textarea} rows={3} value={editTexto} onChange={(e) => setEditTexto(e.target.value)} placeholder="Corrige la redacción…" />
                      <PhotoUploader photos={editFotos} setPhotos={setEditFotos} addPhotos={addEditFotos} busy={editBusy} />
                      <div style={S.updateActions} className="actionrow">
                        <button style={S.btnGhost} onClick={() => setEditandoAvance(null)}>Cancelar</button>
                        <button style={S.btnPrimary} onClick={guardarEdicionAvance} disabled={editBusy}>Guardar cambios</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {u.text && <p style={S.timeText}>{u.text}</p>}
                      {u.photos?.length > 0 && <PhotoGallery photos={u.photos} />}
                      {u.solicitaVB && (
                        <div style={S.vbTag}>
                          <ThumbsUp size={13} /> <b>Solicitó visto bueno</b>
                          {u.motivoVB && <span style={{ display: "block", marginTop: 4, fontWeight: 400, color: "var(--text)" }}>{u.motivoVB}</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Tiempo que tomó la actividad */}
      {a.progress >= 100 && a.completedAt && (
        <div style={S.panel}>
          <h3 style={S.panelTitle}><Timer size={14} /> Tiempo de ejecución</h3>
          <p style={S.descText}>{tiempoTranscurrido(a.startedAt || a.createdAt, a.completedAt)}</p>
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
            Inició: {fmtDate(a.startedAt || a.createdAt)} · Terminó: {fmtDate(a.completedAt)}
          </p>
        </div>
      )}

      {/* Modal: admin edita la actividad */}
      {editandoActividad && (
        <ActivityForm companies={companies} members={users.filter((u) => u.rol === "member")}
          initial={{ title: a.title, description: a.description, companyId: a.companyId, assignedTo: a.assignedTo, photos: a.photos }}
          onClose={() => setEditandoActividad(false)}
          onSave={async (data) => {
            const cambioAsignado = data.assignedTo !== a.assignedTo;
            await Api.updateActivity(a.id, data);
            if (cambioAsignado) await Api.pushNotif(data.assignedTo, `Se te asignó la actividad: "${data.title}"`, a.id, "assign");
            setEditandoActividad(false); reload();
          }} />
      )}

      {/* Modal: admin niega el V°B° con explicación y fotos */}
      {showReject && (
        <Modal title="Negar visto bueno" onClose={() => setShowReject(false)}>
          <label style={S.label}>Explica por qué no se aprueba</label>
          <textarea style={S.textarea} rows={4} value={motivoRej} onChange={(e) => setMotivoRej(e.target.value)}
            placeholder="Indica qué debe corregirse o por qué no procede…" />
          <label style={S.label}>Fotos (opcional)</label>
          <PhotoUploader photos={fotosRej} setPhotos={setFotosRej} addPhotos={addFotosRej} busy={busyRej} />
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setShowReject(false)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={doReject} disabled={!motivoRej.trim() || busyRej}>Enviar y negar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Calcula y formatea el tiempo entre dos fechas
function tiempoTranscurrido(inicio, fin) {
  const ms = new Date(fin) - new Date(inicio);
  if (ms < 0 || isNaN(ms)) return "—";
  const min = Math.floor(ms / 60000);
  const dias = Math.floor(min / 1440);
  const horas = Math.floor((min % 1440) / 60);
  const mins = min % 60;
  const partes = [];
  if (dias) partes.push(`${dias} día${dias > 1 ? "s" : ""}`);
  if (horas) partes.push(`${horas} hora${horas > 1 ? "s" : ""}`);
  if (mins && !dias) partes.push(`${mins} minuto${mins > 1 ? "s" : ""}`);
  return partes.length ? partes.join(" y ") : "Menos de un minuto";
}

// ============ HISTORIAL DE ACTIVIDADES (por usuario o empresa) ============
function HistorialActividades({ titulo, subtitulo, acts, companies, users, onOpenActivity, onBack }) {
  const [filtro, setFiltro] = useState("all");

  const porIniciar = acts.filter((a) => a.progress === 0);
  const enProceso = acts.filter((a) => a.progress > 0 && a.progress < 100);
  const terminadas = acts.filter((a) => a.progress >= 100);

  const visibles = filtro === "pending" ? porIniciar
    : filtro === "progress" ? enProceso
    : filtro === "done" ? terminadas
    : acts;

  const chips = [
    { id: "all", label: `Todas (${acts.length})` },
    { id: "pending", label: `Por iniciar (${porIniciar.length})` },
    { id: "progress", label: `En proceso (${enProceso.length})` },
    { id: "done", label: `Terminadas (${terminadas.length})` },
  ];

  return (
    <div>
      <button style={S.backBtn} onClick={onBack}><ChevronRight size={16} style={{ transform: "rotate(180deg)" }} /> Volver</button>
      <PageHead title={titulo} sub={subtitulo} />
      <div style={S.chipRow}>
        {chips.map((c) => (
          <button key={c.id} style={filtro === c.id ? S.chipActive : S.chip} onClick={() => setFiltro(c.id)}>{c.label}</button>
        ))}
      </div>
      <div style={S.cardGrid} className="cardgrid">
        {visibles.length === 0 && <Empty text="No hay actividades en este estado." />}
        {visibles.map((a) => <ActivityCard key={a.id} a={a} companies={companies} users={users} onClick={() => onOpenActivity(a.id)} />)}
      </div>
    </div>
  );
}

function Companies({ companies, activities, reload, users, onOpenActivity }) {
  const [editing, setEditing] = useState(null); // null | 'new' | company object
  const [name, setName] = useState(""); const [contact, setContact] = useState(""); const [address, setAddress] = useState("");
  const [verHistorial, setVerHistorial] = useState(null); // empresa cuyo historial se ve

  if (verHistorial) {
    const acts = activities.filter((a) => a.companyId === verHistorial.id);
    return <HistorialActividades titulo={verHistorial.nombre} subtitulo="Historial de actividades de la empresa"
      acts={acts} companies={companies} users={users} onOpenActivity={onOpenActivity} onBack={() => setVerHistorial(null)} />;
  }

  const openNew = () => { setName(""); setContact(""); setAddress(""); setEditing("new"); };
  const openEdit = (c) => { setName(c.nombre || ""); setContact(c.contacto || ""); setAddress(c.direccion || ""); setEditing(c); };

  const save = async () => {
    if (!name.trim()) return;
    const payload = { nombre: name.trim(), contacto: contact.trim(), direccion: address.trim() };
    if (editing === "new") await Api.addCompany(payload);
    else await Api.updateCompany(editing.id, payload);
    setEditing(null); reload();
  };

  // Ordenar por número de actividades (la de más carga primero)
  const ordered = [...companies]
    .map((c) => ({ ...c, count: activities.filter((a) => a.companyId === c.id).length }))
    .sort((a, b) => b.count - a.count);

  return (
    <div>
      <PageHead title="Catálogo de empresas" sub="Ordenadas por carga de actividades"
        action={<button style={S.btnPrimary} onClick={openNew}><Plus size={16} /> Agregar empresa</button>} />
      <div style={S.cardGrid} className="cardgrid">
        {companies.length === 0 && <Empty text="Sin empresas registradas." />}
        {ordered.map((c) => (
          <div key={c.id} style={S.entityCard}>
            <div style={S.entityIcon}><Building2 size={20} /></div>
            <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setVerHistorial(c)}>
              <h4 style={S.entityName}>{c.nombre}</h4>
              {c.contacto && <div style={S.entityMeta}>{c.contacto}</div>}
              {c.direccion && <div style={S.entityMeta}>{c.direccion}</div>}
              <div style={S.entityTag}>{c.count} actividad(es) · ver historial</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button style={S.iconBtnSm} onClick={() => openEdit(c)} title="Editar"><Pencil size={14} /></button>
              <button style={S.iconBtnSm} onClick={async () => { if (confirm(`¿Eliminar "${c.nombre}"?`)) { await Api.delCompany(c.id); reload(); } }} title="Eliminar"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <Modal title={editing === "new" ? "Agregar empresa" : "Editar empresa"} onClose={() => setEditing(null)}>
          <label style={S.label}>Nombre</label>
          <input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Comercializadora del Pacífico" />
          <label style={S.label}>Contacto (opcional)</label>
          <input style={S.input} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Nombre / teléfono" />
          <label style={S.label}>Dirección (opcional)</label>
          <input style={S.input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, ciudad" />
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setEditing(null)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={save} disabled={!name.trim()}>{editing === "new" ? "Guardar" : "Guardar cambios"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============ FRASES MOTIVADORAS ============
function Frases() {
  const [lista, setLista] = useState([]);
  const [nueva, setNueva] = useState("");
  const [busy, setBusy] = useState(false);

  const cargar = async () => setLista(await Api.getFrases());
  useEffect(() => { cargar(); }, []);

  const agregar = async () => {
    if (!nueva.trim()) return;
    setBusy(true);
    await Api.addFrase(nueva.trim());
    setNueva(""); await cargar(); setBusy(false);
  };
  const borrar = async (id) => { await Api.delFrase(id); cargar(); };

  return (
    <div>
      <PageHead title="Frases motivadoras" sub="Se muestra una al azar cada vez que alguien abre la app" />
      <div style={S.panel}>
        <label style={S.label}>Nueva frase</label>
        <div style={{ display: "flex", gap: 10 }} className="formrow">
          <input style={S.input} value={nueva} onChange={(e) => setNueva(e.target.value)}
            placeholder="Escribe una frase que motive al equipo…" onKeyDown={(e) => e.key === "Enter" && agregar()} />
          <button style={{ ...S.btnPrimary, width: "auto", whiteSpace: "nowrap" }} onClick={agregar} disabled={busy || !nueva.trim()}>
            <Plus size={16} /> Agregar
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        {lista.length === 0 && <Empty text="Aún no hay frases. Agrega la primera arriba." />}
        {lista.map((f) => (
          <div key={f.id} style={S.fraseRow}>
            <Quote size={16} color="var(--accent)" style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ flex: 1, fontSize: 14, lineHeight: 1.5, margin: 0 }}>{f.texto}</p>
            <button style={S.iconBtnSm} onClick={() => borrar(f.id)} title="Eliminar"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ EQUIPO ============
function Team({ users, activities, reload, companies, onOpenActivity }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [editUser, setEditUser] = useState(null); // integrante a editar
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPass, setEditPass] = useState("");
  const [editErr, setEditErr] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const promoverAdmin = async () => {
    if (!confirm(`Está a punto de darle privilegio de administrador a: "${editUser.nombre}", ¿puede confirmar esta asignación?`)) return;
    setEditBusy(true);
    await Api.updateUser(editUser.id, { rol: "admin" });
    setEditBusy(false); setEditUser(null); reload();
  };

  const guardarEdicion = async () => {
    setEditErr("");
    if (!editName.trim()) { setEditErr("El nombre no puede quedar vacío."); return; }
    if (editEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editEmail.trim())) { setEditErr("El correo no tiene un formato válido."); return; }
    if (editPass.trim() && editPass.trim().length < 6) { setEditErr("La contraseña debe tener al menos 6 caracteres."); return; }
    setEditBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("crear-integrante", {
        body: { accion: "actualizar", id: editUser.id, nombre: editName.trim(), email: editEmail.trim(), password: editPass.trim() },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error || data?.error) { setEditErr(data?.error || "No se pudo actualizar."); setEditBusy(false); return; }
      setEditUser(null); setEditEmail(""); setEditPass(""); reload();
    } catch (e) {
      setEditErr("Error de conexión con el servidor.");
    }
    setEditBusy(false);
  };
  const [verHistorial, setVerHistorial] = useState(null); // integrante cuyo historial se ve

  const members = users.filter((u) => u.rol === "member");

  if (verHistorial) {
    const acts = activities.filter((a) => a.assignedTo === verHistorial.id);
    return <HistorialActividades titulo={verHistorial.nombre} subtitulo="Historial de actividades del integrante"
      acts={acts} companies={companies} users={users} onOpenActivity={onOpenActivity} onBack={() => setVerHistorial(null)} />;
  }

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
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setVerHistorial(m)}>
                <h4 style={S.entityName}>{m.nombre}</h4>
                <div style={S.entityTag}>{assigned.length} asignadas · {doneN} completadas · ver historial</div>
              </div>
              <button style={S.iconBtnSm} onClick={() => { setEditUser(m); setEditName(m.nombre); setEditEmail(""); setEditPass(""); setEditErr(""); }} title="Editar integrante"><Pencil size={14} /></button>
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
          <PasswordInput value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Mínimo 6 caracteres" />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>Comparte el correo y esta contraseña con el integrante. Podrá cambiarla después.</p>
          {err && <div style={S.errBox}><AlertCircle size={14} /> {err}</div>}
          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setAdding(false)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={save}
              disabled={busy || !name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || pass.trim().length < 6}>
              {busy ? "Creando…" : "Crear integrante"}
            </button>
          </div>
        </Modal>
      )}
      {editUser && (
        <Modal title="Editar integrante" onClose={() => setEditUser(null)}>
          <label style={S.label}>Nombre completo</label>
          <input style={S.input} value={editName} onChange={(e) => setEditName(e.target.value)} />
          <label style={S.label}>Correo de acceso</label>
          <input style={S.input} value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="juan@correo.com" />
          <label style={S.label}>Nueva contraseña</label>
          <PasswordInput value={editPass} onChange={(e) => setEditPass(e.target.value)} placeholder="Déjala vacía para no cambiarla" />
          <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            Escribe el correo para asignárselo o corregirlo. La contraseña solo cambia si escribes una nueva (mínimo 6 caracteres); si la dejas vacía, se conserva la actual.
          </p>
          {editErr && <div style={S.errBox}><AlertCircle size={14} /> {editErr}</div>}

          <div style={{ borderTop: "1px solid var(--line)", margin: "16px 0 12px" }} />
          <label style={S.label}>Rol</label>
          {editUser.rol === "admin" ? (
            <div style={{ ...S.okBox, marginTop: 4 }}><Shield size={14} /> Esta persona ya es administrador.</div>
          ) : (
            <button style={{ ...S.btnGhost, width: "100%", justifyContent: "center", borderColor: "var(--accent)", color: "var(--accent)" }}
              onClick={promoverAdmin} disabled={editBusy}>
              <Shield size={14} /> Convertir en administrador
            </button>
          )}

          <div style={S.modalActions}>
            <button style={S.btnGhost} onClick={() => setEditUser(null)}>Cancelar</button>
            <button style={S.btnPrimary} onClick={guardarEdicion} disabled={editBusy || !editName.trim()}>
              {editBusy ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
// ============ DETALLES / HALLAZGOS ============
// Colaborador: reportar un detalle detectado en un recorrido
function ReportarDetalle({ companies, profile, reload }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id || "");
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fotos, setFotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [okMsg, setOkMsg] = useState("");
  const [mios, setMios] = useState([]);

  const cargarMios = async () => {
    const todos = await Api.getDetalles();
    setMios(todos.filter((d) => d.reportado_por === profile.id));
  };
  useEffect(() => { cargarMios(); }, []);

  const addFotos = async (files) => {
    setBusy(true);
    const arr = [];
    for (const f of Array.from(files).slice(0, 4)) { const r = await uploadPhoto(f); if (r.url) arr.push({ url: r.url, descripcion: "" }); }
    setFotos((p) => [...p, ...arr].slice(0, 6));
    setBusy(false);
  };

  const enviar = async () => {
    if (!titulo.trim() || !companyId) return;
    setSaving(true);
    await Api.addDetalle({ companyId, reportadoPor: profile.id, titulo: titulo.trim(), descripcion: descripcion.trim(), fotos });
    // Avisar a todos los administradores
    const { data: admins } = await supabase.from("perfiles").select("id").eq("rol", "admin");
    const emp = companies.find((c) => c.id === companyId)?.nombre || "";
    for (const ad of (admins || [])) {
      await Api.pushNotif(ad.id, `Nuevo detalle reportado en ${emp}: "${titulo.trim()}" (${profile.nombre})`, null, "info");
    }
    setTitulo(""); setDescripcion(""); setFotos([]); setSaving(false);
    setOkMsg("¡Detalle enviado! El administrador lo revisará.");
    cargarMios();
    setTimeout(() => setOkMsg(""), 4000);
  };

  const estadoTag = (e) => e === "convertido" ? { t: "Convertido en actividad", c: "var(--green)" }
    : e === "descartado" ? { t: "Descartado", c: "var(--muted)" }
    : { t: "Pendiente de revisión", c: "var(--amber)" };

  return (
    <div>
      <PageHead title="Reportar un detalle" sub="¿Detectaste algo en un recorrido? Repórtalo aquí." />
      <div style={S.panel}>
        <label style={S.label}>Empresa donde lo detectaste</label>
        <select style={S.select} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <label style={S.label}>¿Qué detectaste?</label>
        <input style={S.input} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Foco fundido en pasillo, pasamanos suelto…" />
        <label style={S.label}>Detalles (opcional)</label>
        <textarea style={S.textarea} rows={3} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ubicación exacta, gravedad, cualquier observación…" />
        <label style={S.label}>Fotos</label>
        <PhotoUploader photos={fotos} setPhotos={setFotos} addPhotos={addFotos} busy={busy} />
        <button style={{ ...S.btnPrimary, marginTop: 14 }} onClick={enviar} disabled={!titulo.trim() || !companyId || saving || busy}>
          {saving ? "Enviando…" : "Enviar detalle al administrador"}
        </button>
        {okMsg && <div style={{ ...S.okBox, marginTop: 12 }}><Check size={14} /> {okMsg}</div>}
      </div>

      {mios.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ ...S.panelTitle, marginBottom: 12 }}>Detalles que has reportado</h3>
          {mios.map((d) => {
            const et = estadoTag(d.estado);
            return (
              <div key={d.id} style={S.detalleRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.detalleTitulo}>{d.titulo}</div>
                  <div style={S.detalleMeta}>{companies.find((c) => c.id === d.empresa_id)?.nombre || "—"} · {fmtDate(d.creado)}</div>
                </div>
                <span style={{ ...S.pill, color: et.c, borderColor: et.c, whiteSpace: "nowrap" }}>{et.t}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Admin: revisar detalles y convertirlos en actividad
function DetallesAdmin({ companies, users, profile, reload, onConvertido }) {
  const [detalles, setDetalles] = useState([]);
  const [convirtiendo, setConvirtiendo] = useState(null); // detalle a convertir
  const [filtro, setFiltro] = useState("pendiente");

  const cargar = async () => setDetalles(await Api.getDetalles());
  useEffect(() => { cargar(); }, []);

  const visibles = detalles.filter((d) => filtro === "todos" ? true : d.estado === filtro);
  const chips = [
    { id: "pendiente", label: `Pendientes (${detalles.filter((d) => d.estado === "pendiente").length})` },
    { id: "convertido", label: `Convertidos (${detalles.filter((d) => d.estado === "convertido").length})` },
    { id: "descartado", label: `Descartados (${detalles.filter((d) => d.estado === "descartado").length})` },
    { id: "todos", label: "Todos" },
  ];

  return (
    <div>
      <PageHead title="Detalles reportados" sub="Hallazgos del equipo en recorridos" />
      <div style={S.chipRow}>
        {chips.map((c) => <button key={c.id} style={filtro === c.id ? S.chipActive : S.chip} onClick={() => setFiltro(c.id)}>{c.label}</button>)}
      </div>
      <div style={S.cardGrid} className="cardgrid">
        {visibles.length === 0 && <Empty text="No hay detalles en este estado." />}
        {visibles.map((d) => {
          const emp = companies.find((c) => c.id === d.empresa_id);
          const quien = users.find((u) => u.id === d.reportado_por);
          return (
            <div key={d.id} style={S.actCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={S.detalleMeta}><Building2 size={12} /> {emp?.nombre || "—"}</span>
                {d.estado === "convertido" && <span style={S.okTag}><Check size={11} /> Convertido</span>}
                {d.estado === "descartado" && <span style={{ ...S.pill, color: "var(--muted)", borderColor: "var(--muted)" }}>Descartado</span>}
              </div>
              <h4 style={S.actCardTitle}>{d.titulo}</h4>
              {d.descripcion && <p style={S.actCardDesc}>{d.descripcion}</p>}
              <div style={S.detalleMeta}><User size={12} /> {quien?.nombre || "—"} · {fmtDate(d.creado)}</div>
              {d.fotos?.length > 0 && <PhotoGallery photos={d.fotos} />}
              {d.estado === "pendiente" && (
                <div style={{ ...S.updateActions, marginTop: 12 }} className="actionrow">
                  <button style={S.btnGhost} onClick={async () => { if (confirm("¿Descartar este detalle?")) { await Api.descartarDetalle(d.id); cargar(); } }}>Descartar</button>
                  <button style={S.btnPrimary} onClick={() => setConvirtiendo(d)}><Plus size={15} /> Convertir en actividad</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {convirtiendo && (
        <ActivityForm companies={companies} members={users.filter((u) => u.rol === "member")}
          initial={{ title: convirtiendo.titulo, description: convirtiendo.descripcion, companyId: convirtiendo.empresa_id, assignedTo: "", photos: convirtiendo.fotos }}
          onClose={() => setConvirtiendo(null)}
          onSave={async (dataForm) => {
            const row = await Api.createActivity(dataForm, profile.id);
            if (row) {
              await Api.detalleAActividad(convirtiendo, row.id);
              await Api.pushNotif(dataForm.assignedTo, `Nueva actividad asignada: "${dataForm.title}"`, row.id, "assign");
            }
            setConvirtiendo(null); cargar(); reload();
          }} />
      )}
    </div>
  );
}

function MemberApp({ profile }) {
  const data = useData(profile);
  const [openActId, setOpenActId] = useState(null);
  const [vista, setVista] = useState("actividades"); // actividades | detalle
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
  const navItems = [
    { id: "actividades", label: "Mis actividades", icon: ClipboardList },
    { id: "detalle", label: "Reportar detalle", icon: AlertCircle },
  ];
  return (
    <>
      <TopBar {...shared} onOpenActivity={setOpenActId} />
      <div style={S.body} className="appbody">
        <main style={{ ...S.main, marginLeft: 0, paddingBottom: 90 }} className="main">
          {vista === "actividades" && (
            <>
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
            </>
          )}
          {vista === "detalle" && <ReportarDetalle companies={data.companies} profile={profile} reload={data.reload} />}
          <Footer />
        </main>
      </div>
      {/* Barra de navegación inferior */}
      <nav style={S.bottomNav}>
        {navItems.map((n) => (
          <button key={n.id} style={vista === n.id ? S.bottomNavItemActive : S.bottomNavItem} onClick={() => setVista(n.id)}>
            <n.icon size={20} />
            <span style={S.bottomNavLabel}>{n.label}</span>
          </button>
        ))}
      </nav>
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
  return <div style={S.barRow}><div style={S.barLabel} className="barlabel">{label}</div><div style={S.barTrack}><div style={{ ...S.barFill, width: w + "%", background: color }} /></div><div style={S.barVal}>{pct ? value + "%" : value}</div></div>;
}
// Campo de contraseña con botón para mostrar/ocultar (ojito)
function PasswordInput({ value, onChange, placeholder, onKeyDown }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        style={{ ...S.input, paddingRight: 44 }}
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        style={S.eyeBtn}
        title={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return <div style={S.overlay} className="overlaymodal" onClick={onClose}><div style={S.modal} onClick={(e) => e.stopPropagation()}><div style={S.modalHead}><h3 style={S.modalTitle}>{title}</h3><button style={S.iconBtnSm} onClick={onClose}><X size={18} /></button></div><div style={S.modalBody}>{children}</div></div></div>;
}
function Empty({ text, mini }) {
  return <div style={{ ...S.empty, padding: mini ? "20px" : "48px 24px" }}><ClipboardList size={mini ? 20 : 32} color="var(--muted)" /><p style={{ margin: "8px 0 0", color: "var(--muted)", fontSize: 13 }}>{text}</p></div>;
}

function Footer() {
  return (
    <div style={S.footer}>
      <img src="/logo-op.png" alt="iTask" style={S.footerLogo} />
      <div style={S.footerText}>All rights reserved · Aldox Networks © 2026</div>
    </div>
  );
}

// Galería de fotos con descripción debajo de cada una (tocar abre el visor)
function PhotoGallery({ photos }) {
  if (!photos || photos.length === 0) return null;
  return (
    <div style={S.galleryGrid}>
      {photos.map((p, i) => (
        <div key={i} style={S.galleryItem}>
          <img src={photoUrl(p)} style={{ ...S.thumbLg, cursor: "pointer" }} alt="" onClick={() => openLightbox(photos, i)} />
          {photoDesc(p) && <div style={S.galleryDesc}>{photoDesc(p)}</div>}
        </div>
      ))}
    </div>
  );
}

// Abrir el visor de fotos: dispara un evento que el Lightbox escucha
function openLightbox(photos, index = 0) {
  window.dispatchEvent(new CustomEvent("abrir-fotos", { detail: { photos, index } }));
}

// Visor de fotos a pantalla completa con navegación
function Lightbox() {
  const [photos, setPhotos] = useState(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const open = (e) => { setPhotos(e.detail.photos); setIdx(e.detail.index || 0); };
    window.addEventListener("abrir-fotos", open);
    return () => window.removeEventListener("abrir-fotos", open);
  }, []);

  useEffect(() => {
    if (!photos) return;
    const onKey = (e) => {
      if (e.key === "Escape") setPhotos(null);
      if (e.key === "ArrowRight") setIdx((i) => (i + 1) % photos.length);
      if (e.key === "ArrowLeft") setIdx((i) => (i - 1 + photos.length) % photos.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [photos]);

  if (!photos || photos.length === 0) return null;
  const many = photos.length > 1;
  const prev = (e) => { e.stopPropagation(); setIdx((i) => (i - 1 + photos.length) % photos.length); };
  const next = (e) => { e.stopPropagation(); setIdx((i) => (i + 1) % photos.length); };

  return (
    <div style={S.lbOverlay} onClick={() => setPhotos(null)}>
      <button style={S.lbClose} onClick={() => setPhotos(null)}><X size={24} /></button>
      {many && <button style={{ ...S.lbNav, left: 12 }} onClick={prev}><ChevronRight size={28} style={{ transform: "rotate(180deg)" }} /></button>}
      <img src={photoUrl(photos[idx])} style={S.lbImage} alt="" onClick={(e) => e.stopPropagation()} />
      {many && <button style={{ ...S.lbNav, right: 12 }} onClick={next}><ChevronRight size={28} /></button>}
      {photoDesc(photos[idx]) && <div style={S.lbDesc} onClick={(e) => e.stopPropagation()}>{photoDesc(photos[idx])}</div>}
      {many && <div style={S.lbCounter}>{idx + 1} / {photos.length}</div>}
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
  eyeBtn: { position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 30, height: 30, borderRadius: 7, background: "transparent", border: "none", color: "var(--muted)", display: "grid", placeItems: "center", cursor: "pointer" },
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
  iconBtnXs: { display: "inline-flex", alignItems: "center", gap: 4, height: 26, padding: "0 8px", borderRadius: 6, background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.3)", color: "var(--accent)", cursor: "pointer", marginLeft: "auto", fontSize: 11, fontWeight: 600, fontFamily: "var(--body)" },
  btnDanger: { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 10, background: "rgba(220,80,80,.12)", border: "1px solid rgba(220,80,80,.35)", color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--body)" },
  detailTopBar: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 4, flexWrap: "wrap" },
  badge: { position: "absolute", top: -5, right: -5, minWidth: 19, height: 19, padding: "0 5px", borderRadius: 10, background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", border: "2px solid var(--surface)", boxSizing: "content-box" },
  notifPanel: { position: "absolute", top: 48, right: 0, width: 320, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "0 12px 40px rgba(0,0,0,.5)", zIndex: 100, overflow: "hidden" },
  notifHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--line)", fontSize: 13, fontWeight: 700 },
  notifEmpty: { padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13 },
  pushActivar: { padding: "12px 14px", borderTop: "1px solid var(--line)", textAlign: "center" },
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
  recurTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#60a5fa", background: "rgba(96,165,250,.12)", padding: "3px 9px", borderRadius: 20 },
  fechaProg: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#60a5fa", marginTop: 10, background: "rgba(96,165,250,.12)", border: "1px solid rgba(96,165,250,.3)", padding: "7px 12px", borderRadius: 10, alignSelf: "flex-start" },
  fechaVencida: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#f87171", marginTop: 8, background: "rgba(220,80,80,.1)", padding: "5px 10px", borderRadius: 8, alignSelf: "flex-start" },
  okTag: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "var(--green)", background: "rgba(34,197,94,.12)", padding: "3px 9px", borderRadius: 20 },
  okBox: { display: "flex", alignItems: "center", gap: 8, background: "rgba(34,197,94,.1)", border: "1px solid rgba(34,197,94,.3)", color: "var(--green)", padding: "10px 14px", borderRadius: 10, fontSize: 13 },
  bottomNav: { position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", background: "var(--surface)", borderTop: "1px solid var(--line)", zIndex: 200, paddingBottom: "env(safe-area-inset-bottom)", boxShadow: "0 -2px 12px rgba(0,0,0,.35)" },
  bottomNavItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 0", background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontFamily: "var(--body)" },
  bottomNavItemActive: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "10px 0", background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--body)" },
  bottomNavLabel: { fontSize: 11, fontWeight: 600 },
  detalleRow: { display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", marginBottom: 10 },
  detalleTitulo: { fontSize: 14, fontWeight: 600, color: "var(--text)" },
  detalleMeta: { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--muted)", marginTop: 2 },
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
  fraseOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", display: "grid", placeItems: "center", padding: 24, zIndex: 300 },
  fraseCard: { width: "100%", maxWidth: 420, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 32, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 },
  fraseText: { fontSize: 19, lineHeight: 1.5, fontWeight: 600, color: "var(--text)", margin: 0, fontFamily: "var(--body)" },
  fraseRow: { display: "flex", alignItems: "flex-start", gap: 12, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: "14px 16px", marginBottom: 10 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  chip: { background: "var(--surface)", border: "1px solid var(--line)", color: "var(--muted)", borderRadius: 20, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "var(--body)" },
  chipActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "#1a1a1a", borderRadius: 20, padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--body)" },
  vbBox: { marginTop: 14, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 12, padding: 14 },
  vbCheck: { display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", color: "var(--text)" },
  vbTag: { marginTop: 10, background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.3)", color: "var(--amber)", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, lineHeight: 1.5 },
  photoItem: { display: "flex", gap: 12, alignItems: "center" },
  galleryGrid: { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 },
  galleryItem: { width: 88, display: "flex", flexDirection: "column", gap: 4 },
  galleryDesc: { fontSize: 11, color: "var(--muted)", lineHeight: 1.35, wordBreak: "break-word" },
  lbDesc: { position: "absolute", bottom: 64, left: "50%", transform: "translateX(-50%)", maxWidth: "85%", color: "#fff", fontSize: 14, lineHeight: 1.4, textAlign: "center", background: "rgba(0,0,0,.6)", padding: "10px 16px", borderRadius: 10 },
  lbOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", display: "grid", placeItems: "center", padding: 20, zIndex: 400 },
  lbImage: { maxWidth: "100%", maxHeight: "85vh", objectFit: "contain", borderRadius: 8 },
  lbClose: { position: "absolute", top: 16, right: 16, width: 44, height: 44, borderRadius: 22, background: "rgba(255,255,255,.12)", border: "none", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", zIndex: 401 },
  lbNav: { position: "absolute", top: "50%", transform: "translateY(-50%)", width: 48, height: 48, borderRadius: 24, background: "rgba(255,255,255,.12)", border: "none", color: "#fff", display: "grid", placeItems: "center", cursor: "pointer", zIndex: 401 },
  lbCounter: { position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)", color: "#fff", fontSize: 14, fontWeight: 600, background: "rgba(0,0,0,.5)", padding: "6px 14px", borderRadius: 20 },
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
    position:fixed !important; bottom:0 !important; left:0 !important; right:0 !important; top:auto !important;
    width:100% !important; min-height:0 !important;
    display:flex !important; flex-direction:row !important;
    justify-content:space-around; align-items:center;
    padding:6px 4px !important; gap:2px;
    border-right:none !important; border-top:1px solid var(--line);
    z-index:200 !important; box-sizing:border-box;
    background:var(--surface) !important;
    padding-bottom:calc(6px + env(safe-area-inset-bottom)) !important;
    box-shadow:0 -2px 12px rgba(0,0,0,.35);
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
  .detailtopbar{ gap:10px !important; }
  .detailtopbar > div{ width:100%; }
  .detailtopbar > div > button{ flex:1; justify-content:center; }
  .topbar{ padding:0 14px !important; }
  /* Evitar desbordes: rejillas a una columna en móvil */
  .cardgrid{ grid-template-columns:1fr !important; }
  .kpigrid{ grid-template-columns:1fr 1fr !important; }
  /* Botones de acción y filas de formulario se apilan */
  .actionrow{ flex-direction:column !important; }
  .formrow{ flex-direction:column !important; gap:0 !important; }
  /* Paneles y su contenido nunca exceden el ancho */
  .main > div, .twocol > div{ max-width:100% !important; }
  .barlabel{ width:auto !important; flex:1 1 40% !important; min-width:0 !important; }
  select, input, textarea{ max-width:100% !important; }
  /* Tarjetas KPI con texto que no rebase */
  .kpigrid > div{ min-width:0 !important; overflow:hidden; }
  /* Modal ocupa casi todo el ancho en móvil */
  .overlaymodal{ padding:10px !important; }
}
*, *::before, *::after { box-sizing: border-box; }
* { min-width: 0; }
img, video, canvas { max-width: 100%; height: auto; }
h1, h2, h3, h4, p, span, div { overflow-wrap: anywhere; word-break: break-word; }`;
