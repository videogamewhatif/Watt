# Recorrido E2E de suscripciones (opcional)

Verifica en un navegador real los cinco escenarios de `docs/SUSCRIPCIONES.md`, la página de precios en teléfono (sin desplazamiento horizontal) y controles con nombre/etiqueta en «Suscripción y facturación». Usa el modo de prueba, así que no necesita Supabase, AWS ni Stripe. Al empezar pulsa «Reiniciar datos».

```bash
npm run dev                                   # en otra terminal
npm i --no-save playwright-core && npx playwright-core install chromium
node tests/e2e/suscripciones.e2e.mjs          # E2E_BASE_URL=http://localhost:3000 por omisión
```

Variables opcionales: `E2E_BASE_URL` (otra URL o puerto) y `CHROMIUM_PATH` (un Chromium ya instalado). Las capturas quedan en `.tmp/e2e/` (ignorado por git).
