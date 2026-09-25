# Cotizador de transporte (nodo Code de n8n)

- `tarifa.js`: pega el archivo completo en un nodo **Code** de n8n. También se puede usar con `require` en pruebas.
- `tarifa.test.js`: pruebas. Se corren con `node --test cotizador/tarifa.test.js`.

## Reglas de cálculo

| Concepto | Regla |
|---|---|
| Local / foráneo | `km_totales >= km_foraneo` es foráneo. `km_totales` incluye la ida y vuelta a la pensión. |
| Servicio ≤ `hours_per_day / 2` | medio día (`day1 / 2`) |
| Hasta `hours_per_day` | medio día + horas extra; nunca pasa de `day1` |
| Más de `hours_per_day` (menos de 24h) | `day1` + **cada** hora extra a `day1 / hours_per_day` |
| Varios días (≥ 24h) | días de calendario (inclusivo), cada día a su tarifa: baja en línea recta de `day1` a `min` y llega a `min` en el día `dia_tarifa_minima` (default 4) |
| Medio día extra | varios días: salida antes de las 05:00 y/o llegada después de las 19:00 (+½ día cada una). Un día: solo si el operador configuró `early_departure_limit` / `late_arrival_limit`. |
| Combustible | `km_totales / km_litro × diesel_price`, en local y foráneo. No se cobra en traslado plano. |
| Casetas | input `casetas`, se suma tal cual |
| Traslado plano (`aeropuerto: true`) | precio fijo por tramo de km (default ≤55 km y ≤130 km, +10% hasta 145 km) + derecho de piso + estacionamiento. Más allá del último tramo se cotiza como renta normal, pero nunca por debajo del último tramo. |
| VIP | `% × (renta + penalización)` |
| `ajuste_pct` | un solo % por operador/vehículo; escala tarifas por día y traslados planos. No toca combustible, casetas ni derecho de piso. |
| Tarifas faltantes | se usan los defaults **de la categoría** (`TARIFAS_DEFAULT`), no un monto fijo |

## Inputs nuevos (todos opcionales)

`casetas`, `ajuste_pct`, `dia_tarifa_minima`, `cobra_derecho_piso`, `early_departure_limit`, `late_arrival_limit`, `tarifas_traslado: { tramos: [...], recargo_tramo: {...} }`.

## Outputs nuevos

`dias_cobrados`, `renta_desglose`, `casetas_subtotal`, `estacionamiento_costo`, `ajuste_pct`, `tarifas_fallback_usado`, `warnings[]`. Los campos que ya existían se conservan.
