// Ejecutar: node --test cotizador/tarifa.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularCotizacion: cot, normalizarCategoria, TRAMOS_TRASLADO_EJEMPLO } = require('./tarifa.js');
const ESTANDAR = require('./tarifas-estandar.json');
const PREMIUM = require('./operador-premium.json');

const CATS = ['Sedán', 'SUV', 'V250', 'Ducato', 'Sprinter', 'Minibús', 'Autobús'];
const cerca = (real, esperado, tol, msg) =>
  assert.ok(Math.abs(real - esperado) / esperado <= tol, `${msg}: ${real} vs ${esperado} (±${tol * 100}%)`);

// Operador estándar: tarifas estándar, gasolina $24, km/l por vehículo.
const KML = { 'Sedán': 14, SUV: 10, V250: 10, Ducato: 9, Sprinter: 9, 'Minibús': 5, 'Autobús': 3.5 };
const std = (cat, extra = {}) => ({
  categoria: cat, tarifas: ESTANDAR, diesel_price: 24, km_litro: KML[cat], km_foraneo: 120,
  hours_per_day: 15, hora_inicio: '08:00', ...extra,
});

// Operador premium: mismas tarifas + pct_minimo propio + VIP por vehículo.
const KML_P = { 'Sedán': 12, SUV: 10, V250: 10, Ducato: 9, Sprinter: 9, 'Minibús': 5, 'Autobús': 3.5 };
const prem = (cat, extra = {}) => ({
  categoria: cat, tarifas: PREMIUM.tarifas, diesel_price: 22, km_litro: KML_P[cat], km_foraneo: 120,
  hora_inicio: '09:00:00', is_vip: true, vip_percentage: PREMIUM.vip_percentage_por_categoria[cat], ...extra,
});

// ── Categorías ──────────────────────────────────────────────────────
test('categorías del select se normalizan', () => {
  const esperado = { 'Sedán': 'SEDAN', SUV: 'SUV', V250: 'V250', Ducato: 'DUCATO',
    Sprinter: 'VAN', 'Minibús': 'MINIBUS', 'Autobús': 'LARGE_BUS' };
  for (const [front, cat] of Object.entries(esperado)) assert.equal(normalizarCategoria(front), cat, front);
});

// ── Estándar contra datos reales ────────────────────────────────────
// Aeropuerto BJ → centro/Condesa (2.1h, 48.73 km con pensión).
// Sedán/SUV: conductor ($400 Versa, $500 SUV). Vans: tabla aeropuerto CDMX.
test('estándar: aeropuerto CDMX', () => {
  const reales = { 'Sedán': 400, SUV: 500, V250: 3597, Ducato: 3297, Sprinter: 3997, 'Minibús': 7100, 'Autobús': 9100 };
  for (const cat of CATS) {
    const r = cot(std(cat, { aeropuerto: true, horas_servicio: 2.1, km_totales: 48.73 }));
    cerca(r.total, reales[cat], 0.05, cat);
  }
});

test('estándar: día SUV del conductor = $2,500 de renta', () => {
  assert.equal(cot(std('SUV', { horas_servicio: 10, km_totales: 60 })).renta_subtotal, 2500);
});

test('estándar: cotización real Sprinter $7,400/día, 16h → +1h ≈ $500', () => {
  const r = cot(std('Sprinter', { horas_servicio: 16, hora_inicio: '06:00', km_totales: 250,
    tarifas: { ...ESTANDAR.Sprinter, day1_rate_foraneo: 7400 } }));
  assert.equal(r.renta_horas_extra, 1);
  cerca(r.renta_costo_horas_extra, 500, 0.02, 'hora extra');
});

