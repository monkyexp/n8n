# Cotizador de transporte (nodo Code de n8n)

- `tarifa.js`: pega el archivo completo en un nodo **Code** de n8n. También se puede usar con `require` en pruebas.
- `tarifa.test.js`: pruebas. Se corren con `node --test cotizador/tarifa.test.js`.
- `tarifas-cliente-premium.json`: tarifas ajustadas a precios reales de un operador caro de CDMX. V250, Minibús y Autobús están marcados `_estimado` porque no hay datos reales de esas categorías.

## Reglas de cálculo

| Concepto | Regla |
|---|---|
| Local / foráneo | `km_totales >= km_foraneo` es foráneo. `km_totales` incluye la ida y vuelta a la pensión. |
| Servicio ≤ `horas_minimo` | mínimo = `day1 × pct_minimo` |
| Hasta `horas_dia_completo` | sube en línea recta por hora (redondeando hacia arriba) hasta `day1` |
| Hasta `hours_per_day` | `day1` |
| Más de `hours_per_day` (menos de 24h) | `day1` + **cada** hora extra a `day1 / hours_per_day` (tope: tarifa del día 2) |
| Varios días (≥ 24h) | días de calendario (inclusivo), cada día a su tarifa: baja en línea recta de `day1` a `min` y llega a `min` en el día `dia_tarifa_minima` (default 4) |
| Medio día extra | varios días: salida antes de las 05:00 y/o llegada después de las 19:00 (+½ día cada una). Un día: solo si el operador configuró `early_departure_limit` / `late_arrival_limit`. |
| Combustible | `km_totales / km_litro × diesel_price`, en local y foráneo. No se cobra en traslado plano. |
| Casetas | input `casetas`, se suma tal cual |
| Aeropuerto (`aeropuerto: true`) | la misma curva del operador + combustible + derecho de piso (`derecho_piso` o el mayor `airport_floor_fee_*` de la categoría; si no hay, la tabla default). |
| Traslado plano | solo si el operador manda `tarifas_traslado.tramos`: precio fijo por tramo de km + derecho de piso + estacionamiento. Más allá del último tramo se cotiza normal, pero nunca por debajo del último tramo. |
| VIP | `% × (renta + penalización)`. Es la forma de ajustar precios por operador (inflación, mercado caro). No toca combustible, casetas ni derecho de piso. |
| Tarifas faltantes | se usan los defaults **de la categoría** (`TARIFAS_DEFAULT`), no un monto fijo |

## Inputs

- `tarifas` puede venir **plana** (`{ day1_rate_local, ... }`) o como **mapa por categoría** con los nombres del select (`{ "SUV": {...}, "Sprinter": {...} }`).
- Parámetros de la curva: `pct_minimo` (default 50), `horas_minimo` (default `hours_per_day/2`), `horas_dia_completo` (default `hours_per_day`) y `hours_per_day` (default 15). Se pueden mandar por categoría dentro de `tarifas` o en la raíz del input. Con los defaults, el mínimo es medio día, como antes.
- Opcionales: `casetas`, `dia_tarifa_minima`, `cobra_derecho_piso`, `early_departure_limit`, `late_arrival_limit`, `tarifas_traslado: { tramos: [...], recargo_tramo: {...} }`.
- Se aceptan `id_empresa` / `vehicle` como alias de `empresa_id` / `vehiculo_id`.

## Outputs nuevos

`dias_cobrados`, `renta_desglose`, `renta_minimo`, `renta_curva`, `casetas_subtotal`, `estacionamiento_costo`, `tarifas_fallback_usado`, `warnings[]`. Los campos que ya existían se conservan.
