// ══════════════════════════════════════════════════════════════════════
// COTIZADOR DE TRANSPORTE — nodo "Code" de n8n (v2)
//
// Uso en n8n: pega el archivo completo en un nodo Code ("Run Once for All
// Items"). Al final del archivo, si existe $input, se ejecuta como nodo.
// Uso en pruebas: `require('./tarifa.js').calcularCotizacion(input)`.
//
// Qué incluye cada concepto:
//   - Renta (día / medio día / horas extra): chofer + viáticos.
//   - Combustible: aparte, km_totales / km_litro × diesel_price.
//     km_totales YA incluye el recorrido desde y hacia la pensión.
//   - Casetas: aparte, vienen como input (`casetas`).
//   - Aeropuerto (`aeropuerto: true`): se cotiza con la curva del operador
//     (mismas tarifas) + derecho de piso. Solo si el operador configura
//     `tarifas_traslado.tramos` se usa precio plano por tramo de km.
//   - VIP (`is_vip` + `vip_percentage`): recargo % sobre renta. Es la
//     perilla para ajustar precios de un operador (inflación, mercado caro).
// ══════════════════════════════════════════════════════════════════════

// ── DEFAULTS (el operador puede sobrescribir todo desde el input) ──────

// Tarifas por categoría si el operador no mandó `tarifas`. Tomadas de la
// tabla del operador de referencia (CDMX).
const TARIFAS_DEFAULT = {
  SEDAN:         { day1_rate_local: 1800,  min_rate_local: 1800,  day1_rate_foraneo: 2200,  min_rate_foraneo: 1800 },
  SUV:           { day1_rate_local: 2500,  min_rate_local: 2500,  day1_rate_foraneo: 3000,  min_rate_foraneo: 2500 },
  V250:          { day1_rate_local: 6000,  min_rate_local: 5500,  day1_rate_foraneo: 6000,  min_rate_foraneo: 5000 },
  DUCATO:        { day1_rate_local: 4500,  min_rate_local: 4500,  day1_rate_foraneo: 4500,  min_rate_foraneo: 4000 },
  VAN:           { day1_rate_local: 5500,  min_rate_local: 5500,  day1_rate_foraneo: 7000,  min_rate_foraneo: 4500 },
  MINIBUS:       { day1_rate_local: 9500,  min_rate_local: 9500,  day1_rate_foraneo: 13000, min_rate_foraneo: 6000 },
  LARGE_BUS:     { day1_rate_local: 14000, min_rate_local: 14000, day1_rate_foraneo: 18000, min_rate_foraneo: 9000 },
};
TARIFAS_DEFAULT.MIDSIZE_BUS   = TARIFAS_DEFAULT.LARGE_BUS;
TARIFAS_DEFAULT.DOUBLE_DECKER = TARIFAS_DEFAULT.LARGE_BUS;

// Derecho de piso: se mantiene el valor más alto de referencia (decisión
// tomada). SEDAN y SUV no pagan.
const DERECHO_PISO_DEFAULT = {
  SEDAN: 0, SUV: 0,
  DUCATO: 597, V250: 597, VAN: 597,
  MINIBUS: 1100, MIDSIZE_BUS: 1100, LARGE_BUS: 1100, DOUBLE_DECKER: 1100,
};

// Tramos de traslado plano por km totales (pensión → origen → destino →
// pensión). Precios del operador de referencia: ≤55km y ≤130km.
const TRAMOS_TRASLADO_DEFAULT = [
  {
    km_max: 55,
    precio: { SEDAN: 1200, SUV: 1500, DUCATO: 2700, V250: 3000, VAN: 3400, MINIBUS: 6000, LARGE_BUS: 8000 },
    derecho_piso: DERECHO_PISO_DEFAULT,
    estacionamiento: {},
  },
  {
    km_max: 130,
    precio: { SEDAN: 3500, SUV: 4000, DUCATO: 4500, V250: 4500, VAN: 4700, MINIBUS: 8500, LARGE_BUS: 11000 },
    derecho_piso: DERECHO_PISO_DEFAULT,
    estacionamiento: { SEDAN: 80, SUV: 80 },
  },
];

const RECARGO_TRASLADO_DEFAULT = { km_max: 145, porcentaje: 10 };