// ── Escenarios esperados (calculados a mano, sin el código) ─────────
// Gasolina $24; km/l: Sedán 13, SUV 9, V250 10, Ducato 9, Sprinter 8, Minibús 5, Autobús 3.5.
const KML_ESC = { 'Sedán': 13, SUV: 9, V250: 10, Ducato: 9, Sprinter: 8, 'Minibús': 5, 'Autobús': 3.5 };
const CASETA = { auto: ['Sedán', 'SUV', 'V250'], bus2: ['Ducato', 'Sprinter', 'Minibús'], bus3: ['Autobús'] };
const clase = cat => Object.keys(CASETA).find(k => CASETA[k].includes(cat));
const ESCENARIOS = [
  // [nombre, horas, km, hora_inicio, casetas {auto,bus2,bus3}, totales esperados por categoría]
  ['3. City tour 1 día (10h, 60 km)', 10, 60, '08:00', { auto: 0, bus2: 0, bus3: 0 },
    { SUV: 2660, V250: 6144, Ducato: 4660, Sprinter: 5680, 'Minibús': 9788, 'Autobús': 13111 }],
  ['4. Teotihuacán (9h, 130 km)', 9, 130, '08:00', { auto: 180, bus2: 330, bus3: 470 },
    { 'Sedán': 2620, SUV: 3527, V250: 6492, Ducato: 5177, Sprinter: 7720, 'Minibús': 13954, 'Autobús': 19361 }],
  ['5. Puebla 1 día (14h, 290 km)', 14, 290, '07:00', { auto: 440, bus2: 800, bus3: 1150 },
    { 'Sedán': 3175, SUV: 4213, V250: 7136, Ducato: 6073, Sprinter: 8670, 'Minibús': 15192, 'Autobús': 21139 }],
  ['7. Querétaro–SMA 3 días (08→18h, 560 km)', 58, 560, '08:00', { auto: 550, bus2: 1000, bus3: 1450 },
    { 'Sedán': 7684, SUV: 10493, V250: 18894, Ducato: 15493, Sprinter: 22280, 'Minibús': 34688, 'Autobús': 48290 }],
  ['8. Oaxaca 7 días (06→21h, 1300 km)', 159, 1300, '06:00', { auto: 1500, bus2: 2700, bus3: 3900 },
    { 'Sedán': 18100, SUV: 24667, V250: 44120, Ducato: 37167, Sprinter: 49650, 'Minibús': 66940, 'Autobús': 96314 }],
  ['9. Acapulco 4 días (04→20h, 1100 km)', 88, 1100, '04:00', { auto: 1500, bus2: 2700, bus3: 3900 },
    { 'Sedán': 13231, SUV: 17883, V250: 31140, Ducato: 26633, Sprinter: 35400, 'Minibús': 50980, 'Autobús': 72443 }],
];

for (const [nombre, horas, km, inicio, casetas, esperados] of ESCENARIOS) {
  test(`estándar: escenario ${nombre}`, () => {
    for (const [cat, esperado] of Object.entries(esperados)) {
      const r = cot(std(cat, { horas_servicio: horas, km_totales: km, hora_inicio: inicio,
        km_litro: KML_ESC[cat], casetas: casetas[clase(cat)] }));
      cerca(r.total, esperado, 0.06, `${nombre} ${cat}`);
    }
  });
}

// ── Premium: 8 precios reales con VIP ───────────────────────────────
const REALES_P = [['Sedán', 1890, 5590], ['SUV', 1990, 6350], ['Ducato', 2950, 6950], ['Sprinter', 4950, 9950]];

test('premium: aeropuerto y día completo reales (±1%)', () => {
  for (const [cat, aer, dia] of REALES_P) {
    cerca(cot(prem(cat, { aeropuerto: true, horas_servicio: 2.1, km_totales: 48.73 })).total, aer, 0.01, `${cat} aeropuerto`);
    for (const h of [10, 11, 12]) {
      cerca(cot(prem(cat, { horas_servicio: h, km_totales: 59 })).total, dia, 0.01, `${cat} día ${h}h`);
    }
  }
});

test('premium: solo con VIP (sin cambiar pct_minimo) NO alcanza el aeropuerto', () => {
  const r = cot(prem('Sedán', { tarifas: ESTANDAR, hours_per_day: 12, horas_dia_completo: 10,
    aeropuerto: true, horas_servicio: 2.1, km_totales: 48.73 }));
  assert.ok(r.total < 1890 * 0.7, `Sedán solo VIP: ${r.total}`);
});

// ── Regla A: foráneo nunca más barato que local ─────────────────────
test('regla A: 1 km más nunca baja el precio (tarifas invertidas del operador)', () => {
  const invertidas = { min_rate_local: 9500, day1_rate_local: 9500, min_rate_foraneo: 6000, day1_rate_foraneo: 13000 };
  for (const h of [5, 12, 16, 48, 72, 120, 168]) {
    const a = cot(std('Minibús', { tarifas: invertidas, horas_servicio: h, km_totales: 119 }));
    const b = cot(std('Minibús', { tarifas: invertidas, horas_servicio: h, km_totales: 120 }));
    assert.ok(b.total >= a.total, `${h}h: 119km ${a.total} > 120km ${b.total}`);
  }
  const r = cot(std('Minibús', { tarifas: invertidas, horas_servicio: 168, km_totales: 500 }));
  assert.equal(r.regla_minimo_local, true);
  assert.ok(r.warnings.some(w => /foránea menor/.test(w)));
});

