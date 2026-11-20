# Wattalis

Aplicación web privada para gestionar profesionales de salud y citas en hospitales, clínicas y consultorios independientes (medicina, odontología, nutrición, veterinaria y otros). Esta primera versión resuelve el trabajo diario de una recepción o de un profesional que administra su propia consulta.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Supabase Auth · PostgreSQL de Supabase · compatible con Vercel.

---

## Qué incluye esta versión

| Módulo | Qué hace |
| --- | --- |
| **Acceso** | Registro, inicio y cierre de sesión, recuperación de contraseña (enlaces por correo), páginas internas protegidas. |
| **Espacios de trabajo** | Alta de hospital, clínica o consultorio desde la interfaz (atómica, con la primera membresía de administración). Opción «Yo también atiendo consultas». Cambio de espacio desde el encabezado. |
| **Miembros e invitaciones** | Roles Administrador, Recepción y Profesional por espacio. Enlaces de invitación de un solo uso, con vencimiento y correo destinatario, que se copian y comparten sin proveedor de correo. El espacio nunca se queda sin administrador. |
| **Inicio** | Resumen real del día: citas de hoy, pendientes, confirmadas, atendidas, próxima cita y acceso a «Nueva cita». Pasos para empezar en un espacio nuevo (se ocultan al completarse). |
| **Agenda** | Vistas de día (columnas por profesional), semana y lista. Filtros por profesional, servicio y estado que se conservan en la URL. Disponible / fuera de horario / bloqueo diferenciados con patrón y texto. Crear cita desde «Nueva cita» o desde un espacio libre, ver detalle, confirmar, reprogramar (incluso a otro profesional), cancelar, marcar atendida o «No asistió», historial de cambios. |
| **Profesionales** | Alta, edición, desactivación con aviso de citas futuras (nunca cancela en silencio), servicios asignados, horario semanal con varios bloques por día, bloqueos (vacaciones, comida, ausencia) y vínculo con una cuenta. |
| **Servicios** | Alta, edición y desactivación; duración en minutos; asignación a uno o varios profesionales. Cambiar la duración conserva la hora final de las citas ya registradas. |
| **Pacientes o contactos** | Directorio administrativo (nombre + teléfono o correo), búsqueda, sugerencia de posibles duplicados sin fusionar y sin revelar contactos fuera de permisos, citas visibles por paciente. En veterinaria el contacto es el tutor y la mascota se indica en cada cita. |
| **Configuración** | Datos del espacio (nombre, tipo, zona horaria, intervalo de agenda), miembros y roles, invitaciones, nombre y contraseña de la cuenta. |

Fuera de alcance en esta etapa (y sin botones inactivos que lo anuncien): directorio público, búsqueda de doctores, autoservicio de pacientes, pagos, facturación, recetas, expediente clínico, teleconsulta, WhatsApp e IA.

---

## Requisitos

- Node.js 20.9 o superior (probado con Node 22) y npm.
- Un proyecto de Supabase **o** Supabase CLI con Docker para trabajar en local.
- Las pruebas de base de datos **no** necesitan Docker: levantan un PostgreSQL embebido.

## Instalación

```bash
npm install
cp .env.example .env.local   # y completa los valores
```

Variables (ver `.env.example`):

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto (`http://127.0.0.1:54321` en local). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública (`sb_publishable_…` o la *anon key* de proyectos anteriores). También se acepta `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `NEXT_PUBLIC_SITE_URL` | URL pública de la app; se usa en enlaces de correo e invitaciones. |

La aplicación **no** usa la `service_role` key: todas las operaciones usan la sesión del usuario y RLS.

---

## Modo de prueba (sin cuenta ni Supabase)

Para recorrer toda la interfaz antes de conectar Supabase:

```bash
npm run dev
```

Abre `http://localhost:3000` y pulsa **«Pruebas»** en la pantalla de inicio de sesión. Entras como administración de una clínica ficticia; la franja amarilla superior indica que es modo de prueba y permite **«Ver como»** Recepción, Profesional o el consultorio independiente, **«Reiniciar datos»** y **«Salir de pruebas»**.

- Los datos son **ficticios** (los mismos de `supabase/seed.sql`) y viven en la memoria del servidor de desarrollo: se pierden al reiniciarlo y nunca tocan una base real.
- Se aplican los mismos permisos por rol y las mismas reglas de agenda (horarios, bloqueos, traslapes, estados), reimplementados en `src/lib/demo/` para este modo. La garantía real sigue siendo la base de datos.
- Está activo con `npm run dev`. En un build de producción queda **desactivado**, salvo que definas `WATTALIS_DEMO=1` (útil solo para una vista previa sin datos reales).
- No disponible en este modo: aceptar invitaciones, cambiar contraseña, registro e inicio de sesión reales.