// Curva dentro del día (servicios < 24h). Todos se pueden mandar por
// categoría dentro de `tarifas` o a nivel raíz del input. Los defaults
// reproducen el comportamiento original (mínimo = medio día).
//   precio(h) = h ≤ horas_minimo        → day1 × pct_minimo
//               h < horas_dia_completo  → sube lineal por hora hasta day1
//               h ≤ hours_per_day       → day1
//               h > hours_per_day       → day1 + horas extra × day1/hours_per_day
const CONFIG_DEFAULT = {
  hours_per_day: 15,          // horas incluidas en un día de servicio
  pct_minimo: 50,             // % de day1 que cuesta el servicio mínimo
  horas_minimo: null,         // horas que cubre el mínimo (null = hours_per_day / 2)
  horas_dia_completo: null,   // desde cuántas horas se cobra day1 (null = hours_per_day)
  dia_tarifa_minima: 4,       // día en que la curva llega a min_rate
  hora_salida_temprano: '05:00', // salida antes de esto → +medio día
  hora_llegada_tarde: '19:00',   // llegada después de esto → +medio día
};

// ── HELPERS ───────────────────────────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

function num(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizarCategoria(cat) {
  const c = String(cat || '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (c.includes('DOUBLE'))                          return 'DOUBLE_DECKER';
  if (c.includes('MINIBUS'))                         return 'MINIBUS';
  if (c.includes('MIDSIZE') || c.includes('MID'))    return 'MIDSIZE_BUS';
  if (c.includes('AUTOBUS') || c.includes('BUS'))    return 'LARGE_BUS';
  if (c.includes('SPRINTER') || c.includes('VAN'))   return 'VAN';
  if (c.includes('SUV'))                             return 'SUV';
  if (c.includes('SEDAN') || c.includes('MEDIANO'))  return 'SEDAN';
  if (c.includes('DUCATO'))                          return 'DUCATO';
  if (c.includes('V250'))                            return 'V250';
  return null;
}

// "HH:MM" → horas decimales. Devuelve null si el formato no es válido.
function timeToHours(timeStr) {
  const m = /^\s*(\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*$/.exec(String(timeStr ?? ''));
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h + min / 60;
}

function precioCategoria(tabla, catNorm) {
  if (!tabla) return null;
  if (tabla[catNorm] != null) return num(tabla[catNorm], null);
  if ((catNorm === 'MIDSIZE_BUS' || catNorm === 'DOUBLE_DECKER') && tabla.LARGE_BUS != null) {
    return num(tabla.LARGE_BUS, null);
  }
  return null;
}

// `tarifas` puede venir plana ({ day1_rate_local, ... }) o como mapa por
// categoría ({ "SUV": {...}, "Sprinter": {...} }) con los nombres del select.
function resolverTarifas(raw, catNorm) {
  if (!raw || typeof raw !== 'object') return {};
  if ('day1_rate_local' in raw || 'min_rate_local' in raw || 'day1_rate_foraneo' in raw) return raw;
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && normalizarCategoria(k) === catNorm) return v;
  }
  return {};
}

// Traslado plano: primer tramo cuyo km_max cubra la distancia.
function calcularTrasladoPlano(km, catNorm, tramos, recargo) {
  const ordenados = [...tramos].sort((a, b) => a.km_max - b.km_max);
  for (const tramo of ordenados) {
    if (km <= tramo.km_max) {
      const precio = precioCategoria(tramo.precio, catNorm);
      if (precio == null) return null;
      return {
        precio,
        derecho_piso: precioCategoria(tramo.derecho_piso, catNorm) || 0,
        estacionamiento: precioCategoria(tramo.estacionamiento, catNorm) || 0,
        km_max_tramo: tramo.km_max,
        recargo_pct: 0,
      };
    }
  }
  const ultimo = ordenados[ordenados.length - 1];
  if (ultimo && recargo && km <= recargo.km_max) {
    const precio = precioCategoria(ultimo.precio, catNorm);
    if (precio == null) return null;
    return {
      precio,
      derecho_piso: precioCategoria(ultimo.derecho_piso, catNorm) || 0,
      estacionamiento: precioCategoria(ultimo.estacionamiento, catNorm) || 0,
      km_max_tramo: recargo.km_max,
      recargo_pct: num(recargo.porcentaje),
    };
  }
  return null;
}

// ── CÁLCULO PRINCIPAL ─────────────────────────────────────────────────

function calcularCotizacion(input) {
  input = input || {};
  const warnings = [];

  const empresa_id  = input.empresa_id ?? input.id_empresa;
  const vehiculo_id = input.vehiculo_id ?? input.vehicle;
  const categoria   = input.categoria;

  let horas_servicio = num(input.horas_servicio);
  const km_totales   = Math.max(0, num(input.km_totales));
  const km_foraneo   = num(input.km_foraneo, 100);
  const diesel_price = Math.max(0, num(input.diesel_price));
  const km_litro     = Math.max(0, num(input.km_litro));
  const casetas      = Math.max(0, num(input.casetas));

  const diaTarifaMinima = Math.max(1, Math.round(num(input.dia_tarifa_minima, CONFIG_DEFAULT.dia_tarifa_minima)));

  const is_vip         = !!input.is_vip;
  const vip_percentage = Math.max(0, num(input.vip_percentage));
  const vipFactor      = is_vip && vip_percentage > 0 ? 1 + vip_percentage / 100 : 1;
  if (is_vip && !(vip_percentage > 0)) {
    warnings.push('is_vip=true pero vip_percentage vacío o 0: no se cobró recargo VIP.');
  }

  if (horas_servicio <= 0) {
    warnings.push(`horas_servicio inválido (${input.horas_servicio}); se cobra el mínimo.`);
    horas_servicio = 0;
  }

  let horaInicio = timeToHours(input.hora_inicio);
  if (horaInicio == null) {
    if (input.hora_inicio != null && input.hora_inicio !== '') {
      warnings.push(`hora_inicio inválida ("${input.hora_inicio}"); se asume 08:00.`);
    }
    horaInicio = 8;
  }
  if (horaInicio === 24) horaInicio = 0;

  // ── Categoría ──
  let catNorm = normalizarCategoria(categoria);
  if (!catNorm) {
    warnings.push(`Categoría desconocida "${categoria}"; se cotiza como VAN.`);
    catNorm = 'VAN';
  }

  // ── Tarifas ──
  const tRoot = input.tarifas && typeof input.tarifas === 'object' ? input.tarifas : {};
  const t = resolverTarifas(input.tarifas, catNorm);
  // Parámetro: primero el de la categoría, luego raíz del input, luego default.
  const param = (k, def) => num(t[k], null) ?? num(input[k], null) ?? def;
  const campos = ['day1_rate_local', 'min_rate_local', 'day1_rate_foraneo', 'min_rate_foraneo'];
  const faltantes = campos.filter(k => !(num(t[k], null) > 0));
  const tarifasFallback = faltantes.length > 0;
  if (tarifasFallback) {
    warnings.push(`Tarifas faltantes (${faltantes.join(', ')}); se usan defaults de ${catNorm}.`);
  }
  const base = TARIFAS_DEFAULT[catNorm];
  const tarifas = {};
  for (const k of campos) tarifas[k] = num(t[k], null) > 0 ? num(t[k]) : base[k];

  if (tarifas.day1_rate_foraneo < tarifas.day1_rate_local) {
    warnings.push('day1_rate_foraneo menor que day1_rate_local: un viaje foráneo puede salir más barato que uno local.');
  }

  // ── Clasificación ──
  const esForaneo = km_totales >= km_foraneo;
  let day1Rate = esForaneo ? tarifas.day1_rate_foraneo : tarifas.day1_rate_local;
  let minRate  = esForaneo ? tarifas.min_rate_foraneo  : tarifas.min_rate_local;
  if (minRate > day1Rate) {
    warnings.push('min_rate mayor que day1_rate; se usa day1_rate como mínimo.');
    minRate = day1Rate;
  }
  day1Rate = r2(day1Rate);
  minRate  = r2(minRate);
  // Curva dentro del día
  let hours_per_day = param('hours_per_day', CONFIG_DEFAULT.hours_per_day);
  if (!(hours_per_day > 0) || hours_per_day > 24) hours_per_day = CONFIG_DEFAULT.hours_per_day;
  const pctMinimo  = Math.min(100, Math.max(0, param('pct_minimo', CONFIG_DEFAULT.pct_minimo))) / 100;
  const horasMin   = Math.min(hours_per_day, Math.max(0, param('horas_minimo', hours_per_day / 2)));
  const horasDia   = Math.min(hours_per_day, Math.max(horasMin, param('horas_dia_completo', hours_per_day)));
  const medioDia   = r2(day1Rate / 2);
  const minimo     = r2(day1Rate * pctMinimo);
  const tarifaHora = r2(day1Rate / hours_per_day);                       // hora extra después del día
  const tarifaSubida = horasDia > horasMin ? (day1Rate - minimo) / (horasDia - horasMin) : 0; // hora entre mínimo y día

  // Curva por día: día 1 = day1Rate, baja lineal hasta minRate en el día
  // `diaTarifaMinima`. Cada día se cobra a SU tarifa (se suman).
  function tarifaDia(d) {
    if (d >= diaTarifaMinima || diaTarifaMinima === 1) return minRate;
    const f = (d - 1) / (diaTarifaMinima - 1);
    return r2(day1Rate - f * (day1Rate - minRate));
  }

  // ── Traslado plano ──
  const aeropuerto = !!input.aeropuerto;
  const cobraDerechoPiso = input.cobra_derecho_piso != null ? !!input.cobra_derecho_piso : aeropuerto;
  const cfgTraslado = input.tarifas_traslado || {};
  const tramosCfg = Array.isArray(cfgTraslado.tramos) && cfgTraslado.tramos.length ? cfgTraslado.tramos : null;
  let esTrasladoPlano = aeropuerto && !!tramosCfg;
  let pisoTraslado = 0;
  let estacionamientoFallback = 0;
  let plano = null;
  if (esTrasladoPlano) {
    const tramos  = tramosCfg;
    const recargo = cfgTraslado.recargo_tramo !== undefined ? cfgTraslado.recargo_tramo : RECARGO_TRASLADO_DEFAULT;
    if (km_totales > 0) plano = calcularTrasladoPlano(km_totales, catNorm, tramos, recargo);
    if (!plano) {
      esTrasladoPlano = false;
      warnings.push(`Traslado plano no aplica (km_totales=${km_totales}, ${catNorm}); se cotiza como renta normal.`);
      // Un traslado más largo nunca debe costar menos que el tramo plano
      // más caro: ese precio queda como piso de renta + combustible.
      const ultimo = [...tramos].sort((a, b) => a.km_max - b.km_max).pop();
      const precioUltimo = ultimo && precioCategoria(ultimo.precio, catNorm);
      if (precioUltimo != null && km_totales > ultimo.km_max) {
        const recPct = recargo && km_totales > ultimo.km_max ? num(recargo.porcentaje) : 0;
        pisoTraslado = r2(precioUltimo * (1 + recPct / 100));
        estacionamientoFallback = precioCategoria(ultimo.estacionamiento, catNorm) || 0;
      }
    }
  }

  // ── Horario ──
  const horaFinAbs = horaInicio + horas_servicio;           // horas desde las 00:00 del día 1
  const cruzaMedianoche = horaFinAbs > 24;
  const horaFinDia = horaFinAbs - Math.floor((horaFinAbs - 1e-9) / 24) * 24; // (0,24]
  // Límites de horario. En viajes de varios días se aplican siempre (con
  // default 05:00 / 19:00). En servicios de un día solo si el operador los
  // configuró: ahí las horas extra ya pagan el tiempo adicional.
  const limTempranoCfg = input.early_departure_limit ?? t.early_departure_limit ?? tRoot.early_departure_limit;
  const limTardeCfg    = input.late_arrival_limit    ?? t.late_arrival_limit    ?? tRoot.late_arrival_limit;

  const esItinerario = !esTrasladoPlano && horas_servicio >= 24;

  const limTemprano = timeToHours(limTempranoCfg ?? (esItinerario ? CONFIG_DEFAULT.hora_salida_temprano : null));
  const limTarde    = timeToHours(limTardeCfg    ?? (esItinerario ? CONFIG_DEFAULT.hora_llegada_tarde : null));
  const salidaTemprano = limTemprano != null && horaInicio < limTemprano;
  const llegadaTarde   = limTarde != null && horas_servicio > 0 && (horaFinDia > limTarde || (!esItinerario && cruzaMedianoche));

  // ── Renta ──
  let costoRenta = 0;
  let penalizacion = 0;
  const motivos = [];
  let desgloseDias = [];
  let bloqueLabel = '';
  let horasExtra = 0, costoHorasExtra = 0;
  let diasCobrados = 0;

  if (esTrasladoPlano) {
    const recargoMonto = r2(plano.precio * plano.recargo_pct / 100);
    costoRenta = r2(plano.precio + recargoMonto);
    plano.recargo_monto = recargoMonto;
    bloqueLabel = `Traslado plano (≤${plano.km_max_tramo}km)` + (plano.recargo_pct ? ` + recargo ${plano.recargo_pct}%` : '');
    desgloseDias.push({ dia: 1, tarifa: costoRenta, tipo: 'traslado plano' });

  } else if (esItinerario) {
    // Días de calendario (inclusivo) + medio día por salida temprano y
    // medio día por llegada tarde. Ej: 2 ene 02:00 → 6 ene 13:00 = 5.5.
    const diasCalendario = Math.floor((horaFinAbs - 1e-9) / 24) + 1;
    for (let d = 1; d <= diasCalendario; d++) {
      const tar = tarifaDia(d);
      desgloseDias.push({ dia: d, tarifa: tar, tipo: 'día completo' });
      costoRenta += tar;
    }
    costoRenta = r2(costoRenta);
    const medioSiguiente = r2(tarifaDia(diasCalendario + 1) / 2);
    if (salidaTemprano) { penalizacion += medioSiguiente; motivos.push('Salida anticipada'); }
    if (llegadaTarde)   { penalizacion += medioSiguiente; motivos.push('Llegada tarde'); }
    diasCobrados = diasCalendario + 0.5 * motivos.length;
    bloqueLabel = `${horas_servicio}h → ${diasCobrados} día(s)`;

  } else {
    // Servicio de un día (menos de 24h): curva mínimo → día completo → extras
    if (horas_servicio <= horasMin) {
      costoRenta = minimo;
      bloqueLabel = `${horas_servicio}h → mínimo (${Math.round(pctMinimo * 100)}% del día, hasta ${horasMin}h)`;
      desgloseDias.push({ dia: 1, tarifa: minimo, tipo: 'mínimo' });
    } else if (horas_servicio < horasDia) {
      const extra = Math.ceil(horas_servicio - horasMin - 1e-9);
      const sinTope = r2(minimo + extra * tarifaSubida);
      if (sinTope >= day1Rate) {
        costoRenta = day1Rate;
        bloqueLabel = `${horas_servicio}h → día completo`;
        desgloseDias.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
      } else {
        costoRenta = sinTope;
        horasExtra = extra;
        costoHorasExtra = r2(sinTope - minimo);
        bloqueLabel = `${horas_servicio}h → mínimo + ${extra}h`;
        desgloseDias.push({ dia: 1, tarifa: minimo, tipo: 'mínimo' });
        desgloseDias.push({ dia: 1, tarifa: costoHorasExtra, tipo: `${extra}h adicionales` });
      }
    } else if (horas_servicio <= hours_per_day) {
      costoRenta = day1Rate;
      bloqueLabel = `${horas_servicio}h → día completo`;
      desgloseDias.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
    } else {
      // Más de un día de servicio: día completo + cada hora extra
      // Tope: las horas extra nunca cuestan más que el día 2 (si no, 23h
      // saldría más caro que un itinerario de 24h).
      horasExtra = Math.ceil(horas_servicio - hours_per_day - 1e-9);
      costoHorasExtra = Math.min(r2(horasExtra * tarifaHora), tarifaDia(2));
      costoRenta = r2(day1Rate + costoHorasExtra);
      bloqueLabel = `${horas_servicio}h → día completo + ${horasExtra}h extra`;
      desgloseDias.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
      desgloseDias.push({ dia: 1, tarifa: costoHorasExtra, tipo: `${horasExtra}h extra` });
    }
    // (llegadaTarde ya considera cruzar la medianoche)
    if (salidaTemprano) { penalizacion += medioDia; motivos.push('Salida anticipada'); }
    if (llegadaTarde)   { penalizacion += medioDia; motivos.push('Llegada tarde'); }
    diasCobrados = r2((day1Rate > 0 ? costoRenta / day1Rate : 1) + 0.5 * motivos.length);
  }

  // ── Combustible (no aplica en traslado plano: ya viene en el precio) ──
  let litros = 0, costoCombustible = 0;
  if (!esTrasladoPlano && km_totales > 0) {
    if (diesel_price > 0 && km_litro > 0) {
      litros = r2(km_totales / km_litro);
      costoCombustible = Math.round(litros * diesel_price);
    } else {
      warnings.push('Falta diesel_price o km_litro: combustible no cotizado.');
    }
  }

  // ── VIP (sobre renta + penalización) ──
  let vipCosto = r2((costoRenta + penalizacion) * (vipFactor - 1));

  // ── Piso de traslado largo (ver arriba) ──
  // Se compara incluyendo VIP para que el traslado plano con VIP tampoco
  // quede por encima de un traslado más largo con VIP.
  let ajustePisoTraslado = 0;
  if (pisoTraslado > 0) {
    const actual = (costoRenta + penalizacion) * vipFactor + costoCombustible;
    const objetivo = pisoTraslado * vipFactor;
    if (actual < objetivo) {
      ajustePisoTraslado = r2((objetivo - actual) / vipFactor);
      costoRenta = r2(costoRenta + ajustePisoTraslado);
      vipCosto = r2((costoRenta + penalizacion) * (vipFactor - 1));
      bloqueLabel += ` (ajustado al mínimo de traslado $${pisoTraslado})`;
    }
  }

  // ── Derecho de piso y estacionamiento ──
  let costoDerechoPiso = 0, costoEstacionamiento = 0;
  if (cobraDerechoPiso) {
    // Del operador: `derecho_piso` o el mayor de sus airport_floor_fee_*.
    const fees = Object.keys(t).filter(k => k === 'derecho_piso' || k.startsWith('airport_floor_fee'))
      .map(k => num(t[k], null)).filter(v => v != null && v >= 0);
    costoDerechoPiso = esTrasladoPlano ? plano.derecho_piso
      : fees.length ? Math.max(...fees)
      : (precioCategoria(DERECHO_PISO_DEFAULT, catNorm) || 0);
  }
  costoEstacionamiento = esTrasladoPlano ? plano.estacionamiento : estacionamientoFallback;

  const total = Math.round(
    costoRenta + penalizacion + vipCosto + costoCombustible + casetas + costoDerechoPiso + costoEstacionamiento
  );

  for (const w of warnings) console.log('⚠️ ' + w);

  return {
    empresa_id,
    vehiculo_id,
    categoria: catNorm,
    es_itinerario: esItinerario,
    es_foraneo: esForaneo,
    horas_servicio,
    dias_cobrados: diasCobrados,

    traslado_plano_aplica: esTrasladoPlano,
    traslado_plano_km_max: plano && esTrasladoPlano ? plano.km_max_tramo : null,
    traslado_plano_recargo_pct: plano && esTrasladoPlano ? plano.recargo_pct : 0,
    traslado_plano_recargo_monto: plano && esTrasladoPlano ? plano.recargo_monto : 0,

    renta_bloque: bloqueLabel,
    renta_desglose: desgloseDias,
    renta_day1_rate: esTrasladoPlano ? null : day1Rate,
    renta_min_rate: esTrasladoPlano ? null : minRate,
    renta_medio_dia: esTrasladoPlano ? null : medioDia,
    renta_minimo: esTrasladoPlano ? null : minimo,
    renta_curva: esTrasladoPlano ? null : { pct_minimo: Math.round(pctMinimo * 100), horas_minimo: horasMin, horas_dia_completo: horasDia, hours_per_day },
    renta_tarifa_hora: esTrasladoPlano ? null : tarifaHora,
    renta_horas_extra: horasExtra,
    renta_costo_horas_extra: costoHorasExtra,
    renta_es_vip: is_vip,
    renta_vip_porcentaje: vip_percentage,
    renta_vip_costo: vipCosto,
    renta_subtotal: Math.round(costoRenta + vipCosto),

    combustible_km: costoCombustible ? km_totales : 0,
    combustible_km_litro: costoCombustible ? km_litro : 0,
    combustible_litros: litros,
    combustible_precio_litro: costoCombustible ? diesel_price : 0,
    combustible_subtotal: costoCombustible,

    casetas_subtotal: casetas,

    penalizacion_motivo: motivos.join('. '),
    penalizacion_costo: Math.round(penalizacion),

    aeropuerto_aplica: aeropuerto,
    aeropuerto_costo: costoDerechoPiso,
    estacionamiento_costo: costoEstacionamiento,

    segundo_conductor_costo: 0,
    segundo_conductor_costo_ref: num(t.second_driver_cost ?? tRoot.second_driver_cost),

    tarifas_fallback_usado: tarifasFallback,
    warnings,

    total,
  };
}

// ── Exportar para pruebas / ejecutar como nodo n8n ─────────────────────
if (typeof $input === 'undefined') {
  module.exports = { calcularCotizacion, normalizarCategoria, timeToHours, TARIFAS_DEFAULT, TRAMOS_TRASLADO_DEFAULT };
  return;
}
const raw = $input.first().json;
return [{ json: calcularCotizacion(raw.body || raw) }];