test('regla A no se activa con la tarifa estándar', () => {
  for (const cat of CATS) for (const h of [5, 12, 48, 168]) {
    assert.equal(cot(std(cat, { horas_servicio: h, km_totales: 800 })).regla_minimo_local, false, `${cat} ${h}h`);
  }
});

// ── Aeropuerto ──────────────────────────────────────────────────────
test('aeropuerto = viaje normal + derecho de piso (sin nombres de aeropuerto)', () => {
  const a = cot(std('Sprinter', { horas_servicio: 2.1, km_totales: 48.73 }));
  const b = cot(std('Sprinter', { horas_servicio: 2.1, km_totales: 48.73, aeropuerto: true }));
  assert.equal(b.total - a.total, 597);
  assert.equal(b.traslado_plano_aplica, false);
});

test('derecho de piso del operador (airport_floor_fee_*) + alias de ids', () => {
  const r = cot({ id_empresa: 'x', vehicle: 62, categoria: 'SUV', horas_servicio: 2.1, km_totales: 48.73,
    aeropuerto: true, km_foraneo: 120, diesel_price: 22, km_litro: 10,
    tarifas: { SUV: { min_rate_local: 2000, day1_rate_local: 2500, min_rate_foraneo: 2500, day1_rate_foraneo: 3000,
      airport_floor_fee_aicm: 300, airport_floor_fee_aifa: 300 } } });
  assert.equal(r.empresa_id, 'x');
  assert.equal(r.vehiculo_id, 62);
  assert.equal(r.aeropuerto_costo, 300);
  assert.equal(r.renta_subtotal, 375); // 15% estándar de SUV × 2500
});

test('tramos planos configurados por el operador + piso después del último tramo', () => {
  const t = (cat, km, vip = 0) => cot(std(cat, { aeropuerto: true, km_totales: km, horas_servicio: 2,
    is_vip: vip > 0, vip_percentage: vip, tarifas_traslado: { tramos: TRAMOS_TRASLADO_EJEMPLO } }));
  assert.equal(t('Sprinter', 40).total, 3400 + 597);
  assert.equal(t('SUV', 100).total, 4000 + 80);
  assert.equal(t('Sprinter', 140).renta_subtotal, 5170);
  for (const cat of CATS) for (const vip of [0, 20]) {
    let prev = 0;
    for (let km = 5; km <= 400; km++) {
      const total = t(cat, km, vip).total;
      assert.ok(total >= prev, `${cat} vip${vip} ${km}km: ${prev}→${total}`);
      prev = total;
    }
  }
});

// ── Inputs reales del sistema ───────────────────────────────────────
test('input real: Sprinter 2.1h 48.73km con tarifas planas', () => {
  const r = cot({ empresa_id: '48c26674', vehiculo_id: 55, categoria: 'Sprinter', horas_servicio: 2.1,
    km_totales: 48.73, hora_inicio: '09:00:00', aeropuerto: false, km_foraneo: 120, diesel_price: 22,
    hours_per_day: 15, km_litro: 9, is_vip: false, vip_percentage: null,
    tarifas: { min_rate_local: 5500, day1_rate_local: 5500, min_rate_foraneo: 4500, day1_rate_foraneo: 7000 } });
  assert.equal(r.renta_subtotal, 3245); // 59% (estándar Sprinter) × 5500
  assert.equal(r.combustible_subtotal, 119);
  assert.ok(r.warnings.some(w => /foránea menor/.test(w)));
});

test('entradas raras no rompen el cálculo', () => {
  for (const inp of [{}, { horas_servicio: 'abc' }, { hora_inicio: '25:99' }, { is_vip: true, vip_percentage: -100 },
    { horas_servicio: '10', km_totales: '30', tarifas: 'x' }, { tarifas: { SUV: null }, categoria: 'SUV' }]) {
    const r = cot(inp);
    assert.ok(Number.isFinite(r.total) && r.total >= 0, JSON.stringify(inp));
  }
  assert.equal(cot(std('Sprinter', { hora_inicio: '03:00:00', horas_servicio: 48, km_totales: 300 })).dias_cobrados, 3.5);
});

