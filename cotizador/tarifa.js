// ══════════════════════════════════════════════════════════════════════
// COTIZADOR DE TRANSPORTE — nodo "Code" de n8n (v4)
//
// Uso en n8n: pega el archivo completo en un nodo Code. Al final, si existe
// $input, se ejecuta como nodo. En pruebas: require('./tarifa.js').
//
// Qué incluye cada concepto:
//   - Renta: chofer + viáticos. Sale de la curva del operador (abajo).
//   - Combustible: SIEMPRE aparte = km_totales / km_litro × diesel_price.
//     km_totales ya incluye ida y vuelta a la pensión.
//   - Casetas: aparte, input `casetas`.
//   - Aeropuerto (`aeropuerto: true`): se cotiza igual que cualquier viaje
//     (horas + km) y se suma el derecho de piso. Sin nombres de aeropuertos:
//     funciona en cualquier ciudad. Tramos planos por km solo si el operador
//     los configura en `tarifas_traslado.tramos`.
//   - VIP (`is_vip` + `vip_percentage`, de la tabla de vehículos): % sobre la
//     renta. Es la perilla para subir los precios de un operador sobre la
//     tarifa estándar. No toca combustible, casetas ni derecho de piso.
//   - Regla: un viaje foráneo nunca cobra menos renta que el mismo viaje
//     cotizado como local.
//   - Aeropuerto hasta `km_foraneo_aeropuerto` (145 km con pensión) se cobra
//     con tarifa local: es un traslado, no un viaje foráneo.
//   - Hospedaje del conductor: `hospedaje_noche` × noches fuera en viajes
//     foráneos de varios días (default solo Sprinter $800). `es_festivo: true`
//     lo quita (el cliente paga el hospedaje).
//   - Segundo conductor: más de `horas_max_conductor` (12h) seguidas lo
//     requiere; se cobra `second_driver_cost` si el operador lo configuró.
// ══════════════════════════════════════════════════════════════════════

// ── TARIFA ESTÁNDAR (base barata; los operadores suben con VIP) ────────
// Sedán/SUV: conductor independiente CDMX (día SUV $2,500; aeropuerto BJ →
// centro Versa $400, SUV $500). Vans y autobuses: tabla del operador de
// referencia (día local, curva foránea y traslado aeropuerto CDMX).
// El mínimo local de varios días baja igual que el foráneo, así el foráneo
// nunca queda por debajo del local.
// pct_minimo = % del día que cuesta un servicio corto (≤ horas_minimo).
// Autobús local: el operador no lo publica; 12,700 = Minibús × 1.33 (misma
// proporción que sus traslados de aeropuerto y su día foráneo).
const TARIFAS_DEFAULT = {
  SEDAN:     { day1_rate_local: 2000,  min_rate_local: 1800, day1_rate_foraneo: 2200,  min_rate_foraneo: 1800, pct_minimo: 16 },
  SUV:       { day1_rate_local: 2500,  min_rate_local: 2500, day1_rate_foraneo: 3000,  min_rate_foraneo: 2500, pct_minimo: 15 },
  V250:      { day1_rate_local: 6000,  min_rate_local: 5000, day1_rate_foraneo: 6000,  min_rate_foraneo: 5000, pct_minimo: 48 },
  DUCATO:    { day1_rate_local: 4500,  min_rate_local: 4000, day1_rate_foraneo: 4500,  min_rate_foraneo: 4000, pct_minimo: 57 },
  VAN:       { day1_rate_local: 5500,  min_rate_local: 4500, day1_rate_foraneo: 7000,  min_rate_foraneo: 4500, pct_minimo: 59 },
  MINIBUS:   { day1_rate_local: 9500,  min_rate_local: 6000, day1_rate_foraneo: 13000, min_rate_foraneo: 6000, pct_minimo: 61 },
  LARGE_BUS: { day1_rate_local: 12700, min_rate_local: 9000, day1_rate_foraneo: 18000, min_rate_foraneo: 9000, pct_minimo: 60 },
};
TARIFAS_DEFAULT.MIDSIZE_BUS   = TARIFAS_DEFAULT.LARGE_BUS;
TARIFAS_DEFAULT.DOUBLE_DECKER = TARIFAS_DEFAULT.LARGE_BUS;

