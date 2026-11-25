# Suscripciones SaaS de Wattalis

Módulo para que cada organización (hospital, clínica o consultorio) contrate, cambie, renueve o cancele su plan. **Hoy funciona completo en modo demostración**: pasarela simulada, datos ficticios en memoria, sin AWS ni Stripe y **sin cobros reales**. La arquitectura queda lista para PostgreSQL en Amazon RDS, Amazon Cognito, Amazon SES y una pasarela real.

---

## 1. Rutas

| Ruta | Quién | Qué hace |
| --- | --- | --- |
| `/precios` | Público | Planes, selector mensual/anual, comparativa, beneficios, preguntas frecuentes y contacto Corporativo. |
| `/suscripcion/seleccionar` | Público | Paso 1: plan y periodicidad. |
| `/suscripcion/registro` | Público | Paso 2: crear cuenta, iniciar sesión, recuperar contraseña (sistema de acceso existente) o entrar con una cuenta de prueba. |
| `/suscripcion/organizacion` | Con sesión | Paso 3: elegir un espacio existente o crear una organización; datos del responsable. |
| `/suscripcion/resumen` | Administración del espacio | Paso 4: desglose (descuento, IVA, total), renovación automática y aceptación de términos. |
| `/suscripcion/pago` | Administración del espacio | Paso 5: pasarela **simulada** (aprobado, rechazado, pendiente, cancelar). Sin campos de tarjeta. |
| `/suscripcion/confirmacion` | Administración del espacio | Paso 6: bienvenida, renovación, funciones habilitadas; error o pago pendiente con reintento. |
| `/configuracion/suscripcion` | Administración | Mi plan: estado, precio, fechas, uso contra límites, funciones, cambiar plan, cancelar, reactivar. |
| `/configuracion/facturacion` | Administración | Historial de cobros y comprobantes de demostración (no fiscales). |
| `/configuracion/suscripcion/metodos-de-pago` | Administración | Tarjetas de prueba ficticias (agregar, actualizar, predeterminada, eliminar). |
| `/configuracion/suscripcion/renovacion` | Administración | Renovación automática, siguiente cobro, política de cancelación, avisos e historial. |
| `/configuracion/suscripcion/avisos` | Administración | Bandeja de correos de demostración con vista previa. |
| `/admin/suscripciones` | Rol de **plataforma** | Panel global: indicadores, métricas, clientes, planes, precios, eventos, auditoría y simulaciones. |
| `POST /api/billing/webhook` | Pasarela | Eventos firmados; idempotente. |
| `GET /api/billing/catalog` | Público | Catálogo de solo lectura (planes, funciones, límites, precios) que consume la página `/planes` del sitio público. |

Recepción y Profesional ven en «Suscripción y facturación» solo el plan y su estado, sin importes.

---

## 2. Arquitectura

```
Páginas y componentes (src/app, src/features/billing/components)
        │  acciones de servidor (src/features/billing/actions.ts)
        ▼
BillingService (service.ts) ── valida Actor + tenant (authz.ts) y la máquina de estados
   ├── BillingRepository (repository.ts)
   │      ├── InMemoryBillingRepository  ← activo en demostración
   │      └── PostgreSQL / RDS           ← futuro (mismas columnas que la migración)
   ├── BillingProvider (providers/types.ts)
   │      ├── MockBillingProvider        ← activo: firma eventos con HMAC
   │      └── StripeBillingProvider      ← preparado, deshabilitado
   └── NotificationSender (notifications.ts)
          ├── DemoInboxSender            ← activo: bandeja, no envía
          └── SesEmailSender             ← preparado para Amazon SES
```

