// Recorrido E2E de los 5 escenarios de suscripción en un navegador real (opcional).
// Requiere el servidor en modo de prueba (`npm run dev`) y playwright-core; ver tests/e2e/README.md.
// No forma parte de `npm test` para no agregar dependencias al proyecto.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = new URL("../../.tmp/e2e/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROMIUM_PATH || undefined;
const P = { laura: "a0000000-0000-4000-8000-000000000001", luis: "a0000000-0000-4000-8000-000000000004", plataforma: "a0000000-0000-4000-8000-000000000006" };

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✘"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch(exe ? { executablePath: exe } : {});
async function ctxAs(persona, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: "es-MX" });
  if (persona) await ctx.addCookies([{ name: "wattalis_demo", value: P[persona], url: BASE }]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  // Datos demo en memoria: se reinician con el botón del banner de pruebas.
  {
    const { ctx, page } = await ctxAs("laura");
    await page.goto(`${BASE}/inicio`);
    await page.getByRole("button", { name: "Reiniciar datos" }).click();
    await page.waitForTimeout(1500);
    await ctx.close();
  }
  // ---------------------------------------------------------------- Precios (público, escritorio y teléfono)
  {
    const { ctx, page, errors } = await ctxAs(null);
    await page.goto(`${BASE}/precios`);
    check("precios: título", await page.getByRole("heading", { name: "Un plan para cada etapa de tu crecimiento" }).isVisible());
    await page.getByRole("radio", { name: /Anual/ }).check({ force: true });
    check("precios: anual muestra cobro anual y ahorro", (await page.getByText("cobrados una vez al año").count()) >= 3 && (await page.getByText(/Ahorras \$1,618\.20 al año/).count()) === 1);
    await page.screenshot({ path: `${OUT}precios-desktop.png`, fullPage: false });
    check("precios: sin errores de JS", errors.length === 0, errors.join(" | "));
    await ctx.close();

    const m = await ctxAs(null, { width: 390, height: 844 });
    await m.page.goto(`${BASE}/precios`);
    check("precios (teléfono): sin desplazamiento horizontal", await noHScroll(m.page));
    await m.page.locator("#comparativa").scrollIntoViewIfNeeded();
    await m.page.screenshot({ path: `${OUT}precios-mobile.png` });
    await m.ctx.close();
  }

  // ---------------------------------------------------------------- Escenario 1: cliente nuevo
  {
    const { ctx, page, errors } = await ctxAs(null);
    await page.goto(`${BASE}/suscripcion/seleccionar?plan=profesional&periodo=anual`);
    await page.getByRole("link", { name: "Continuar" }).click();
    await page.waitForURL(/\/suscripcion\/registro/);
    await page.getByRole("button", { name: "Continuar con una cuenta de prueba" }).click();
    await page.waitForURL(/\/suscripcion\/organizacion/);
    check("e1: paso 3 con «Crear una nueva organización»", await page.getByText("Crear una nueva organización").isVisible());
    await page.getByLabel("Nombre de la organización o clínica").fill("Clínica Prueba E2E");
    await page.locator("label", { hasText: /^Clínica$/ }).click();
    await page.getByLabel("Nombre del responsable").fill("Sofía Navarro");
    await page.getByLabel("Correo administrativo").fill("sofia@prueba-e2e.test");
    await page.getByLabel("Teléfono de contacto").fill("55 1234 5678");
    await page.getByRole("button", { name: "Continuar al resumen" }).click();
    await page.waitForURL(/\/suscripcion\/resumen/);
    check("e1: resumen con total anual", await page.getByText("$9,169.80").first().isVisible());
    check("e1: botón de pago deshabilitado sin aceptar términos", await page.getByRole("button", { name: /Continuar al pago/ }).isDisabled());
    await page.getByRole("checkbox", { name: /Acepto los términos/ }).check();
    await page.screenshot({ path: `${OUT}resumen.png` });
    await page.getByRole("button", { name: /Continuar al pago/ }).click();
    await page.waitForURL(/\/suscripcion\/pago/);
    check("e1: aviso de modo demostración", await page.getByText("Modo demostración. No se realizará ningún cargo.").isVisible());
    check("e1: sin campos de tarjeta", (await page.locator('input[autocomplete^="cc-"], input[name*="card" i]').count()) === 0);
    await page.screenshot({ path: `${OUT}pago.png` });
    await page.getByRole("button", { name: "Simular pago rechazado" }).click();
    await page.waitForURL(/\/suscripcion\/confirmacion/);
    check("e1: pago rechazado con mensaje claro", await page.getByRole("heading", { name: "No pudimos completar el pago" }).isVisible());
    await page.getByRole("link", { name: "Reintentar la simulación" }).click();
    await page.waitForURL(/\/suscripcion\/pago/);
    await page.getByRole("button", { name: /Simular pago aprobado/ }).click();
    await page.waitForURL(/\/suscripcion\/confirmacion/);
    check("e1: confirmación de bienvenida", await page.getByRole("heading", { name: "¡Bienvenido a Wattalis! Tu espacio de trabajo está listo." }).isVisible());
    await page.screenshot({ path: `${OUT}confirmacion.png` });
    await page.getByRole("button", { name: "Ir a mi espacio de trabajo" }).click();
    await page.waitForURL(/\/inicio/);
    await page.goto(`${BASE}/configuracion/suscripcion`);
    check("e1: suscripción activa en su clínica", (await page.getByRole("heading", { name: "Profesional" }).isVisible()) && (await page.getByText("Activa", { exact: true }).first().isVisible()));
    await page.screenshot({ path: `${OUT}mi-plan-nuevo.png`, fullPage: true });
    check("e1: sin errores de JS", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- Escenario 2: mejora Esencial → Profesional
  {
    const { ctx, page, errors } = await ctxAs("luis");
    await page.goto(`${BASE}/reportes/ventas`);
    await page.getByText(/El plan Esencial no incluye «Reportes financieros»/).waitFor();
    check("e2: reporte financiero bloqueado en Esencial", true);
    await page.goto(`${BASE}/configuracion/suscripcion`);
    await page.getByRole("button", { name: "Cambiar plan" }).click();
    const dialog = page.getByRole("dialog", { name: "Cambiar plan" });
    await dialog.locator("label", { hasText: "Profesional" }).click();
    await dialog.getByText(/Mejora: Esencial → Profesional/).waitFor();
    check("e2: vista previa con prorrateo y funciones nuevas", (await dialog.getByText(/Hoy se cobrará/).isVisible()) && (await dialog.getByText("Reportes financieros").isVisible()));
    await page.screenshot({ path: `${OUT}cambio-plan.png` });
    await dialog.getByRole("button", { name: "Confirmar cambio" }).click();
    await page.getByText(/tu espacio ya usa el plan Profesional/).waitFor();
    await page.goto(`${BASE}/reportes/ventas`);
    await page.getByRole("heading", { name: "Ventas por día" }).waitFor();
    await page.waitForLoadState("networkidle");
    check("e2: reporte financiero habilitado tras la mejora", (await page.getByText(/no incluye «Reportes financieros»/).count()) === 0);
    check("e2: sin errores de JS", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- Escenario 4: cancelación y reactivación (clínica)
  {
    const { ctx, page, errors } = await ctxAs("laura");
    await page.goto(`${BASE}/configuracion/suscripcion`);
    await page.getByRole("button", { name: "Cancelar renovación" }).click();
    const dialog = page.getByRole("dialog");
    check("e4: diálogo explica acceso e información", (await dialog.getByText(/Conservas el acceso hasta el/).isVisible()) && (await dialog.getByText("Tu información no se borra.").isVisible()));
    await page.screenshot({ path: `${OUT}cancelar.png` });
    await dialog.getByLabel("¿Nos cuentas por qué? (opcional)").selectOption({ index: 2 });
    await dialog.getByRole("button", { name: "Cancelar renovación" }).click();
    await page.getByText("La suscripción no se renovará").first().waitFor();
    check("e4: cancelación programada visible", true);
    await page.getByRole("button", { name: "Reactivar renovación" }).click();
    await page.getByText(/se renovará normalmente/).waitFor();
    check("e4: cancelación deshecha", (await page.getByRole("button", { name: "Cancelar renovación" }).count()) === 1);
    check("e4: sin errores de JS", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------------------------------------------------------------- Escenarios 3 y 5: plataforma
  {
    const { ctx, page, errors } = await ctxAs("plataforma");
    await page.goto(`${BASE}/admin/suscripciones`);
    check("e5: panel con MRR simulado", await page.getByText("MRR simulado", { exact: true }).isVisible());
    await page.screenshot({ path: `${OUT}admin.png` });
    const row = page.getByRole("row", { name: /Clínica Arboleda/ });
    const simulate = async (label, expect) => {
      await row.getByRole("combobox").selectOption({ label });
      await row.getByRole("button", { name: /Aplicar simulación/ }).click();
      await row.getByText(expect, { exact: true }).waitFor();
    };
    await simulate("Renovar (pago rechazado)", "Pago vencido");
    check("e3: renovación rechazada → pago vencido", true);
    await simulate("Reintentar cobro (rechazado)", "Periodo de gracia");
    check("e3: reintento rechazado → periodo de gracia", true);
    await simulate("Reintentar cobro (aprobado)", "Activa");
    check("e3: regularización → activa", true);
    check("e5: sin errores de JS", errors.length === 0, errors.join(" | "));
    await ctx.close();

    const m = await ctxAs("plataforma", { width: 390, height: 844 });
    await m.page.goto(`${BASE}/admin/suscripciones`);
    check("admin (teléfono): sin desplazamiento horizontal de página", await noHScroll(m.page));
    await m.ctx.close();
  }

  // ---------------------------------------------------------------- Accesibilidad básica en páginas clave
  {
    const { ctx, page } = await ctxAs("laura", { width: 390, height: 844 });
    for (const path of ["/configuracion/suscripcion", "/configuracion/facturacion", "/configuracion/suscripcion/metodos-de-pago", "/configuracion/suscripcion/renovacion", "/configuracion/suscripcion/avisos"]) {
      await page.goto(`${BASE}${path}`);
      const issues = await page.evaluate(() => {
        const unnamed = [...document.querySelectorAll("button, a[href]")].filter((el) => !(el.textContent?.trim() || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.querySelector("img[alt]")));
        const inputs = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((el) => {
          const id = el.id;
          return !(el.getAttribute("aria-label") || el.closest("label") || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)));
        });
        return { unnamed: unnamed.length, unlabeled: inputs.length, h1: document.querySelectorAll("h1").length, wide: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      check(`a11y ${path}`, issues.unnamed === 0 && issues.unlabeled === 0 && issues.h1 === 1 && !issues.wide, JSON.stringify(issues));
    }
    await page.goto(`${BASE}/configuracion/facturacion`);
    await page.screenshot({ path: `${OUT}facturacion-mobile.png`, fullPage: true });
    await ctx.close();
  }
} catch (error) {
  console.error("FALLO:", error.message);
  results.push({ name: "excepción", ok: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} verificaciones correctas`);
process.exit(failed ? 1 : 0);
