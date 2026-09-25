// Ejecutar: node --test cotizador/
const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularCotizacion: cot, normalizarCategoria } = require('./tarifa.js');

const SPRINTER = { min_rate_local: 5500, day1_rate_local: 5500, min_rate_foraneo: 4500, day1_rate_foraneo: 7000 };
const MINIBUS  = { min_rate_local: 9500, day1_rate_local: 9500, min_rate_foraneo: 6000, day1_rate_foraneo: 13000 };

const base = (extra = {}) => ({
  categoria: 'Sprinter', horas_servicio: 10, km_totales: 30, hora_inicio: '08:00',
  tarifas: SPRINTER, km_foraneo: 100, diesel_price: 25, km_litro: 8, hours_per_day: 15,
  ...extra,
});

// ── Categorías del select del front ─────────────────────────────────
test('categorías del select se normalizan', () => {
  const esperado = { 'Sedán': 'SEDAN', SUV: 'SUV', V250: 'V250', Ducato: 'DUCATO',
    Sprinter: 'VAN', 'Minibús': 'MINIBUS', 'Autobús': 'LARGE_BUS' };
  for (const [front, cat] of Object.entries(esperado)) assert.equal(normalizarCategoria(front), cat, front);
  assert.equal(normalizarCategoria('Midsize Bus'), 'MIDSIZE_BUS');
});

// ── Cotización real de mercado ──────────────────────────────────────
test('cotización real: Sprinter 7400/día, 16h → día + 1h extra ≈ $500', () => {
  const r = cot(base({ horas_servicio: 16, hora_inicio: '06:00', km_totales: 250,
    tarifas: { ...SPRINTER, day1_rate_foraneo: 7400 }, casetas: 0, diesel_price: 0 }));
  assert.equal(r.renta_horas_extra, 1);
  assert.ok(Math.abs(r.renta_costo_horas_extra - 500) < 10, `hora extra ${r.renta_costo_horas_extra}`);
  assert.equal(r.penalizacion_costo, 0);
  // Mercado: 7400 + 500 = 7900 (sin casetas/combustible)
  assert.ok(Math.abs(r.renta_subtotal - 7900) < 10, `renta ${r.renta_subtotal}`);
});

// ── Tablas del operador (foráneo, días completos) ───────────────────
test('itinerario Sprinter foráneo sigue la tabla del operador (±8%)', () => {
  const tabla = [7000, 6000, 5000, 4500, 4500, 4500];
  for (let n = 2; n <= 8; n++) {
    let esperado = 0; for (let d = 1; d <= n; d++) esperado += tabla[Math.min(d, 6) - 1];
    // n días de calendario, salida 06:00 y llegada 18:00 (sin medios días)
    const r = cot(base({ horas_servicio: (n - 1) * 24 + 12, hora_inicio: '06:00', km_totales: 300, diesel_price: 0 }));
    assert.equal(r.dias_cobrados, n);
    const err = Math.abs(r.renta_subtotal - esperado) / esperado;
    assert.ok(err <= 0.08, `${n} días: ${r.renta_subtotal} vs ${esperado}`);
  }
});

test('itinerario: más días nunca cuesta menos (bug Minibús 6d < 5d)', () => {
  let prev = 0;
  for (let n = 1; n <= 12; n++) {
    const r = cot(base({ categoria: 'Minibús', tarifas: MINIBUS, horas_servicio: n * 24, hora_inicio: '06:00', km_totales: 400 }));
    assert.ok(r.total > prev, `${n} días: ${r.total} <= ${prev}`);
    prev = r.total;
  }
});

// ── Conteo de días (regla del documento, base de calendario) ────────
test('ejemplos del documento: 2→6 ene', () => {
  const h = (d1, h1, d2, h2) => (d2 - d1) * 24 + (h2 - h1);
  const dias = (hi, hs) => cot(base({ hora_inicio: `${String(hi).padStart(2, '0')}:00`, horas_servicio: hs, km_totales: 300 })).dias_cobrados;
  assert.equal(dias(2, h(2, 2, 6, 13)), 5.5);  // Ej. 1
  assert.equal(dias(6, h(2, 6, 6, 22)), 5.5);  // Ej. 2 (documento dice 6.5, base inconsistente)
  assert.equal(dias(2, h(2, 2, 6, 22)), 6);    // Ej. 3 (documento dice 7)
  assert.equal(dias(8, h(2, 8, 6, 18)), 5);    // sin penalizaciones
});

test('24h exactas desde 00:00 = 1 día calendario (+ llegada tarde)', () => {
  const r = cot(base({ hora_inicio: '00:00', horas_servicio: 24, km_totales: 300 }));
  assert.equal(r.dias_cobrados, 2); // 1 día + medio (salida<5) + medio (llega 24:00>19)
});

// ── Servicio de un día ──────────────────────────────────────────────
test('local corto = medio día', () => {
  const r = cot(base({ horas_servicio: 3 }));
  assert.equal(r.renta_subtotal, 2750);
});

test('penalización de horario solo con límites configurados; cruza medianoche = tarde', () => {
  const sin = cot(base({ hora_inicio: '20:00', horas_servicio: 7 }));
  assert.equal(sin.penalizacion_costo, 0);
  const con = cot(base({ hora_inicio: '20:00', horas_servicio: 7,
    tarifas: { ...SPRINTER, early_departure_limit: '05:00', late_arrival_limit: '19:00' } }));
  assert.equal(con.penalizacion_costo, 2750);
  assert.match(con.penalizacion_motivo, /tarde/i);
});