## Opción A · Supabase local (Supabase CLI + Docker)

```bash
npx supabase start          # levanta Postgres, Auth, API y un buzón de correo local
npx supabase db reset       # aplica supabase/migrations y carga supabase/seed.sql (solo local)
npx supabase status         # muestra API URL y la clave pública
```

Copia `API URL` y la clave pública (*Publishable key* / *anon key*) a `.env.local` y arranca la app:

```bash
npm run dev                 # http://localhost:3000
```

Los correos de confirmación y recuperación **no salen a Internet**: se ven en el buzón local `http://127.0.0.1:54324`. `supabase/config.toml` ya trae las URLs de retorno y las plantillas en español.

## Opción B · Proyecto alojado de Supabase

1. Crea un proyecto **vacío** (de desarrollo) en Supabase.
2. Aplica las migraciones:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref-del-proyecto>
   npx supabase db push
   ```
   (Alternativa: ejecuta en orden los archivos de `supabase/migrations/` en el SQL Editor.)
3. En **Authentication → URL Configuration**:
   - *Site URL*: `http://localhost:3000` (o tu dominio de producción).
   - *Redirect URLs*: `http://localhost:3000/auth/confirm` y, para producción, `https://<tu-dominio>/auth/confirm`.
4. En **Authentication → Sign In / Providers → Email**, deja activado *Confirm email*.
5. En **Authentication → Email Templates**, pega `supabase/templates/confirmation.html` (Confirm signup) y `supabase/templates/recovery.html` (Reset password). Usan `token_hash`, así el enlace funciona aunque se abra en otro navegador. Si conservas las plantillas por omisión, la app también acepta el flujo `code` (PKCE), pero entonces el enlace debe abrirse en el mismo navegador.
6. Para producción configura un SMTP propio (Authentication → SMTP): el servicio de correo incluido en Supabase tiene un límite muy bajo y es solo para pruebas.

### Datos de demostración (solo desarrollo)

`supabase/seed.sql` crea datos **ficticios** y se ejecuta solo con `supabase db reset` en local; `supabase db push` nunca lo aplica. Es reproducible: borra y recrea únicamente los registros demo (identificadores fijos) y calcula las fechas a partir de hoy en `America/Mexico_City`.

Para cargarlo en un proyecto **de desarrollo** alojado (nunca en producción):

```bash
psql "<cadena de conexión de Project Settings → Database>" -f supabase/seed.sql
```

Contraseña de todas las cuentas demo: **`Wattalis-demo-2026`**

| Cuenta | Espacio y rol |
| --- | --- |
| `admin@clinica-arboleda.test` | Administración · Clínica Arboleda (demo) |
| `recepcion@clinica-arboleda.test` | Recepción · Clínica Arboleda **y** Administración · Veterinaria Patitas (demo) |
| `ana.ruiz@clinica-arboleda.test` | Profesional · Clínica Arboleda (Dra. Ana Ruiz) |
| `luis.herrera@consultorio.test` | Administración + Profesional · Consultorio Dr. Herrera (demo) |

Incluye: una clínica con dos profesionales (uno sin cuenta), recepción y cuatro servicios; un consultorio independiente; una veterinaria con mascotas en las citas; horarios partidos (09:00–13:00 y 15:00–18:00), bloqueos (una junta, unas vacaciones de un día y un congreso), citas del día hábil anterior (atendidas / no asistió), de hoy y de los próximos días, una cancelada y una reprogramada con historial. El alta de un espacio nuevo sigue empezando completamente vacía.

---

## Cómo probarlo por rol

**Administración (clínica)** — `admin@clinica-arboleda.test`
1. *Profesionales → Nuevo profesional*: registra a alguien, asígnale servicios y define su horario (puedes agregar varios bloques por día y copiar el lunes a martes–viernes).
2. *Servicios*: crea un servicio y asígnalo a varios profesionales.
3. *Agenda*: haz clic en un espacio libre de cualquier columna o usa «Nueva cita». Prueba un horario ocupado: la app lo rechaza y ofrece alternativas.
4. *Profesional → Bloqueos*: intenta bloquear un periodo con citas vigentes; la app lo impide y te lleva a esas citas.
5. *Configuración → Miembros y roles*: crea un enlace de invitación, cópialo y ábrelo en otra ventana privada con la cuenta del correo invitado.

**Recepción** — `recepcion@clinica-arboleda.test`
1. Agenda con cualquiera de los dos profesionales. En el formulario, «Registrar nuevo contacto» crea al paciente sin perder lo ya capturado; recarga y verás la cita y el paciente guardados.
2. Puede ver profesionales, servicios, horarios y bloqueos, pero no administrarlos ni gestionar miembros.
3. Cambia a «Veterinaria Patitas» desde el encabezado: ahí es administradora; los filtros y formularios del espacio anterior se limpian.

