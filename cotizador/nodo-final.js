// Nodo final de n8n: arma la respuesta con las unidades cotizadas.
// Toma aeropuerto, hospedaje y estacionamiento del cotizador (tarifa.js);
// ya no usa una tabla propia de aeropuerto.
const items = $input.all().map(i => i.json);

const calculos   = items.filter(i => i.renta_subtotal !== undefined);
const vehiculos  = items.filter(i => i.numero_economico);
const itinerario = items.find(i => i.reserva_id && i.dias_detalle) || {};
const empresa    = items.find(i => i.slug);

const kmTotales        = itinerario.distancia_total_km || 0;
const casetasBase      = itinerario.costo_casetas || 0;
const horasManejo      = itinerario.horas_manejo_totales || 0;
const maxHorasTramo    = itinerario.max_horas_manejadas_en_tramo || 0;
const numPasajeros     = itinerario.num_pasajeros || 1;
const porcentajeCurvas = itinerario.porcentaje_curvas || 0;
const fechaInicio      = itinerario.fecha_inicio;
const fechaFin         = itinerario.fecha_fin || itinerario.fecha_inicio;
const diasDetalle      = itinerario.dias_detalle || [];
const diasTotales      = itinerario.dias_base;

const CASETAS_MULTIPLICADOR = {
  SEDAN:         1.0,
  SUV:           1.0,
  V250:          1.0,
  DUCATO:        1.0,
  VAN:           1.0,
  MINIBUS:       2.0,
  MIDSIZE_BUS:   2.0,
  LARGE_BUS:     2.0,
  DOUBLE_DECKER: 2.5
};

const requiereSegundoConductor = maxHorasTramo > 8;

const unidadesFinales = calculos.map(c => {
  const v = vehiculos.find(v => v.id === c.vehiculo_id) || {};

  // Casetas: si el cotizador ya las recibió, se usan esas; si no, las del itinerario.
  const multiplicadorCasetas = CASETAS_MULTIPLICADOR[c.categoria] || 1.0;
  const costosCasetas = (c.casetas_subtotal || 0) > 0
    ? c.casetas_subtotal
    : (c.es_foraneo ? Math.round(casetasBase * multiplicadorCasetas) : 0);

  // Segundo conductor: si el operador configuró second_driver_cost se usa ese;
  // si no, la regla de este nodo (tramo de más de 8h = 50% de day1).
  const segundoConductorCosto = (c.segundo_conductor_costo || 0) > 0
    ? c.segundo_conductor_costo
    : (requiereSegundoConductor ? Math.round(c.renta_day1_rate * 0.5) : 0);

  // Aeropuerto (derecho de piso), hospedaje y estacionamiento: vienen del cotizador.
  const costoAeropuerto = c.aeropuerto_costo || 0;
  const costoHospedaje  = (c.hospedaje_costo || 0) + (c.estacionamiento_costo || 0);

  const subtotal = c.renta_subtotal + c.combustible_subtotal + (c.penalizacion_costo || 0)
                 + costoAeropuerto + costoHospedaje + segundoConductorCosto + costosCasetas;
  const iva16 = c.es_foraneo ? Math.round(subtotal * 0.16) : 0;
  const total = Math.round(subtotal + iva16);

  return {
    id_unidad:         c.vehiculo_id,
    marca:             v.modelo              || '',
    modelo:            v.numero_economico    || '',
    capacidad:         v.capacidad_pasajeros || 0,
    placas:            '',
    precio_total:      total,
    precio_por_km:     c.combustible_km > 0 ? Math.round((c.combustible_subtotal / c.combustible_km) * 100) / 100 : 0,
    fotos:             v.fotos      || [],
    caracteristicas:   v.amenidades || [],
    disponible_fechas: [fechaInicio, fechaFin],
    desglose: {
      renta:             c.renta_subtotal,
      combustible:       c.combustible_subtotal,
      penalizacion:      c.penalizacion_costo || 0,
      aeropuerto:        costoAeropuerto,
      hospedaje:         costoHospedaje,
      segundo_conductor: segundoConductorCosto,
      casetas:           costosCasetas,
      subtotal,
      iva:               iva16,
      total
    },
    _desglose_detallado: {
      categoria_tabla: c.categoria,
      tipo_viaje:      c.es_foraneo ? 'FORANEO' : 'LOCAL',
      dias_totales:    diasTotales,
      dias_cobrados:   c.dias_cobrados,
      renta_bloque:    c.renta_bloque,
      tarifa_dia1:     c.renta_day1_rate,
      costo_renta:     c.renta_subtotal,
      vip_porcentaje:  c.renta_es_vip ? c.renta_vip_porcentaje : 0,
      ...(c.es_foraneo && {
        rendimiento_normal:    c.combustible_km_litro,
        litros_totales:        c.combustible_litros,
        precio_diesel:         c.combustible_precio_litro,
        costo_combustible:     c.combustible_subtotal,
        casetas_sedan_base:    casetasBase,
        casetas_multiplicador: multiplicadorCasetas,
        casetas:               costosCasetas
      }),
      ...(costoAeropuerto > 0 && {
        aeropuerto_categoria: c.categoria,
        aeropuerto_costo:     costoAeropuerto
      }),
      ...(costoHospedaje > 0 && {
        hospedaje_noches: c.hospedaje_noches,
        hospedaje_costo:  costoHospedaje
      }),
      ...(segundoConductorCosto > 0 && {
        max_horas_tramo:                maxHorasTramo,
        costo_segundo_conductor:        segundoConductorCosto,
        base_calculo_segundo_conductor: (c.segundo_conductor_costo || 0) > 0
          ? 'second_driver_cost del operador'
          : `50% de day1_rate ($${c.renta_day1_rate})`
      }),
      warnings:    c.warnings || [],
      subtotal,
      iva_16:      iva16,
      total_final: total
    }
  };
});