test('horas extra no se regalan después de 19h', () => {
  const a = cot(base({ horas_servicio: 19 })), b = cot(base({ horas_servicio: 22 }));
  assert.ok(b.renta_subtotal > a.renta_subtotal);
});

// ── Traslado plano / aeropuerto ─────────────────────────────────────
test('traslados planos con tabla del operador', () => {
  const t = (cat, km) => cot(base({ categoria: cat, aeropuerto: true, km_totales: km }));
  let r = t('Sprinter', 40);  assert.equal(r.total, 3400 + 597);
  r = t('SUV', 40);           assert.equal(r.total, 1500);
  r = t('SUV', 100);          assert.equal(r.total, 4000 + 80);   // + estacionamiento
  r = t('Sprinter', 140);     assert.equal(r.renta_subtotal, 5170); // 4700 +10%
  r = t('Sprinter', 200);     assert.equal(r.traslado_plano_aplica, false);
});

test('input de ejemplo del usuario (SUV 70km aeropuerto, VIP sin %)', () => {
  const r = cot({ categoria: 'SUV', horas_servicio: 15, km_totales: 70, hora_inicio: '00:00',
    tarifas: { min_rate_local: 2200, day1_rate_local: 2500, min_rate_foraneo: 1800, day1_rate_foraneo: 2000 },
    aeropuerto: true, km_foraneo: 100, diesel_price: 25, hours_per_day: 15, km_litro: 8,
    is_vip: true, vip_percentage: null });
  assert.equal(r.total, 4080);
  assert.ok(r.warnings.some(w => /vip/i.test(w)));
});

// ── Combustible, casetas, ajuste ────────────────────────────────────
test('combustible se cobra también en local; casetas se suman', () => {
  const r = cot(base({ km_totales: 80, casetas: 300 }));
  assert.equal(r.combustible_subtotal, 250); // 80/8*25
  assert.equal(r.casetas_subtotal, 300);
});

test('ajuste_pct escala renta y traslados, no casetas/derecho de piso', () => {
  const a = cot(base({ ajuste_pct: 0 })), b = cot(base({ ajuste_pct: 10 }));
  assert.equal(b.renta_subtotal, Math.round(a.renta_subtotal * 1.1));
  const p = cot(base({ aeropuerto: true, km_totales: 40, ajuste_pct: 10 }));
  assert.equal(p.total, 3740 + 597);
});

test('tarifas faltantes usan defaults de la categoría, no $3000 fijos', () => {
  const r = cot(base({ categoria: 'Autobús', tarifas: null, horas_servicio: 15 }));
  assert.equal(r.renta_subtotal, 14000);
  assert.equal(r.tarifas_fallback_usado, true);
});

// ── Fuzz: invariantes con entradas aleatorias ───────────────────────
test('fuzz: total finito, no negativo y monótono en horas/km', () => {
  let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cats = ['Sedán', 'SUV', 'V250', 'Ducato', 'Sprinter', 'Minibús', 'Autobús'];
  for (let i = 0; i < 3000; i++) {
    const inp = base({
      categoria: cats[Math.floor(rnd() * cats.length)],
      horas_servicio: Math.round(rnd() * 200 * 2) / 2,
      km_totales: Math.round(rnd() * 1500),
      hora_inicio: `${Math.floor(rnd() * 24)}:${rnd() < 0.5 ? '00' : '30'}`,
      tarifas: undefined, // defaults por categoría
      aeropuerto: rnd() < 0.3,
      is_vip: rnd() < 0.3, vip_percentage: Math.round(rnd() * 30),
      ajuste_pct: Math.round(rnd() * 40 - 10),
      casetas: Math.round(rnd() * 1000),
    });
    const r = cot(inp);
    assert.ok(Number.isFinite(r.total) && r.total >= 0, JSON.stringify(inp));
    // Una hora más de servicio nunca debe bajar el precio (mismo inicio, fuera de aeropuerto)
    if (!inp.aeropuerto) {
      const r2 = cot({ ...inp, horas_servicio: inp.horas_servicio + 1 });
      assert.ok(r2.total >= r.total, `horas ${inp.horas_servicio}→+1 bajó: ${r.total}→${r2.total} ${JSON.stringify(inp)}`);
    }
  }
});

test('aeropuerto: más km nunca cuesta menos (bug 146km)', () => {
  for (const cat of ['Sedán', 'SUV', 'V250', 'Ducato', 'Sprinter', 'Minibús', 'Autobús']) {
    for (const vip of [0, 20]) {
      let prev = 0;
      for (let km = 5; km <= 500; km++) {
        const r = cot(base({ categoria: cat, tarifas: undefined, aeropuerto: true, km_totales: km,
          horas_servicio: 2, is_vip: vip > 0, vip_percentage: vip }));
        assert.ok(r.total >= prev, `${cat} vip${vip} ${km}km: ${prev}→${r.total}`);
        prev = r.total;
      }
    }
  }
});

test('entradas raras: hora con segundos, strings, ajuste -100', () => {
  assert.equal(cot(base({ hora_inicio: '03:00:00', horas_servicio: 48, km_totales: 300 })).dias_cobrados, 3.5);
  const r = cot(base({ horas_servicio: '10', km_totales: '30', ajuste_pct: -100 }));
  assert.ok(Number.isFinite(r.total) && Number.isFinite(r.dias_cobrados));
  const v = cot(base({ hora_inicio: 'abc' }));
  assert.ok(v.warnings.some(w => /hora_inicio/.test(w)));
  const x = cot({});
  assert.ok(Number.isFinite(x.total));
});