- **Fuente de verdad del pago:** el estado de una suscripción solo cambia al procesar un evento firmado de la pasarela (`processWebhook`): verificación de firma → descarte de duplicados por `provider_event_id` → cambio dentro de una transacción. Nadie de una clínica puede marcar un cobro como pagado (ni en la app ni en la base: no hay permisos de escritura).
- **Pertenencia:** la suscripción es de una cuenta de facturación de una **organización** (`billing_accounts.organization_id`), nunca de una persona. Un espacio tiene como máximo una suscripción vigente. `billing_account_workspaces` + `subscriptions.workspace_id = null` preparan la facturación central de varias sedes (Corporativo).
- **Importes:** centavos enteros. IVA configurable (incluido o adicional). El prorrateo de mejoras se calcula igual que lo hará la pasarela (`pricing.ts › prorate`); con Stripe la cifra definitiva vendrá de su vista previa de factura.
- **Dominio puro y probado:** `catalog.ts`, `pricing.ts`, `state-machine.ts`, `entitlements.ts`, `metrics.ts`, `notifications.ts` no dependen de Next ni de la base.

### Permisos comerciales (entitlements)

Independientes de los roles: el rol dice **quién** puede hacer algo; el plan dice **si el espacio lo tiene contratado**. Una acción necesita ambos.

| Restricción | Interfaz | Verificación en el servidor |
| --- | --- | --- |
| Profesionales activos (`professionals.max`) | `/profesionales/nuevo` con `SubscriptionFeatureGate` | `saveProfessional` y `setProfessionalActive` (`capacityError`); trigger `professionals_plan_limit` en la base (activable con `billing_settings.enforce_limits`) |
| Usuarios internos (`users.max`: miembros + invitaciones vigentes) | Mensaje al invitar | `inviteMember` |
| Reportes financieros / avanzados / auditoría | Tarjetas bloqueadas en `/reportes` | Página del reporte y descarga CSV (403) |
| Áreas médicas (`areas.multiple`) | Selector de área oculto | `getPracticeContext` deja de filtrar por área |
| Modo de consulta (impago, cancelada, vencida, sin plan) | Aviso global bajo el encabezado | `createAppointment` rechaza citas nuevas |

Nunca se borra información por bajar de plan, cancelar o dejar de pagar: se impide **agregar** más; consultar y exportar (CSV) sigue disponible.

Sin facturación habilitada (`UNMANAGED`) nada se restringe: los espacios actuales funcionan igual que antes.

### Máquina de estados

`src/features/billing/state-machine.ts` (y la misma tabla en `private.subscription_transition_allowed`; una prueba verifica que coincidan).

| Evento | Transición |
| --- | --- |
| `checkout_completed` | incomplete → active |
| `trial_started` / `trial_converted` / `trial_payment_failed` / `trial_expired` | incomplete → trialing · trialing → active / past_due / expired |
| `renewed` · `plan_changed` | active → active (plan_changed también en trialing) |
| `payment_failed` → `payment_retry_failed` → `grace_period_expired` | active → past_due → grace_period → unpaid |
| `payment_recovered` | past_due / grace_period / unpaid → active |
| `period_ended_canceled` · `canceled_immediately` | → canceled |
| `checkout_expired` | incomplete → expired |
| `reactivated` | canceled / expired → active |

Acceso: `trialing`, `active`, `past_due`, `grace_period` → completo · `incomplete`, `unpaid`, `canceled`, `expired` → consulta y exportación. Cada estado define mensaje, acciones disponibles, renovación y aviso (`STATUS_INFO`). Periodo de gracia configurable (7 días por omisión).

---

## 3. Modelo de datos

Migración: `supabase/migrations/20261125090000_subscriptions.sql` (PostgreSQL estándar; solo `auth.uid()` es de Supabase).