// ── Fuzz: invariantes con ambos operadores ──────────────────────────
test('fuzz: más horas, más km o más VIP nunca bajan el precio', () => {
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 6000; i++) {
    const cat = CATS[Math.floor(rnd() * CATS.length)];
    const mk = rnd() < 0.5 ? std : prem;
    const inp = mk(cat, {
      horas_servicio: Math.round(rnd() * 180 * 4) / 4,
      km_totales: Math.round(rnd() * 1500),
      hora_inicio: `${Math.floor(rnd() * 24)}:${rnd() < 0.5 ? '00' : '30'}`,
      aeropuerto: rnd() < 0.3,
      is_vip: rnd() < 0.5, vip_percentage: Math.round(rnd() * 200),
      casetas: Math.round(rnd() * 2000),
    });
    const r = cot(inp);
    assert.ok(Number.isFinite(r.total) && r.total >= 0, JSON.stringify(inp));
    const h = cot({ ...inp, horas_servicio: inp.horas_servicio + 0.25 });
    assert.ok(h.total >= r.total, `horas ${cat} ${inp.horas_servicio}h ${inp.hora_inicio}: ${r.total}→${h.total}`);
    const k = cot({ ...inp, km_totales: inp.km_totales + 1 });
    assert.ok(k.total >= r.total, `km ${cat} ${inp.km_totales}km ${inp.horas_servicio}h: ${r.total}→${k.total}`);
    const v = cot({ ...inp, is_vip: true, vip_percentage: (inp.is_vip ? inp.vip_percentage : 0) + 10 });
    assert.ok(v.total >= r.total, `vip ${cat}: ${r.total}→${v.total}`);
  }
});

// ── Buses contra la tabla del operador de referencia ────────────────
const BUS_KML = { 'Minibús': 5, 'Autobús': 3.5 };
const bus = (cat, extra) => std(cat, { km_litro: BUS_KML[cat], ...extra });

test('buses: aeropuerto CDMX y AIFA contra tabla del operador (±5%)', () => {
  // AICM ≤55 km; AIFA ≤130 km (~5h con pensión en Coyoacán) + casetas bus.
  const tabla = { 'Minibús': [7100, 9600, 230], 'Autobús': [9100, 12100, 330] };
  for (const [cat, [aicm, aifa, cas]] of Object.entries(tabla)) {
    cerca(cot(bus(cat, { aeropuerto: true, horas_servicio: 2.1, km_totales: 49 })).total, aicm, 0.05, `${cat} AICM`);
    const r = cot(bus(cat, { aeropuerto: true, horas_servicio: 5, km_totales: 125, casetas: cas }));
    assert.equal(r.es_foraneo, false, `${cat} AIFA debe cobrarse como traslado local`);
    cerca(r.total, aifa, 0.05, `${cat} AIFA`);
  }
});

test('vans: AIFA contra tabla del operador', () => {
  // Ducato: el operador lo cobra al AIFA igual que la V250 aunque en AICM es
  // más barato; con una curva lineal queda ~12% abajo (usar VIP en esa unidad).
  const tabla = { V250: [5097, 120, 0.05], Ducato: [5097, 230, 0.13], Sprinter: [5297, 230, 0.05] };
  for (const [cat, [aifa, cas, tol]] of Object.entries(tabla)) {
    cerca(cot(std(cat, { aeropuerto: true, horas_servicio: 5, km_totales: 125, casetas: cas })).total, aifa, tol, `${cat} AIFA`);
  }
});

test('aeropuerto de más de 145 km sí es foráneo', () => {
  assert.equal(cot(bus('Autobús', { aeropuerto: true, horas_servicio: 5, km_totales: 145 })).es_foraneo, false);
  assert.equal(cot(bus('Autobús', { aeropuerto: true, horas_servicio: 5, km_totales: 146 })).es_foraneo, true);
});