**Profesional** — `ana.ruiz@clinica-arboleda.test`
- Ve solo su agenda y «Mis pacientes». Cambiar el filtro o la URL a otro profesional o paciente no revela nada (la base responde vacío o 404).

**Consultorio independiente** — `luis.herrera@consultorio.test`
- Una sola cuenta administra el espacio y recibe citas. Solo ve los datos de su consultorio.

**Desde el teléfono**: la agenda abre la lista del día; la semana se muestra como lista agrupada (sin desplazamiento horizontal de la página) y el detalle de la cita se abre como panel.

---

## Verificaciones

```bash
npm run typecheck   # tipos de rutas + TypeScript
npm run lint        # ESLint (reglas de Next y React)
npm test            # pruebas unitarias + integración con PostgreSQL embebido
npm run build       # build de producción
npm run check       # todo lo anterior
```

`npm run test:db` descarga (vía npm) PostgreSQL 18 embebido, aplica un *shim* mínimo del esquema `auth` y roles de Supabase (`tests/db/supabase-shim.sql`), luego **las mismas migraciones** de `supabase/migrations`, y ejecuta las pruebas con sesiones reales (`set role authenticated` + claims JWT), incluidas pruebas de concurrencia con varias conexiones simultáneas.

| Escenario del requerimiento | Dónde se prueba |
| --- | --- |
| 1. Doctor independiente crea consultorio, se da de alta, crea servicio, horario y primera cita | `tests/db/roles.test.ts` («un administrador que también atiende…»), `helpers.ts › buildFixture` |
| 2. Recepción agenda con paciente nuevo; persiste | `tests/db/roles.test.ts`, `scheduling.test.ts` |
| 3. Aislamiento entre espacios y rechazo de relaciones cruzadas | `tests/db/isolation.test.ts` |
| 4. Cuenta con dos espacios y roles distintos | `tests/db/roles.test.ts` («Cuenta con varios espacios») |
| 5. Profesional ve solo lo suyo; recepción todo su espacio | `tests/db/roles.test.ts` |
| 6. Reservas simultáneas | `tests/db/concurrency.test.ts` |
| 7. Contiguas válidas; descanso, bloqueo y fin de jornada rechazados | `tests/db/scheduling.test.ts` |
| 8. Cancelar conserva historial y libera; mover a ocupado conserva el original | `tests/db/scheduling.test.ts`, `concurrency.test.ts` |
| 9. Hora del consultorio con el navegador en otra zona | `tests/unit/tz.test.ts` (corre con `TZ=Asia/Tokyo`), `scheduling.test.ts` (sesión en Asia/Tokyo) |
| 11. Invitación vencida, reutilizada o con otro correo | `tests/db/invitations.test.ts` |
| 12. Compilación, tipos, lint y pruebas | `npm run check` |

**Pendiente de verificar con un proyecto de Supabase real** (no había uno disponible durante el desarrollo): los flujos de interfaz de punta a punta en el navegador (registro con confirmación de correo, recuperación de contraseña, uso del formulario de agenda contra la API) y el escenario 10 en un teléfono físico. El código de la interfaz compila, pasa tipos y lint, y sus partes lógicas (zona horaria, cuadrícula, parámetros, errores) tienen pruebas unitarias.

---

## Despliegue en Vercel