| Tabla | Propósito | Reglas clave |
| --- | --- | --- |
| `subscription_plans` | Catálogo configurable | `code` único; precios en centavos; `null` solo con `is_custom_pricing`; `tier` para mejora/reducción |
| `plan_entitlements` | Funciones y límites por plan | único `(plan_id, feature_code)`; `usage_limit null` = sin límite |
| `billing_settings` | Descuento anual, gracia, IVA, prueba, `enforce_limits` | una sola fila, rangos validados |
| `billing_accounts` | Quién paga (una por organización) | `organization_id` único, `ON DELETE RESTRICT` |
| `billing_account_workspaces` | Sedes cubiertas por una cuenta central | un espacio, una cuenta |
| `subscriptions` | Suscripción | una vigente por espacio (índice parcial); trigger de transiciones; dueño inmutable; espacio debe pertenecer a la cuenta |
| `subscription_events` | Historial | `provider_event_id` único (idempotencia); trigger registra cada cambio de estado |
| `billing_invoices` | Comprobantes (no CFDI) | total = base + IVA; `paid` ⇔ `paid_at`; FK compuesta con la suscripción de la misma cuenta |
| `payment_attempts` | Intentos de cobro | ligados a un comprobante |
| `subscription_change_requests` | Reducciones programadas | una programada por suscripción |
| `billing_payment_methods` | Solo marca, terminación y vencimiento | `last4` de 4 dígitos; una predeterminada |
| `billing_notifications` | Bandeja de salida (SES) | |
| `billing_audit_log` | Operaciones de la plataforma | solo plataforma la lee |
| `platform_admins` | Equipo Wattalis | no depende del rol en una clínica |

**RLS:** los planes activos y la configuración son públicos (anónimos incluidos). La suscripción la leen los miembros del espacio (para mostrar restricciones). Cuenta, comprobantes, intentos, métodos, eventos y avisos: solo Administración del espacio dueño de la cuenta o la plataforma. **Ninguna** tabla tiene permisos de escritura para `anon`/`authenticated`; escribe solo el procesador de eventos con `service_role` (en AWS, el rol de la Lambda).

`public.workspace_entitlements(workspace_id)` devuelve estado y funciones del plan para verificaciones en el servidor.

---

## 4. Modo demostración

Existe solo con `npm run dev` o `WATTALIS_DEMO=1` (como el modo de prueba existente) y se aplica a las **sesiones del modo de prueba** («Pruebas» o «Continuar con una cuenta de prueba»). Una cuenta real de Supabase en desarrollo no queda restringida por datos ficticios, salvo que se active explícitamente con `WATTALIS_BILLING_PROVIDER=mock`. El catálogo de `/precios` sí refleja lo que edite la plataforma. Los datos de facturación son ficticios, viven en la memoria del servidor, se reinician con **«Reiniciar datos»** (franja amarilla) o desde el panel de la plataforma, y se pierden al reiniciar el servidor. Todo se etiqueta como «demostración», «simulado» o «sin validez fiscal».

Personas (selector **«Ver como»** de la franja de pruebas):

| Persona | Espacio y plan inicial |
| --- | --- |
| Administración · Clínica Arboleda (Laura) | Empresarial mensual, activa |
| Consultorio independiente (Dr. Luis Herrera) | Esencial mensual, activa (1 de 1 profesional) |
| Recepción de Arboleda / admin de Centro de Nutrición Vital (Mario) | Nutrición Vital: Profesional en prueba |
| Cuenta nueva sin espacio (Sofía Navarro) | Sin espacio: para contratar desde cero |
| Equipo Wattalis (plataforma) | Panel `/admin/suscripciones` |

Además hay 16 clientes ficticios con un año de historial (activos, en prueba, vencidos, en gracia, impago, cancelados, incompletos) para las métricas.

Tarjetas de prueba: Visa ···4242, Mastercard ···4444 y Amex ···8431 aprueban; Visa ···0002 rechaza. Nadie escribe números de tarjeta.

### Escenarios

```bash
npm run dev   # http://localhost:3000
```