// Derecho de piso (se suma aparte cuando aeropuerto = true). El operador lo
// puede sobrescribir por categoría con `derecho_piso` o `airport_floor_fee_*`.
const DERECHO_PISO_DEFAULT = {
  SEDAN: 0, SUV: 0,
  DUCATO: 597, V250: 597, VAN: 597,
  MINIBUS: 1100, MIDSIZE_BUS: 1100, LARGE_BUS: 1100, DOUBLE_DECKER: 1100,
};

// Ejemplo de tramos planos (NO se usan salvo que el operador los mande en
// `tarifas_traslado.tramos`). Operador de referencia, CDMX.
const TRAMOS_TRASLADO_EJEMPLO = [
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

// Curva dentro del día (servicios < 24h). Todo se puede mandar por categoría
// dentro de `tarifas` o en la raíz del input.
//   precio(h) = h ≤ horas_minimo        → day1 × pct_minimo
//               h < horas_dia_completo  → sube lineal por hora hasta day1
//               h ≤ hours_per_day       → day1
//               h > hours_per_day       → day1 + horas extra × day1/hours_per_day (tope: día 2)
const CONFIG_DEFAULT = {
  hours_per_day: 15,
  horas_minimo: 3,
  horas_dia_completo: 8,        // operador de referencia: ventana de 8 a 10h = día completo
  pct_minimo: 50,              // solo si la categoría no trae el suyo
  dia_tarifa_minima: 4,         // día en que la curva de varios días llega a min_rate
  hora_salida_temprano: '05:00',
  hora_llegada_tarde: '19:00',
  km_foraneo_aeropuerto: 145,   // tabla del operador: aeropuerto hasta 145 km = traslado
  horas_max_conductor: 12,      // transporte turístico: 12h continuas por conductor
};

// Hospedaje del conductor por noche en viajes foráneos de varios días. El
// operador de referencia lo cobra en Sprinter; en autobuses lo suele cubrir
// el cliente/hotel. Editable por categoría con `hospedaje_noche`.
const HOSPEDAJE_DEFAULT = { VAN: 800 };

// ── HELPERS ───────────────────────────────────────────────────────────

function r2(n) { return Math.round(n * 100) / 100; }

function num(v, def = 0) {
  if (v === null || v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function normalizarCategoria(cat) {
  const c = String(cat || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

// "HH:MM" o "HH:MM:SS" → horas decimales; null si no es válido.
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

  // ── Categoría y tarifas ──
  let catNorm = normalizarCategoria(categoria);
  if (!catNorm) {
    warnings.push(`Categoría desconocida "${categoria}"; se cotiza como VAN.`);
    catNorm = 'VAN';
  }

  const tRoot = input.tarifas && typeof input.tarifas === 'object' ? input.tarifas : {};
  const t = resolverTarifas(input.tarifas, catNorm);
  const base = TARIFAS_DEFAULT[catNorm];
  // Parámetro: categoría del operador → raíz del input → default.
  const param = (k, def) => num(t[k], null) ?? num(input[k], null) ?? def;

  const campos = ['day1_rate_local', 'min_rate_local', 'day1_rate_foraneo', 'min_rate_foraneo'];
  const faltantes = campos.filter(k => !(num(t[k], null) > 0));
  const tarifasFallback = faltantes.length > 0;
  if (tarifasFallback) {
    warnings.push(`Tarifas faltantes (${faltantes.join(', ')}); se usa la tarifa estándar de ${catNorm}.`);
  }
  const tarifas = {};
  for (const k of campos) tarifas[k] = num(t[k], null) > 0 ? num(t[k]) : base[k];

  // Validación B: el foráneo no debería ser más barato que el local.
  if (tarifas.day1_rate_foraneo < tarifas.day1_rate_local || tarifas.min_rate_foraneo < tarifas.min_rate_local) {
    warnings.push('Tarifa foránea menor que la local: se cobra al menos la renta local.');
  }

  let hours_per_day = param('hours_per_day', CONFIG_DEFAULT.hours_per_day);
  if (!(hours_per_day > 0) || hours_per_day > 24) hours_per_day = CONFIG_DEFAULT.hours_per_day;
  const pctMinimo = Math.min(100, Math.max(0, param('pct_minimo', base.pct_minimo ?? CONFIG_DEFAULT.pct_minimo))) / 100;
  const horasMin  = Math.min(hours_per_day, Math.max(0, param('horas_minimo', CONFIG_DEFAULT.horas_minimo)));
  const horasDia  = Math.min(hours_per_day, Math.max(horasMin, param('horas_dia_completo', CONFIG_DEFAULT.horas_dia_completo)));
  const diaTarifaMinima = Math.max(1, Math.round(param('dia_tarifa_minima', CONFIG_DEFAULT.dia_tarifa_minima)));

  // ── Aeropuerto / traslado plano ──
  // Recogida en aeropuerto: flag explícito o el punto de encuentro (dirección
  // de Google) contiene "aeropuerto/airport". Solo la RECOGIDA paga derecho de
  // piso; dejar a alguien en el aeropuerto no.
  // Si llega el objeto del vehículo completo, se leen también los datos de `itinerario`.
  const itin = input.itinerario && typeof input.itinerario === 'object' ? input.itinerario : {};
  const primerTramo = (Array.isArray(itin.dias_detalle) && itin.dias_detalle[0] && itin.dias_detalle[0].metadata) || {};
  const puntoEncuentro = String(input.punto_encuentro ?? input.origen ?? primerTramo.punto_encuentro ?? primerTramo.origen ?? '');
  const aeropuerto = !!(input.aeropuerto || input.recogida_aeropuerto || itin.recogida_aeropuerto ||
    /aeropuerto|airport|a[ée]roport|aeroporto|flughafen/i.test(puntoEncuentro));
  const cobraDerechoPiso = input.cobra_derecho_piso != null ? !!input.cobra_derecho_piso : aeropuerto;
  const cfgTraslado = input.tarifas_traslado || {};
  const tramosCfg = Array.isArray(cfgTraslado.tramos) && cfgTraslado.tramos.length ? cfgTraslado.tramos : null;
  let esTrasladoPlano = aeropuerto && !!tramosCfg;
  let pisoTraslado = 0;
  let estacionamientoFallback = 0;
  let plano = null;
  if (esTrasladoPlano) {
    const recargo = cfgTraslado.recargo_tramo !== undefined ? cfgTraslado.recargo_tramo : RECARGO_TRASLADO_DEFAULT;
    if (km_totales > 0) plano = calcularTrasladoPlano(km_totales, catNorm, tramosCfg, recargo);
    if (!plano) {
      esTrasladoPlano = false;
      warnings.push(`Traslado plano no aplica (km_totales=${km_totales}, ${catNorm}); se cotiza como renta normal.`);
      // Más km nunca debe costar menos que el tramo más caro.
      const ultimo = [...tramosCfg].sort((a, b) => a.km_max - b.km_max).pop();
      const precioUltimo = ultimo && precioCategoria(ultimo.precio, catNorm);
      if (precioUltimo != null && km_totales > ultimo.km_max) {
        const recPct = recargo ? num(recargo.porcentaje) : 0;
        pisoTraslado = r2(precioUltimo * (1 + recPct / 100));
        estacionamientoFallback = precioCategoria(ultimo.estacionamiento, catNorm) || 0;
      }
    }
  }

  // ── Horario ──
  const horaFinAbs = horaInicio + horas_servicio;
  const cruzaMedianoche = horaFinAbs > 24;
  const horaFinDia = horaFinAbs - Math.floor((horaFinAbs - 1e-9) / 24) * 24; // (0,24]
  const esItinerario = !esTrasladoPlano && horas_servicio >= 24;
  // Varios días: límites siempre (default 05:00 / 19:00). Un día: solo si el
  // operador los configuró (las horas extra ya pagan el tiempo adicional).
  const limTempranoCfg = input.early_departure_limit ?? t.early_departure_limit ?? tRoot.early_departure_limit;
  const limTardeCfg    = input.late_arrival_limit    ?? t.late_arrival_limit    ?? tRoot.late_arrival_limit;
  const limTemprano = timeToHours(limTempranoCfg ?? (esItinerario ? CONFIG_DEFAULT.hora_salida_temprano : null));
  const limTarde    = timeToHours(limTardeCfg    ?? (esItinerario ? CONFIG_DEFAULT.hora_llegada_tarde : null));
  const salidaTemprano = limTemprano != null && horaInicio < limTemprano;
  const llegadaTarde   = limTarde != null && horas_servicio > 0 && (horaFinDia > limTarde || (!esItinerario && cruzaMedianoche));

  // ── Renta (se calcula para local o foráneo) ──
  function calcularRenta(foraneo) {
    const day1Rate = r2(foraneo ? tarifas.day1_rate_foraneo : tarifas.day1_rate_local);
    const minRate  = r2(Math.min(day1Rate, foraneo ? tarifas.min_rate_foraneo : tarifas.min_rate_local));
    const medioDia   = r2(day1Rate / 2);
    const minimo     = r2(day1Rate * pctMinimo);
    const tarifaHora = r2(day1Rate / hours_per_day);
    const tarifaSubida = horasDia > horasMin ? (day1Rate - minimo) / (horasDia - horasMin) : 0;

    const tarifaDia = d => {
      if (d >= diaTarifaMinima || diaTarifaMinima === 1) return minRate;
      return r2(day1Rate - ((d - 1) / (diaTarifaMinima - 1)) * (day1Rate - minRate));
    };

    const R = { day1Rate, minRate, medioDia, minimo, tarifaHora, costoRenta: 0, penalizacion: 0,
      motivos: [], desglose: [], bloqueLabel: '', horasExtra: 0, costoHorasExtra: 0, diasCobrados: 0 };

    if (esItinerario) {
      // Días de calendario (inclusivo) + ½ día por salida temprano y ½ por
      // llegada tarde. Cada día se cobra a su tarifa.
      const diasCal = Math.floor((horaFinAbs - 1e-9) / 24) + 1;
      for (let d = 1; d <= diasCal; d++) {
        const tar = tarifaDia(d);
        R.desglose.push({ dia: d, tarifa: tar, tipo: 'día completo' });
        R.costoRenta += tar;
      }
      R.costoRenta = r2(R.costoRenta);
      const medioSig = r2(tarifaDia(diasCal + 1) / 2);
      if (salidaTemprano) { R.penalizacion += medioSig; R.motivos.push('Salida anticipada'); }
      if (llegadaTarde)   { R.penalizacion += medioSig; R.motivos.push('Llegada tarde'); }
      R.diasCobrados = diasCal + 0.5 * R.motivos.length;
      R.bloqueLabel = `${horas_servicio}h → ${R.diasCobrados} día(s)`;
      return R;
    }

    const h = horas_servicio;
    if (h <= horasMin) {
      R.costoRenta = minimo;
      R.bloqueLabel = `${h}h → mínimo (${Math.round(pctMinimo * 100)}% del día, hasta ${horasMin}h)`;
      R.desglose.push({ dia: 1, tarifa: minimo, tipo: 'mínimo' });
    } else if (h < horasDia) {
      const extra = Math.ceil(h - horasMin - 1e-9);
      const sinTope = r2(minimo + extra * tarifaSubida);
      if (sinTope >= day1Rate) {
        R.costoRenta = day1Rate;
        R.bloqueLabel = `${h}h → día completo`;
        R.desglose.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
      } else {
        R.costoRenta = sinTope;
        R.horasExtra = extra;
        R.costoHorasExtra = r2(sinTope - minimo);
        R.bloqueLabel = `${h}h → mínimo + ${extra}h`;
        R.desglose.push({ dia: 1, tarifa: minimo, tipo: 'mínimo' });
        R.desglose.push({ dia: 1, tarifa: R.costoHorasExtra, tipo: `${extra}h adicionales` });
      }
    } else if (h <= hours_per_day) {
      R.costoRenta = day1Rate;
      R.bloqueLabel = `${h}h → día completo`;
      R.desglose.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
    } else {
      // Tope: las horas extra no cuestan más que el día 2 (si no, 23h saldría
      // más caro que un itinerario de 24h).
      R.horasExtra = Math.ceil(h - hours_per_day - 1e-9);
      R.costoHorasExtra = Math.min(r2(R.horasExtra * tarifaHora), tarifaDia(2));
      R.costoRenta = r2(day1Rate + R.costoHorasExtra);
      R.bloqueLabel = `${h}h → día completo + ${R.horasExtra}h extra`;
      R.desglose.push({ dia: 1, tarifa: day1Rate, tipo: 'día completo' });
      R.desglose.push({ dia: 1, tarifa: R.costoHorasExtra, tipo: `${R.horasExtra}h extra` });
    }
    if (salidaTemprano) { R.penalizacion += medioDia; R.motivos.push('Salida anticipada'); }
    if (llegadaTarde)   { R.penalizacion += medioDia; R.motivos.push('Llegada tarde'); }
    R.diasCobrados = r2((day1Rate > 0 ? R.costoRenta / day1Rate : 1) + 0.5 * R.motivos.length);
    return R;
  }

  // Aeropuerto: traslado con tarifa local hasta km_foraneo_aeropuerto.
  const kmForaneoAeropuerto = Math.max(km_foraneo, param('km_foraneo_aeropuerto', CONFIG_DEFAULT.km_foraneo_aeropuerto));
  const esForaneo = aeropuerto ? km_totales > kmForaneoAeropuerto : km_totales >= km_foraneo;
  let R;
  let reglaLocalAplicada = false;

  if (esTrasladoPlano) {
    const recargoMonto = r2(plano.precio * plano.recargo_pct / 100);
    plano.recargo_monto = recargoMonto;
    R = calcularRenta(esForaneo);
    R.costoRenta = r2(plano.precio + recargoMonto);
    R.penalizacion = 0;
    R.motivos = [];
    R.horasExtra = 0; R.costoHorasExtra = 0; R.diasCobrados = 1;
    R.desglose = [{ dia: 1, tarifa: R.costoRenta, tipo: 'traslado plano' }];
    R.bloqueLabel = `Traslado plano (≤${plano.km_max_tramo}km)` + (plano.recargo_pct ? ` + recargo ${plano.recargo_pct}%` : '');
  } else {
    R = calcularRenta(esForaneo);
    // Regla A: el foráneo nunca cobra menos renta que el mismo viaje local.
    if (esForaneo) {
      const L = calcularRenta(false);
      if (L.costoRenta + L.penalizacion > R.costoRenta + R.penalizacion) {
        R = L;
        reglaLocalAplicada = true;
        R.bloqueLabel += ' (mínimo: tarifa local)';
      }
    }
  }

  let { costoRenta, penalizacion } = R;
  let bloqueLabel = R.bloqueLabel;

  // ── Combustible (siempre, salvo traslado plano que ya lo incluye) ──
  let litros = 0, costoCombustible = 0;
  if (!esTrasladoPlano && km_totales > 0) {
    if (diesel_price > 0 && km_litro > 0) {
      litros = r2(km_totales / km_litro);
      costoCombustible = Math.round(litros * diesel_price);
    } else {
      warnings.push('Falta diesel_price o km_litro: combustible no cotizado.');
    }
  }

  // ── Hospedaje del conductor (foráneo de varios días, no festivos) ──
  let hospedajeNoches = 0, costoHospedaje = 0;
  const hospedajeNoche = Math.max(0, param('hospedaje_noche', HOSPEDAJE_DEFAULT[catNorm] || 0));
  if (esItinerario && esForaneo && hospedajeNoche > 0) {
    hospedajeNoches = Math.max(0, Math.floor((horaFinAbs - 1e-9) / 24));
    if (input.es_festivo) {
      warnings.push('Día festivo: hospedaje del conductor por cuenta del cliente.');
    } else {
      costoHospedaje = hospedajeNoches * hospedajeNoche;
    }
  }

  // ── Segundo conductor (más de 12h seguidas en un servicio de un día) ──
  // Se mide con horas de MANEJO si vienen (horas_manejo_dia / horas_manejo_totales);
  // si no, con horas de servicio (incluye esperas, puede sobreestimar).
  const horasMaxConductor = param('horas_max_conductor', CONFIG_DEFAULT.horas_max_conductor);
  const horasManejo = num(input.horas_manejo_dia ?? input.horas_manejo_totales ?? itin.horas_manejo_totales, null);
  const requiereSegundoConductor = !esItinerario && (horasManejo ?? horas_servicio) > horasMaxConductor;
  const costoSegundoRef = num(t.second_driver_cost ?? tRoot.second_driver_cost);
  const costoSegundoConductor = requiereSegundoConductor ? costoSegundoRef : 0;
  if (requiereSegundoConductor && !(costoSegundoRef > 0)) {
    warnings.push(`Servicio de ${horas_servicio}h: requiere segundo conductor (más de ${horasMaxConductor}h); configura second_driver_cost.`);
  }

  // ── VIP ──
  let vipCosto = r2((costoRenta + penalizacion) * (vipFactor - 1));

  // ── Piso para traslado largo fuera de tramos (incluye VIP) ──
  if (pisoTraslado > 0) {
    const actual = (costoRenta + penalizacion) * vipFactor + costoCombustible;
    const objetivo = pisoTraslado * vipFactor;
    if (actual < objetivo) {
      costoRenta = r2(costoRenta + (objetivo - actual) / vipFactor);
      vipCosto = r2((costoRenta + penalizacion) * (vipFactor - 1));
      bloqueLabel += ` (ajustado al mínimo de traslado $${pisoTraslado})`;
    }
  }

  // ── Derecho de piso y estacionamiento ──
  let costoDerechoPiso = 0;
  if (cobraDerechoPiso) {
    const fees = Object.keys(t).filter(k => k === 'derecho_piso' || k.startsWith('airport_floor_fee'))
      .map(k => num(t[k], null)).filter(v => v != null && v >= 0);
    costoDerechoPiso = esTrasladoPlano ? plano.derecho_piso
      : fees.length ? Math.max(...fees)
      : (precioCategoria(DERECHO_PISO_DEFAULT, catNorm) || 0);
  }
  const costoEstacionamiento = esTrasladoPlano ? plano.estacionamiento : estacionamientoFallback;

  const total = Math.round(
    costoRenta + penalizacion + vipCosto + costoCombustible + casetas + costoDerechoPiso + costoEstacionamiento +
    costoHospedaje + costoSegundoConductor
  );

  for (const w of warnings) console.log('⚠️ ' + w);

  return {
    empresa_id,
    vehiculo_id,
    categoria: catNorm,
    es_itinerario: esItinerario,
    es_foraneo: esForaneo,
    regla_minimo_local: reglaLocalAplicada,
    horas_servicio,
    dias_cobrados: R.diasCobrados,

    traslado_plano_aplica: esTrasladoPlano,
    traslado_plano_km_max: esTrasladoPlano ? plano.km_max_tramo : null,
    traslado_plano_recargo_pct: esTrasladoPlano ? plano.recargo_pct : 0,
    traslado_plano_recargo_monto: esTrasladoPlano ? plano.recargo_monto : 0,

    renta_bloque: bloqueLabel,
    renta_desglose: R.desglose,
    renta_day1_rate: esTrasladoPlano ? null : R.day1Rate,
    renta_min_rate: esTrasladoPlano ? null : R.minRate,
    renta_medio_dia: esTrasladoPlano ? null : R.medioDia,
    renta_minimo: esTrasladoPlano ? null : R.minimo,
    renta_tarifa_hora: esTrasladoPlano ? null : R.tarifaHora,
    renta_curva: esTrasladoPlano ? null : { pct_minimo: r2(pctMinimo * 100), horas_minimo: horasMin, horas_dia_completo: horasDia, hours_per_day },
    renta_horas_extra: R.horasExtra,
    renta_costo_horas_extra: R.costoHorasExtra,
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

    penalizacion_motivo: R.motivos.join('. '),
    penalizacion_costo: Math.round(penalizacion),

    aeropuerto_aplica: aeropuerto,
    aeropuerto_costo: costoDerechoPiso,
    estacionamiento_costo: costoEstacionamiento,

    hospedaje_noches: hospedajeNoches,
    hospedaje_costo: costoHospedaje,

    segundo_conductor_requerido: requiereSegundoConductor,
    segundo_conductor_costo: costoSegundoConductor,
    segundo_conductor_costo_ref: costoSegundoRef,

    tarifas_fallback_usado: tarifasFallback,
    warnings,

    total,
  };
}

// ── Exportar para pruebas / ejecutar como nodo n8n ─────────────────────
if (typeof $input === 'undefined') {
  module.exports = { calcularCotizacion, normalizarCategoria, timeToHours, TARIFAS_DEFAULT, TRAMOS_TRASLADO_EJEMPLO, DERECHO_PISO_DEFAULT, HOSPEDAJE_DEFAULT };
  return;
}
const raw = $input.first().json;
return [{ json: calcularCotizacion(raw.body || raw) }];