1. Importa el repositorio en Vercel (framework: Next.js; comandos por omisión).
2. Variables de entorno (Production y Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `NEXT_PUBLIC_SITE_URL` = `https://<tu-dominio>` (en Preview puedes omitirla: se usa el origen de la solicitud).
3. En Supabase → Authentication → URL Configuration:
   - *Site URL*: `https://<tu-dominio>`
   - *Redirect URLs*: `https://<tu-dominio>/auth/confirm` y, si usarás previews, `https://*-<tu-equipo>.vercel.app/auth/confirm`.
4. Aplica las migraciones al proyecto de producción con `supabase db push` (no cargues el seed).
5. Configura SMTP propio en Supabase antes de abrir el registro a usuarios reales.

No hay claves privilegiadas que configurar en Vercel.

---

## Arquitectura

```
src/
  app/                    Rutas (App Router). (auth) público, (app) protegido.
  proxy.ts                Renueva la sesión y protege las páginas internas.
  features/<módulo>/      Acciones de servidor, consultas y componentes por dominio:
                          agenda, professionals, services, patients, settings, workspaces, auth, dashboard
  components/ui|shell/    Componentes accesibles reutilizables y estructura de la app.
  lib/                    Sesión y espacio activo, permisos, zona horaria, errores, tipos de BD.
  lib/demo/               Modo de prueba: datos ficticios en memoria (solo desarrollo).
supabase/
  migrations/             Migraciones SQL versionadas.
  seed.sql                Datos ficticios (solo desarrollo).
  templates/              Correos en español.
tests/
  unit/                   Pruebas sin base de datos.
  db/                     Integración real con PostgreSQL (RLS, reglas de agenda, concurrencia).
```

**Aislamiento.** Una sola aplicación y una sola base. Cada entidad del espacio lleva `organization_id`. Las relaciones usan llaves foráneas compuestas `(id, organization_id)`, de modo que la base rechaza una cita con profesional, servicio o paciente de otro espacio, una relación profesional–servicio cruzada o una cuenta vinculada a un profesional de un espacio donde no es miembro. RLS está activo en todas las tablas expuestas, con políticas por membresía, rol y —para el rol Profesional— el perfil vinculado. Los privilegios por columna impiden escribir campos como `created_by` u `organization_id` en una actualización. El espacio activo (cookie) solo sirve para navegar y se valida contra las membresías reales en cada solicitud; las acciones además rechazan un `organization_id` distinto del activo (otra pestaña).

**Agenda.** Las citas guardan instantes con zona horaria; la hora final la calcula la base con la duración del servicio. Cada escritura de cita o bloqueo toma un bloqueo de fila sobre el profesional (serializa reservas simultáneas) y valida en un trigger: horario semanal en hora local del espacio, bloqueos, citas vigentes, profesional y servicio activos y asignados. La restricción de exclusión `appointments_no_overlap` (`btree_gist`, intervalos `[inicio, fin)`) es la garantía final aunque alguien omita ese camino. Reprogramar actualiza la misma fila; si falla, la transacción se revierte y la cita queda en su horario. La llave de idempotencia evita duplicados por doble clic. `appointment_events` registra quién y cuándo creó, reprogramó o cambió el estado (sin datos del paciente).

**Zona horaria.** `America/Mexico_City` por omisión, editable por espacio. La base convierte fechas y horas locales del espacio (`fecha + hora AT TIME ZONE zona`) y devuelve horas locales ya calculadas; la interfaz formatea con `Intl` y la zona del espacio. La zona del navegador nunca interviene.

### Decisiones tomadas

- **Calendario propio** en lugar de una biblioteca: las vistas por profesional y la distinción disponible/fuera de horario/bloqueo dependen de reglas propias; así no hay dependencias de pago ni conversiones de zona del lado del navegador.
- **Cache Components desactivado** en `next.config.ts`: todo es por usuario y por espacio, y su `<Activity>` conservaría formularios de un espacio al cambiar a otro.
- **Mascota como texto en la cita** (`appointments.pet_name`), con sugerencias de nombres previos del tutor. Permite varias mascotas por tutor sin construir fichas veterinarias.
- **Reprogramar conserva la duración propia de la cita** (la registrada al crearla), coherente con «conservar la hora final si cambia el servicio».
- **No se agenda en el pasado** desde la interfaz/API; «Atendida» y «No asistió» solo para citas que ya comenzaron. Atendida ↔ No asistió se puede corregir; una cancelada no se reactiva.
- **Cambiar el horario semanal** no cancela citas: avisa cuántas citas futuras quedaron fuera.

### Limitaciones conocidas

- Supabase no confirma si un correo ya está registrado al crear cuenta (por seguridad); la app muestra el mismo mensaje en ambos casos.
- Si se elimina la cuenta del único administrador de un espacio, la base lo impide (protege al espacio de quedar sin administración).
- Para un cambio de zona horaria con horario de verano, una hora local inexistente se ajusta automáticamente.
- El enlace de invitación solo se muestra al crearlo; si se pierde, se crea uno nuevo (el anterior queda revocado).

---

## Portal público de pacientes (fase posterior)

No está implementado. El modelo ya permite reutilizar:

- **`get_available_slots`**: la misma función que usa recepción calcula horarios libres (horario semanal, bloqueos, citas, duración del servicio, zona del espacio). Bastará con una versión pública que exponga solo profesionales y servicios marcados como publicables.
- **`book_appointment` + trigger de validación + restricción de exclusión**: garantizan que una reserva pública no choque con una de recepción aunque ocurran al mismo tiempo. La llave de idempotencia sirve para reintentos desde el navegador del paciente.
- **`organizations`, `professionals`, `services`, `professional_services`, `professional_types`**: base del directorio público (se agregarían campos como «visible en el portal» y una ruta pública por espacio).
- **`contacts`**: el paciente que reserve en línea se registraría como contacto del espacio; las sugerencias de duplicados ya existen para que recepción concilie.
- **`appointment_events`**: el historial ya distingue quién hizo cada cambio, útil para auditar reservas de pacientes.

Lo que faltará: un rol o canal anónimo/paciente con políticas RLS propias (hoy `anon` no tiene acceso a nada), verificación del paciente (correo o teléfono), reglas de anticipación/cancelación y notificaciones.
