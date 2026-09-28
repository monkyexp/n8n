# Cotizador de transporte (nodo Code de n8n)

- `tarifa.js`: pega el archivo completo en un nodo **Code** de n8n. También se puede usar con `require` en pruebas.
- `tarifa.test.js`: pruebas. Se corren con `node --test cotizador/tarifa.test.js`.
- `tarifas-estandar.json`: **tarifa estándar** (base barata) con los nombres del select. Es la que usa el código cuando el operador no manda las suyas.
- `operador-premium.json`: configuración del operador caro de CDMX. Son las mismas tarifas estándar, solo cambian `pct_minimo` y `hours_per_day`, y lleva el **VIP por categoría** que va en la tabla de vehículos. V250, Minibús y Autobús tienen VIP estimado, porque no hay datos reales.

## Cómo se ajusta un operador

1. Empieza con la tarifa estándar.
2. Sube o baja sus precios con **VIP** (`is_vip` + `vip_percentage` en la tabla de vehículos).
3. Solo si sus traslados cortos no cuadran, ajusta `pct_minimo` por categoría.

## Reglas de cálculo

| Concepto | Regla |
|---|---|
| Local / foráneo | `km_totales >= km_foraneo` es foráneo. `km_totales` incluye la ida y vuelta a la pensión. |
| Servicio ≤ `horas_minimo` (3h) | mínimo = `day1 × pct_minimo` |
| Hasta `horas_dia_completo` (estándar 8h) | sube en línea recta por hora (redondeando hacia arriba) hasta `day1` |
| Hasta `hours_per_day` | `day1` |
| Más de `hours_per_day` (menos de 24h) | `day1` + cada hora extra a `day1 / hours_per_day` (tope: tarifa del día 2) |
| Varios días (≥ 24h) | días de calendario (inclusivo), cada día a su tarifa: baja en línea recta de `day1` a `min` y llega a `min` en el día 4 |
| Medio día extra | varios días: salida antes de las 05:00 y/o llegada después de las 19:00 (+½ día cada una). Un día: solo si el operador configuró `early_departure_limit` / `late_arrival_limit`. |
| Foráneo contra local | un viaje foráneo nunca cobra menos renta que el mismo viaje en local (`regla_minimo_local`). Si la tarifa foránea es menor que la local, sale un aviso en `warnings`. |
| Combustible | siempre: `km_totales / km_litro × diesel_price` |
| Casetas | input `casetas`, se suma tal cual |
| Aeropuerto (`aeropuerto: true`) | se cotiza como cualquier viaje (horas + km) y se suma el derecho de piso: `derecho_piso` o el mayor `airport_floor_fee_*` de la categoría; si no hay, la tabla default. No usa nombres de aeropuertos. |
| Traslado plano | opcional, solo si el operador manda `tarifas_traslado.tramos` (ver `TRAMOS_TRASLADO_EJEMPLO`) |
| VIP | `% × (renta + penalización)`. No toca combustible, casetas ni derecho de piso. |
| Aeropuerto ≤ 145 km | se cobra con tarifa **local** (es traslado, no viaje foráneo). Configurable: `km_foraneo_aeropuerto`. |
| Hospedaje del conductor | viajes foráneos de varios días: `hospedaje_noche` × noches (default: solo Sprinter, $800). `es_festivo: true` lo quita, porque el cliente paga el hospedaje. |
| Segundo conductor | más de 12h (`horas_max_conductor`) en un servicio de un día: `segundo_conductor_requerido = true`. Cobra `second_driver_cost` si el operador lo configuró; si no, solo avisa. |

## Inputs

- `tarifas`: puede venir plana (`{ day1_rate_local, ... }`) o como mapa por categoría con los nombres del select (`{ "SUV": {...} }`).
- Parámetros de la curva, por categoría o en la raíz del input: `pct_minimo`, `horas_minimo`, `horas_dia_completo`, `hours_per_day`, `dia_tarifa_minima`.
- Aeropuerto: `aeropuerto: true`, `recogida_aeropuerto: true`, o `punto_encuentro` con la dirección de recogida (si contiene "aeropuerto/airport" se cobra derecho de piso). Dejar a alguien en el aeropuerto no paga piso.
- Si llega el vehículo con `itinerario` anidado, también se leen `itinerario.recogida_aeropuerto`, `itinerario.dias_detalle[0].metadata.punto_encuentro` e `itinerario.horas_manejo_totales`.
- Segundo conductor: manda `horas_manejo_totales` (o `horas_manejo_dia`) para medir horas de manejo reales en vez de horas de servicio.
- Opcionales: `casetas`, `es_festivo`, `hospedaje_noche`, `km_foraneo_aeropuerto`, `horas_max_conductor`, `second_driver_cost`, `cobra_derecho_piso`, `early_departure_limit`, `late_arrival_limit`, `tarifas_traslado`.
- Alias aceptados: `id_empresa` / `vehicle` = `empresa_id` / `vehiculo_id`.

## Pendiente

- City tours de varios días: por ahora el total de km puede volverlos foráneos. Se resuelve cuando el front divida la cotización por día.