unidadesFinales.sort((a, b) => a.precio_total - b.precio_total);

return [{
  json: {
    itinerario_completo: {
      itinerario:      diasDetalle,
      numero_personas: numPasajeros,
      accion:          'availability_check'
    },
    unidades_disponibles: {
      fecha_inicio:               fechaInicio,
      fecha_fin:                  fechaFin,
      total_unidades_disponibles: unidadesFinales.length,
      unidades:                   unidadesFinales
    },
    solicitud: {
      total_personas: numPasajeros,
      total_dias:     diasTotales,
      resumen_ruta: {
        km_totales:      Math.round(kmTotales),
        horas_totales:   Math.round(horasManejo * 10) / 10,
        casetas_totales: casetasBase,
        max_horas_tramo: maxHorasTramo
      }
    },
    sugerencia: unidadesFinales.slice(0, 3).map(u => ({
      marca:              u.marca,
      capacidad:          u.capacidad,
      unidades_sugeridas: u.capacidad > 0 ? Math.ceil(numPasajeros / u.capacidad) : 1,
      precio_unitario:    u.precio_total,
      precio_total:       u.precio_total * (u.capacidad > 0 ? Math.ceil(numPasajeros / u.capacidad) : 1)
    })),
    accion: 'availability_check',
    _debug_general: {
      empresa:                      empresa?.slug || null,
      vehiculos_totales:            calculos.length,
      capacidad_minima_requerida:   numPasajeros,
      dias_reserva:                 diasTotales,
      max_horas_manejadas_en_tramo: maxHorasTramo,
      requiere_segundo_conductor:   requiereSegundoConductor,
      recogida_aeropuerto:          calculos.some(c => c.aeropuerto_aplica),
      km_totales:                   kmTotales,
      porcentaje_curvas:            porcentajeCurvas,
      casetas_base_sedan:           casetasBase
    }
  }
}];