1. **Cliente nuevo:** abre `/precios` → «Elegir Profesional» (prueba Anual) → «Continuar» → «Continuar con una cuenta de prueba» → «Crear una nueva organización», completa los datos → acepta términos → «Continuar al pago» → «Simular pago rechazado» (verás el error y «Reintentar») → «Simular pago aprobado» → «Ir a mi espacio de trabajo». En Configuración → Suscripción y facturación verás el plan activo, el comprobante y los avisos.
2. **Mejora de plan:** «Ver como» → Consultorio independiente. En Reportes, *Ventas* aparece bloqueado y en *Nuevo profesional* el límite (1 de 1). Configuración → Suscripción y facturación → «Cambiar plan» → Profesional: revisa prorrateo y funciones nuevas → «Confirmar cambio». Ventas y el alta de profesionales quedan habilitados.
3. **Pago rechazado:** «Ver como» → Equipo Wattalis. En Clientes, fila *Clínica Arboleda*: «Renovar (pago rechazado)» → Pago vencido; «Reintentar cobro (rechazado)» → Periodo de gracia (7 días); opcional «Terminar periodo de gracia» → Impago (la clínica queda en consulta). Regulariza con «Reintentar cobro (aprobado)», o como Laura agrega una tarjeta que aprueba y pulsa «Reintentar pago».
4. **Cancelación:** como Laura, Mi plan → «Cancelar renovación» (motivo opcional) → la suscripción sigue activa y «no se renovará». Puedes «Reactivar renovación». Para ver el vencimiento: como Equipo Wattalis, «Renovar (pago aprobado)» sobre Arboleda → Cancelada (modo consulta). Como Laura, «Reactivar suscripción» lleva al resumen y al pago simulado.
5. **Administrador de Wattalis:** como Equipo Wattalis revisa indicadores (MRR/ARR simulados, cancelación), gráficas, clientes, eventos e historial; edita precios, beneficios y límites de un plan (se reflejan al momento en `/precios`), cambia el descuento anual o la gracia, y reinicia los datos.

---

## 5. Pruebas

```bash
npm test          # unitarias + PostgreSQL embebido (sin Docker)
npm run check     # tipos + lint + pruebas + build
```

Recorrido E2E opcional en navegador (los 5 escenarios, teléfono y accesibilidad básica): ver `tests/e2e/README.md`.

| Requerimiento | Dónde |
| --- | --- |
| 1 Selección de planes · 2 Mensual/anual · 3 Importes | `tests/unit/billing-domain.test.ts`, `billing-service.test.ts` («selección de planes») |
| 4 Suscripción simulada · 5 Renovación · 6 Pago rechazado · 7 Gracia | `billing-service.test.ts` |
| 8 Cambio de plan · 9 Cancelación · 10 Reactivación | `billing-service.test.ts` |
| 11 Límites por plan | `billing-domain.test.ts`, `billing-ui.test.ts`, `tests/db/billing.test.ts` (trigger) |
| 12 Permisos por rol · 13 Aislamiento entre clínicas | `billing-service.test.ts`, `tests/db/billing.test.ts` (RLS real) |
| 14 Administrador global | `billing-service.test.ts`, `tests/db/billing.test.ts` |
| 15 Eventos duplicados · 16 Transiciones inválidas | `billing-service.test.ts`, `billing-domain.test.ts`, `tests/db/billing.test.ts` |
| 17 Integridad de registros | `billing-service.test.ts`, `tests/db/billing.test.ts` |
| 18 Responsive · 19 Accesibilidad básica | `billing-ui.test.ts`, `tests/e2e/suscripciones.e2e.mjs` |
| 20 Compatibilidad con módulos existentes | suite existente completa + `billing-ui.test.ts` (sin facturación no restringe) |

---

## 6. Variables de entorno

Ninguna es necesaria para la demostración.

| Variable | Uso |
| --- | --- |
| `WATTALIS_BILLING_PROVIDER` | Sin valor: la demostración aplica a las sesiones del modo de prueba. `mock`: también a cuentas reales (solo desarrollo o `WATTALIS_DEMO=1`). `none`: desactivar. `stripe`: futuro. La pasarela simulada nunca se activa en producción sin `WATTALIS_DEMO=1`. |
| `WATTALIS_MOCK_WEBHOOK_SECRET` | Secreto HMAC de la pasarela simulada (opcional). |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Futuro. Solo servidor (Secrets Manager). |
| `DATABASE_URL` o `RDS_SECRET_ARN` | Futuro: conexión privilegiada del procesador de eventos a RDS. |
| `AWS_REGION`, `WATTALIS_SES_FROM`, `WATTALIS_SES_CONFIGURATION_SET` | Futuro: correos con Amazon SES. |
| `WATTALIS_BILLING_QUEUE_URL` | Futuro: cola SQS de eventos de facturación. |
| `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` | Futuro: Amazon Cognito (`src/lib/auth/identity-provider.ts`). |
| `WATTALIS_CFDI_PROVIDER`, `WATTALIS_CFDI_API_KEY` | Futuro: proveedor autorizado (PAC) para CFDI. |

