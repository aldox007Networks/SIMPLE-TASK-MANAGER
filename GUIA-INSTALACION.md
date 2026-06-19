# 📲 Guía para publicar tu app — Centro de Operaciones

Esta guía no requiere instalar nada en tu computadora ni usar la terminal.
Trabajarás todo desde el navegador. Calcula **30–40 minutos** la primera vez.

Vas a usar tres servicios, los tres con plan **gratis**:

1. **Supabase** — la base de datos en la nube (donde se guardan actividades, usuarios y fotos).
2. **GitHub** — donde vive el código de la app.
3. **Vercel** — publica la app en internet con una dirección que puedes abrir en cualquier celular.

---

## PARTE 1 — Crear la base de datos en Supabase

### Paso 1. Crea tu cuenta y proyecto
1. Entra a **https://supabase.com** y haz clic en **Start your project**. Inicia sesión con tu correo o con GitHub.
2. Haz clic en **New project**.
3. Llena:
   - **Name:** `centro-operaciones`
   - **Database Password:** inventa una y **anótala** (la necesitarás solo si tienes problemas).
   - **Region:** elige la más cercana (ej. *East US* o *West US* desde México).
4. Clic en **Create new project**. Espera ~1 minuto a que diga que está listo.

### Paso 2. Crea las tablas (pegar y ejecutar)
1. En el menú izquierdo, abre **SQL Editor**.
2. Clic en **New snippet** (o el `+`).
3. Abre el archivo **`esquema-supabase.sql`** que viene en este paquete, copia **todo** su contenido y pégalo en el editor.
4. Clic en **Run** (abajo a la derecha). Debe decir *Success*. Listo: ya tienes todas las tablas.

### Paso 3. Permitir entrar sin confirmar correo (más simple para tu equipo)
1. Menú izquierdo → **Authentication** → **Sign In / Providers** (o **Providers**).
2. En **Email**, busca la opción **Confirm email** y **desactívala**. Guarda.
   - Esto permite que tú y tu equipo entren de inmediato al crear su cuenta, sin revisar correo.

### Paso 4. Crear el almacén de fotos
1. Menú izquierdo → **Storage**.
2. Clic en **New bucket**.
3. Nombre exacto: **`fotos`** (en minúsculas).
4. Activa la opción **Public bucket** (para que las fotos se vean en la app). Clic en **Save**.

### Paso 5. Copiar tus dos llaves
1. Menú izquierdo → **Project Settings** (engranaje) → **API Keys** (o **Data API**).
2. Copia y guarda en un bloc de notas estos dos datos:
   - **Project URL** — algo como `https://abcd1234.supabase.co`
   - **Publishable key** — empieza con `sb_publishable_...`
     *(Si no ves una, haz clic en "Create new API keys" y copia la "Publishable key".)*

> Guarda estos dos datos a la mano. Los pegarás en el Paso 8.

---

## PARTE 2 — Subir el código a GitHub

### Paso 6. Crea el repositorio
1. Entra a **https://github.com** y crea una cuenta (o inicia sesión).
2. Arriba a la derecha, clic en **+** → **New repository**.
3. **Repository name:** `centro-operaciones`
4. Déjalo en **Public** o **Private** (cualquiera sirve). Clic en **Create repository**.

### Paso 7. Sube los archivos del proyecto
1. En la página del repositorio recién creado, haz clic en el enlace **uploading an existing file** (aparece en el texto de bienvenida).
2. Abre la carpeta **`proyecto`** de este paquete en tu computadora.
3. **Arrastra TODO el contenido** de la carpeta `proyecto` (los archivos y las carpetas `src` y `public`) a la ventana de GitHub.
   - Importante: arrastra lo que está *dentro* de `proyecto`, no la carpeta `proyecto` misma.
4. Abajo, clic en **Commit changes**.