test('buses: día local y curva foránea del operador', () => {
  assert.equal(cot(bus('Minibús', { horas_servicio: 10, km_totales: 60 })).renta_subtotal, 9500);
  assert.equal(cot(bus('Autobús', { horas_servicio: 10, km_totales: 60 })).renta_subtotal, 12700);
  // Minibús foráneo: 13,000 / 9,000 / 9,000 / 6,000... (tabla), ±8% acumulado
  const tabla = [13000, 9000, 9000, 6000, 6000, 6000];
  for (let n = 1; n <= 7; n++) {
    let esperado = 0; for (let d = 1; d <= n; d++) esperado += tabla[Math.min(d, 6) - 1];
    const r = cot(bus('Minibús', { horas_servicio: n === 1 ? 12 : (n - 1) * 24 + 12, hora_inicio: '06:00', km_totales: 300 * n }));
    cerca(r.renta_subtotal, esperado, 0.08, `Minibús ${n} días`);
  }
});

test('buses: curva dentro del día sube sin saltos y el día completo llega a las 8h', () => {
  for (const cat of ['Minibús', 'Autobús']) {
    let prev = 0;
    for (let h = 0.5; h <= 23.5; h += 0.5) {
      const r = cot(bus(cat, { horas_servicio: h, km_totales: 60 }));
      assert.ok(r.total >= prev, `${cat} ${h}h: ${prev}→${r.total}`);
      if (h >= 8 && h <= 15) assert.equal(r.renta_subtotal, cat === 'Minibús' ? 9500 : 12700, `${cat} ${h}h`);
      prev = r.total;
    }
  }
});

test('input real del usuario: Autobús 12h, 60 km, VIP 65%', () => {
  const inp = { empresa_id: 'd85d5f62', vehiculo_id: 65, categoria: 'Autobús', horas_servicio: 12, km_totales: 60,
    hora_inicio: '15:00', km_foraneo: 120, diesel_price: 28, hours_per_day: 15, km_litro: 3, aeropuerto: false,
    tarifas: { pct_minimo: 55, horas_minimo: 3, hours_per_day: 12, min_rate_local: 9000, day1_rate_local: 14000,
      min_rate_foraneo: 9000, day1_rate_foraneo: 18000, horas_dia_completo: 10 } };
  const conVip = cot({ ...inp, is_vip: true, vip_percentage: 65 });
  assert.equal(conVip.renta_vip_costo, 9100);            // el 65% es lo que lo hace "alto"
  assert.equal(cot({ ...inp, is_vip: false }).total, 14560);
  // Con la tarifa estándar nueva (12,700) y sin VIP:
  const nuevo = cot({ ...inp, tarifas: { ...inp.tarifas, day1_rate_local: 12700 }, is_vip: false });
  assert.equal(nuevo.total, 12700 + 560);
});

test('hospedaje: Sprinter $800/noche en foráneo; festivo y autobús no pagan', () => {
  const viaje = { horas_servicio: 58, hora_inicio: '08:00', km_totales: 560 };
  const s = cot(std('Sprinter', viaje));
  assert.equal(s.hospedaje_noches, 2);
  assert.equal(s.hospedaje_costo, 1600);
  assert.equal(cot(std('Sprinter', { ...viaje, es_festivo: true })).hospedaje_costo, 0);
  assert.equal(cot(bus('Autobús', viaje)).hospedaje_costo, 0);
  assert.equal(cot(std('Sprinter', { ...viaje, km_totales: 100 })).hospedaje_costo, 0); // local: duerme en casa
  // El operador puede configurarlo por categoría
  const t = { ...ESTANDAR, 'Autobús': { ...ESTANDAR['Autobús'], hospedaje_noche: 1000 } };
  assert.equal(cot(bus('Autobús', { ...viaje, tarifas: t })).hospedaje_costo, 2000);
});

test('segundo conductor: más de 12h en un día', () => {
  const a = cot(bus('Autobús', { horas_servicio: 12, km_totales: 60 }));
  assert.equal(a.segundo_conductor_requerido, false);
  const b = cot(bus('Autobús', { horas_servicio: 14, km_totales: 60 }));
  assert.equal(b.segundo_conductor_requerido, true);
  assert.equal(b.segundo_conductor_costo, 0);            // no configurado → solo aviso
  assert.ok(b.warnings.some(w => /segundo conductor/.test(w)));
  const t = { ...ESTANDAR, 'Autobús': { ...ESTANDAR['Autobús'], second_driver_cost: 1500 } };
  const c = cot(bus('Autobús', { horas_servicio: 14, km_totales: 60, tarifas: t }));
  assert.equal(c.total - b.total, 1500);
});