Nunca uses prefijo `NEXT_PUBLIC_` para claves secretas.

---

## 7. Servicios de AWS por configurar

| Servicio | Uso previsto |
| --- | --- |
| Amazon RDS PostgreSQL | Tablas de esta migración (y las existentes). Implementar `BillingRepository` sobre `pg` con transacciones. |
| Amazon Cognito | Identidad; el claim `sub` sustituye a `auth.uid()` en RLS (`set_config('request.jwt.claims', …)`). |
| AWS Lambda | Procesador de webhooks de la pasarela y tareas de ciclo de vida (renovaciones, fin de gracia, avisos). |
| Amazon API Gateway | Endpoint público del webhook (o la ruta `/api/billing/webhook` de la app). |
| Amazon SQS | Cola entre el webhook y el procesador (reintentos, DLQ). |
| Amazon EventBridge Scheduler | Avisos de renovación próxima, fin de prueba y fin del periodo de gracia. |
| Amazon SES | Envío de las 11 plantillas (`SesEmailSender`), dominio verificado, DKIM/SPF. |
| AWS Secrets Manager | Claves de la pasarela, secreto de webhooks, credenciales de RDS. |
| Amazon S3 | Comprobantes y CFDI (PDF/XML) cuando existan. |
| Amazon CloudWatch | Logs, métricas (pagos fallidos, eventos rechazados) y alarmas. |

---

## 8. Conectar una pasarela real (Stripe u otra)

1. Crear productos y precios (mensual y anual) por plan; guardar sus ids en `subscription_plans.provider_price_monthly_id/annual_id`.
2. Completar `StripeBillingProvider` (`providers/stripe.ts` documenta el mapeo de cada operación) con el SDK oficial, solo en el servidor.
3. Implementar `BillingRepository` sobre PostgreSQL (RDS) y elegirlo junto con el proveedor según `WATTALIS_BILLING_PROVIDER`.
4. Sustituir el paso 5 por la redirección a Stripe Checkout (`createCheckoutSession().url`) y «Administrar suscripción» por el Customer Portal (`getCustomerPortalUrl`).
5. Configurar el webhook (`/api/billing/webhook` o API Gateway + Lambda) con `STRIPE_WEBHOOK_SECRET`; el procesamiento ya verifica firma y es idempotente. Normalizar `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.trial_will_end` y `customer.subscription.deleted`.
6. Mover renovaciones y fin de gracia a la pasarela/EventBridge; desactivar las simulaciones (solo existen con la pasarela simulada).
7. Integrar un PAC para CFDI 4.0 y retirar la leyenda de demostración solo para cobros reales.
8. Activar `billing_settings.enforce_limits` cuando todas las organizaciones tengan suscripción.
9. Revisar con el área legal términos, aviso de privacidad, política de retención y exportación.

---

## 9. Supabase hoy, AWS mañana

El código de Supabase no se modificó de forma destructiva. Puntos de acoplamiento a migrar: `src/lib/supabase/*` (clientes y proxy), `src/lib/session.ts` (`getAuthUser`), `src/features/auth/actions.ts` (registro, acceso, recuperación), las políticas RLS con `auth.uid()` y las RPC de las migraciones. El módulo de suscripciones no usa Supabase: su repositorio es intercambiable y la única lectura de Supabase es `platform_admins` para el rol de plataforma.

## 10. Limitaciones conocidas

- La demostración guarda los datos en memoria del proceso: no es apta para varias instancias ni sobrevive a un reinicio (igual que el modo de prueba existente).
- Con cuentas reales (Supabase) la facturación queda deshabilitada salvo `WATTALIS_BILLING_PROVIDER=mock`: no hay restricciones comerciales hasta conectar la pasarela y el repositorio PostgreSQL.
- Las métricas históricas usan el precio vigente de cada plan (estimación); con la pasarela real se calcularán con los cobros efectivos.
- Las funciones marcadas «Próximamente» (recordatorios, automatizaciones, soporte prioritario, API) no existen todavía y no se venden como disponibles.