### Paso 8. Pega tus llaves de Supabase
1. En GitHub, entra a la carpeta **`src`** y haz clic en el archivo **`supabase.js`**.
2. Clic en el ícono del **lápiz** (Edit this file), arriba a la derecha.
3. Reemplaza los dos textos entre comillas:
   - `PEGA_AQUI_TU_PROJECT_URL` → tu Project URL del Paso 5.
   - `PEGA_AQUI_TU_PUBLISHABLE_KEY` → tu Publishable key del Paso 5.
4. Clic en **Commit changes**.

---

## PARTE 3 — Publicar en internet con Vercel

### Paso 9. Conecta Vercel con GitHub
1. Entra a **https://vercel.com** y haz clic en **Sign Up** → elige **Continue with GitHub**.
2. Una vez dentro, clic en **Add New…** → **Project**.
3. Busca tu repositorio **`centro-operaciones`** y clic en **Import**.
4. Vercel detecta solo que es un proyecto Vite. No cambies nada.
5. Clic en **Deploy**. Espera ~1 minuto.

### Paso 10. ¡Tu app ya está en línea!
- Vercel te dará una dirección como **`https://centro-operaciones.vercel.app`**.
- Ábrela. Verás la pantalla de inicio de sesión.

---

## PARTE 4 — Primer uso e instalación en celulares

### Paso 11. Crea la cuenta de administrador (tú)
1. Abre la dirección de Vercel.
2. Clic en **"Crea la cuenta de administrador"**.
3. Pon tu nombre, correo y una contraseña. Clic en **Crear cuenta**.
   - 👉 La **primera** cuenta que se registra queda como **administrador** automáticamente.
4. Entra. Ya puedes crear empresas y actividades.

### Paso 12. Agrega a tu equipo
1. Comparte la **misma dirección** de Vercel con cada integrante (por WhatsApp, por ejemplo).
2. Cada uno entra, usa **"Crea la cuenta"**, pone su nombre, correo y contraseña.
   - Todos los que se registren *después* de ti quedan como **integrantes**.
3. Aparecerán automáticamente en tu pestaña **Equipo**, listos para asignarles actividades.

### Paso 13. Instalar la app en el celular (PWA)
**En Android (Chrome):**
1. Abre la dirección en Chrome.
2. Menú (⋮) arriba a la derecha → **Agregar a pantalla de inicio** / **Instalar app**.
3. Confirma. Aparecerá el ícono "Operaciones" como una app normal.

**En iPhone (Safari):**
1. Abre la dirección en Safari.
2. Toca el botón **Compartir** (cuadro con flecha hacia arriba).
3. **Agregar a inicio** → **Agregar**.

Listo. Cada quien abre la app desde su ícono, inicia sesión, y las notificaciones aparecen en la campana 🔔 en tiempo real.

---

## ❓ Problemas comunes

- **"No puedo entrar / correo no confirmado":** revisa el Paso 3 (desactivar Confirm email).
- **Las fotos no se ven:** revisa que el bucket se llame exactamente `fotos` y sea **público** (Paso 4).
- **Pantalla en blanco al abrir:** casi siempre es que faltó pegar bien las llaves en `src/supabase.js` (Paso 8). Revísalas y vuelve a hacer Commit; Vercel re-publica solo.
- **Cambié algo en GitHub, ¿cómo se actualiza?** Cada vez que haces *Commit* en GitHub, Vercel vuelve a publicar automáticamente en ~1 minuto.

---

## 💰 Costos
Todo esto funciona en los planes **gratuitos** de los tres servicios, suficientes para un equipo de operaciones. Si algún día creces mucho (miles de fotos o usuarios), Supabase y Vercel tienen planes de pago, pero no los necesitas para empezar.

## ⏭️ Cuando quieras el siguiente nivel
Esta versión notifica dentro de la app (campana). Si más adelante quieres **notificaciones push que suenen en el celular con la app cerrada**, se construye sobre esto mismo agregando Firebase Cloud Messaging y empaquetando con Capacitor para generar un APK de Android. No habría que rehacer nada de lo que ya armaste.
