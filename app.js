// =========================================================================
// 1. INICIALIZACIÓN DE BASE DE DATOS LOCAL CON DEXIE.JS
// =========================================================================
const db = new Dexie('ControlEjidosDB');
db.version(1).stores({
  localidades: '++id, nombre',
  sectores: '++id, localidadId, nombre',
  hogares: '++id, cedula, nombre, localidadId, sectorId, costera, hijos' // Mantiene compatibilidad nativa
});

// Variables de estado global de la interfaz
let activeSearchQuery = '';
let selectedImportData = null;
let importType = ''; // 'completa' o 'estructura'
let currentFotoBase64 = ''; // Almacena temporalmente la foto procesada de la casa en Base64

// Localidades iniciales requeridas por especificación técnica
const localidadesPredefinidas = ["San Pedro", "Bichar", "Guinima", "Amparo", "Guamache", "La Uva", "Zulica"];

// Precarga automática al arrancar la app
document.addEventListener('DOMContentLoaded', async () => {
  await verificarYPrecargarLocalidades();
  actualizarDesplegablesLocalidades();
  loadHogares();
  loadLocalidadesUI();
  loadSectoresUI();
  inicializarManejadorFoto();
});

async function verificarYPrecargarLocalidades() {
  const count = await db.localidades.count();
  if (count === 0) {
    for (let loc of localidadesPredefinidas) {
      await db.localidades.add({ nombre: loc.trim() });
    }
  }
}

// =========================================================================
// 2. SISTEMA NATIVO DE ENRUTAMIENTO Y MENÚ COMPARTIDO
// =========================================================================
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const targetId = item.dataset.target;
    if (!targetId) return;

    const label = item.querySelector('.menu-label').innerText;
    
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById(targetId).classList.add('active');
    
    document.getElementById('btnBackToMenu').style.visibility = 'visible';
    document.getElementById('appTitle').innerText = label;

    // Ejecuciones reactivas al abrir módulos
    if (targetId === 'sec-hogares') { loadHogares(); resetFormHogar(); }
    if (targetId === 'sec-localidades') { loadLocalidadesUI(); resetFormLoc(); }
    if (targetId === 'sec-sectores') { loadSectoresUI(); resetFormSec(); }
    if (targetId === 'sec-reportes') { limpiarInterfazReportes(); }
    actualizarDesplegablesLocalidades();
  });
});

document.getElementById('btnBackToMenu').addEventListener('click', () => {
  document.querySelectorAll('.section-content').forEach(sec => sec.classList.remove('active'));
  document.getElementById('main-menu').classList.add('active');
  document.getElementById('btnBackToMenu').style.visibility = 'hidden';
  document.getElementById('appTitle').innerText = '🏠 Control de Ejidos';
});

// Helper de avisos rápidos integrados (Toast)
function showStatus(message, duration = 3000) {
  const toast = document.getElementById('toastStatus');
  toast.innerText = message;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, duration);
}

// =========================================================================
// 3. REACTIVIDAD DINÁMICA: LOCALIDAD ➡️ SECTOR
// =========================================================================
async function actualizarDesplegablesLocalidades() {
  const locs = await db.localidades.orderBy('nombre').toArray();
  
  const optionsHtml = '<option value="">Seleccione...</option>' + 
    locs.map(l => `<option value="${l.id}">${escapeHtml(l.nombre)}</option>`).join('');
  
  document.getElementById('hogarLocalidad').innerHTML = optionsHtml;
  document.getElementById('secLocalidadBelongs').innerHTML = optionsHtml;
  document.getElementById('repLocalidad').innerHTML = '<option value="">-- Todas --</option>' + locs.map(l => `<option value="${l.id}">${escapeHtml(l.nombre)}</option>`).join('');
}

// Evento disparador al cambiar localidad en formulario de hogares
document.getElementById('hogarLocalidad').addEventListener('change', async (e) => {
  const locId = parseInt(e.target.value);
  await actualizarDesplegableSectores(locId, 'hogarSector', 'Seleccione un Sector...');
});

// Evento disparador en Filtros de Reportes
document.getElementById('repLocalidad').addEventListener('change', async (e) => {
  const locId = parseInt(e.target.value);
  if (!locId) {
    document.getElementById('hogarSector').innerHTML = '<option value="">Seleccione una Localidad primero...</option>';
    return;
  }
  await actualizarDesplegableSectores(locId, 'repSector', '-- Todos los Sectores --');
});

async function actualizarDesplegableSectores(localidadId, targetSelectId, defaultText) {
  const selectNode = document.getElementById(targetSelectId);
  if (!localidadId) {
    selectNode.innerHTML = `<option value="">${defaultText}</option>`;
    return;
  }
  const secs = await db.sectores.where('localidadId').equals(localidadId).toArray();
  if (secs.length === 0) {
    selectNode.innerHTML = '<option value="">No existen sectores aquí...</option>';
  } else {
    selectNode.innerHTML = `<option value="">${defaultText}</option>` + 
      secs.map(s => `<option value="${s.id}">${escapeHtml(s.nombre)}</option>`).join('');
  }
}

// =========================================================================
// 3.5 ALGORITMO DE OPTIMIZACIÓN Y COMPRESIÓN DE FOTOS CASAS (< 70KB)
// =========================================================================
function inicializarManejadorFoto() {
  const fotoInput = document.getElementById('hogarFotoInput');
  const btnQuitar = document.getElementById('btnQuitarFoto');

  fotoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showStatus('⚙️ Optimizando peso de la imagen...');
    const reader = new FileReader();
    reader.onload = function(event) {
      const img = new Image();
      img.onload = function() {
        // Reducción inicial de escala a un tamaño HD operativo estándar
        let width = img.width;
        let height = img.height;
        const maxDimension = 1024;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height *= maxDimension / width;
            width = maxDimension;
          } else {
            width *= maxDimension / height;
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Compresión recursiva iterativa bajando calidad para asegurar que pese menos de 70kb
        let calidad = 0.85;
        let base64Result = '';
        let flagCompreso = false;

        while (calidad > 0.1) {
          base64Result = canvas.toDataURL('image/jpeg', calidad);
          // Calcular tamaño estimado del Base64 resultante en bytes
          const stringLength = base64Result.length - 'data:image/jpeg;base64,'.length;
          const sizeInBytes = stringLength * (3 / 4);
          
          if (sizeInBytes <= 70000) { // 70 KB límite estricto
            flagCompreso = true;
            const sizeInKb = (sizeInBytes / 1024).toFixed(1);
            document.getElementById('hogarFotoStatus').innerText = `Foto optimizada con éxito (${sizeInKb} KB)`;
            break;
          }
          calidad -= 0.1; // Reduce la calidad en pasos del 10%
        }

        if (!flagCompreso) {
          // Ajuste de emergencia en resolución si la compresión por calidad no bastó
          canvas.width = width * 0.6;
          canvas.height = height * 0.6;
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          base64Result = canvas.toDataURL('image/jpeg', 0.4);
          document.getElementById('hogarFotoStatus').innerText = `Foto reajustada bajo límite de peso.`;
        }

        currentFotoBase64 = base64Result;
        mostrarVistaPreviaFoto(currentFotoBase64);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  btnQuitar.addEventListener('click', () => {
    currentFotoBase64 = '';
    fotoInput.value = '';
    document.getElementById('hogarFotoPreviewContainer').style.display = 'none';
    document.getElementById('hogarFotoPreview').src = '';
    document.getElementById('hogarFotoStatus').innerText = 'Sin foto cargada';
  });
}

function mostrarVistaPreviaFoto(base64Data) {
  const container = document.getElementById('hogarFotoPreviewContainer');
  const imgElement = document.getElementById('hogarFotoPreview');
  if (base64Data) {
    imgElement.src = base64Data;
    container.style.display = 'block';
  } else {
    container.style.display = 'none';
    imgElement.src = '';
  }
}

// =========================================================================
// 4. MÓDULO: CRUD Y VALIDACIÓN DE HOGARES (PROCESO PRINCIPAL)
// =========================================================================
async function loadHogares() {
  let list = await db.hogares.toArray();
  const container = document.getElementById('hogaresList');
  
  if (list.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:#666;">No hay hogares registrados en este dispositivo.</p>';
    return;
  }

  if (activeSearchQuery.trim() !== '') {
    const q = activeSearchQuery.toLowerCase().trim();
    list = list.filter(h => h.nombre.toLowerCase().includes(q) || h.cedula.toLowerCase().includes(q));
  }

  // Mapeos rápidos para mostrar textos en lugar de IDs numéricos de Dexie
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const mapSec = new Map((await db.sectores.toArray()).map(s => [s.id, s.nombre]));

  container.innerHTML = list.map(h => `
    <div class="person-item" style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
      ${h.foto ? `
        <div style="flex: 0 0 70px; text-align: center;">
          <img src="${h.foto}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 6px; border: 1px solid #ccc;" alt="Miniatura casa">
        </div>
      ` : `
        <div style="flex: 0 0 70px; height: 70px; background: #e0e0e0; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: #9e9e9e;">
          🏠
        </div>
      `}
      <div class="person-info" style="flex: 1; min-width: 200px;">
        <div class="nombre">${escapeHtml(h.nombre)}</div>
        <div class="cedula">C.I: <strong>${escapeHtml(h.cedula)}</strong> | Casa: ${escapeHtml(h.casaNo) || 'N/A'}</div>
        <div class="cedula" style="color:#1976D2; font-weight:500;">
          📍 ${escapeHtml(mapLoc.get(h.localidadId) || 'Indefinida')} - 🧭 ${escapeHtml(mapSec.get(h.sectorId) || 'Sin Sector')}
        </div>
        <div class="cedula">Hijos: ${h.hijos} | Costa: ${h.costera} | Inst: ${h.organizacion}</div>
      </div>
      <div class="action-buttons" style="flex: 0 0 auto;">
        <button class="btn-action" onclick="editarHogar(${h.id})">Editar</button>
        <button class="btn-action delete" onclick="eliminarHogar(${h.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('searchHogarInput').addEventListener('input', (e) => {
  activeSearchQuery = e.target.value;
  loadHogares();
});

document.getElementById('btnGuardarHogar').addEventListener('click', async () => {
  const idVal = document.getElementById('hogarId').value;
  const locId = parseInt(document.getElementById('hogarLocalidad').value);
  const secId = parseInt(document.getElementById('hogarSector').value);
  const nombre = document.getElementById('hogarNombre').value.trim();
  const cedula = document.getElementById('hogarCedula').value.trim();
  const nacionalidad = document.getElementById('hogarNacionalidad').value;
  const rif = document.getElementById('hogarRif').value.trim();
  const correo = document.getElementById('hogarCorreo').value.trim();
  const telefono = document.getElementById('hogarTelefono').value.trim();
  const casaNo = document.getElementById('hogarCasaNo').value.trim();
  const organizacion = document.getElementById('hogarOrganizacion').value;
  const costera = document.getElementById('hogarCostera').value;
  const hijos = parseInt(document.getElementById('hogarHijos').value) || 0;
  const pareja = document.getElementById('hogarPareja').value;
  const anosConst = parseInt(document.getElementById('hogarAnosConst').value) || 0;

  if (!locId || !secId || !nombre || !cedula || !telefono) {
    showStatus('⚠️ Por favor completa todos los campos requeridos (*)');
    return;
  }

  // Restricción estricta de no duplicidad de Cédulas
  const idAct = idVal ? parseInt(idVal) : null;
  const existeCedula = await db.hogares.where('cedula').equalsIgnoreCase(cedula).first();
  if (existeCedula && (!idAct || existeCedula.id !== idAct)) {
    showStatus('🚨 Error: Esta Cédula de Identidad ya está registrada en el padrón.');
    return;
  }

  const datosHogar = {
    localidadId: locId, sectorId: secId, nombre, cedula, nacionalidad,
    rif, correo, telefono, casaNo, organizacion, costera, hijos, pareja, anosConst,
    foto: currentFotoBase64 // Integración directa en la estructura relacional JSON
  };

  if (idAct) {
    await db.hogares.update(idAct, datosHogar);
    showStatus('🔄 Datos del hogar actualizados con éxito');
  } else {
    await db.hogares.add(datosHogar);
    showStatus('✅ Nuevo hogar registrado en el padrón');
  }

  resetFormHogar();
  loadHogares();
});

async function editarHogar(id) {
  const h = await db.hogares.get(id);
  if (!h) return;
  document.getElementById('hogarId').value = h.id;
  document.getElementById('hogarLocalidad').value = h.localidadId;
  
  // Forzar actualización sincrónica del select dependiente antes de asignar el valor
  await actualizarDesplegableSectores(h.localidadId, 'hogarSector', 'Seleccione un Sector...');
  document.getElementById('hogarSector').value = h.sectorId;

  document.getElementById('hogarNombre').value = h.nombre;
  document.getElementById('hogarCedula').value = h.cedula;
  document.getElementById('hogarNacionalidad').value = h.nacionalidad;
  document.getElementById('hogarRif').value = h.rif || '';
  document.getElementById('hogarCorreo').value = h.correo || '';
  document.getElementById('hogarTelefono').value = h.telefono;
  document.getElementById('hogarCasaNo').value = h.casaNo || '';
  document.getElementById('hogarOrganizacion').value = h.organizacion;
  document.getElementById('hogarCostera').value = h.costera;
  document.getElementById('hogarHijos').value = h.hijos;
  document.getElementById('hogarPareja').value = h.pareja;
  document.getElementById('hogarAnosConst').value = h.anosConst;

  // Carga y edición reactiva de la fotografía adjunta
  currentFotoBase64 = h.foto || '';
  if (currentFotoBase64) {
    mostrarVistaPreviaFoto(currentFotoBase64);
    document.getElementById('hogarFotoStatus').innerText = 'Foto guardada cargada. Puede cambiarla o eliminarla.';
  } else {
    document.getElementById('hogarFotoPreviewContainer').style.display = 'none';
    document.getElementById('hogarFotoStatus').innerText = 'Sin foto cargada';
  }

  document.getElementById('btnCancelarHogarEdicion').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('btnCancelarHogarEdicion').addEventListener('click', resetFormHogar);

function resetFormHogar() {
  document.getElementById('hogarId').value = '';
  document.getElementById('hogarNombre').value = '';
  document.getElementById('hogarCedula').value = '';
  document.getElementById('hogarRif').value = '';
  document.getElementById('hogarCorreo').value = '';
  document.getElementById('hogarTelefono').value = '';
  document.getElementById('hogarCasaNo').value = '';
  document.getElementById('hogarHijos').value = '0';
  document.getElementById('hogarAnosConst').value = '0';
  document.getElementById('hogarLocalidad').value = '';
  document.getElementById('hogarSector').innerHTML = '<option value="">Seleccione una Localidad primero...</option>';
  document.getElementById('btnCancelarHogarEdicion').style.display = 'none';
  
  // Limpieza del estado de cámara
  currentFotoBase64 = '';
  document.getElementById('hogarFotoInput').value = '';
  document.getElementById('hogarFotoPreviewContainer').style.display = 'none';
  document.getElementById('hogarFotoPreview').src = '';
  document.getElementById('hogarFotoStatus').innerText = 'Sin foto cargada';
}

async function eliminarHogar(id) {
  if (confirm('¿Está seguro de eliminar de forma permanente este registro de hogar?')) {
    await db.hogares.delete(id);
    loadHogares();
    showStatus('Registro eliminado');
  }
}

// =========================================================================
// 5. MÓDULO: SECCIÓN CRUD PARA ADMINISTRAR LOCALIDADES
// =========================================================================
async function loadLocalidadesUI() {
  const locs = await db.localidades.orderBy('nombre').toArray();
  const container = document.getElementById('localidadesList');
  container.innerHTML = locs.map(l => `
    <div class="person-item">
      <div class="person-info"><div class="nombre">${escapeHtml(l.nombre)}</div></div>
      <div class="action-buttons">
        <button class="btn-action" onclick="editarLoc(${l.id}, '${escapeHtml(l.nombre)}')">Editar</button>
        <button class="btn-action delete" onclick="eliminarLoc(${l.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('btnGuardarLoc').addEventListener('click', async () => {
  const idVal = document.getElementById('locId').value;
  const nombre = document.getElementById('locNombre').value.trim();
  if (!nombre) return;

  // Validar duplicidad de Localidades
  const existe = await db.localidades.where('nombre').equalsIgnoreCase(nombre).first();
  const idAct = idVal ? parseInt(idVal) : null;
  if (existe && (!idAct || existe.id !== idAct)) {
    showStatus('🚨 Esta localidad ya se encuentra dada de alta.');
    return;
  }

  if (idAct) {
    await db.localidades.update(idAct, { nombre });
    showStatus('Localidad actualizada');
  } else {
    await db.localidades.add({ nombre });
    showStatus('Localidad agregó');
  }
  resetFormLoc();
  loadLocalidadesUI();
});

function editarLoc(id, nombre) {
  document.getElementById('locId').value = id;
  document.getElementById('locNombre').value = nombre;
  document.getElementById('btnCancelarLoc').style.display = 'block';
}
document.getElementById('btnCancelarLoc').addEventListener('click', resetFormLoc);
function resetFormLoc() {
  document.getElementById('locId').value = '';
  document.getElementById('locNombre').value = '';
  document.getElementById('btnCancelarLoc').style.display = 'none';
}

async function eliminarLoc(id) {
  const count = await db.hogares.where('localidadId').equals(id).count();
  if (count > 0) {
    showStatus(`❌ No se puede borrar. Hay ${count} hogares vinculados a ella.`);
    return;
  }
  if (confirm('¿Eliminar esta localidad?')) {
    await db.localidades.delete(id);
    await db.sectores.where('localidadId').equals(id).delete();
    loadLocalidadesUI();
    showStatus('Localidad borrada');
  }
}

// =========================================================================
// 6. MÓDULO: SECCIÓN CRUD PARA ADMINISTRAR SECTORES
// =========================================================================
async function loadSectoresUI() {
  const secs = await db.sectores.toArray();
  const locs = await db.localidades.toArray();
  const mapLoc = new Map(locs.map(l => [l.id, l.nombre]));
  const container = document.getElementById('sectoresList');

  if (secs.length === 0) {
    container.innerHTML = '<p style="color:#666;">No hay sectores cargados.</p>';
    return;
  }

  container.innerHTML = secs.map(s => `
    <div class="person-item">
      <div class="person-info">
        <div class="nombre">${escapeHtml(s.nombre)}</div>
        <div class="cedula">Pertenece a: <strong>${escapeHtml(mapLoc.get(s.localidadId) || 'Desconocida')}</strong></div>
      </div>
      <div class="action-buttons">
        <button class="btn-action" onclick="editarSec(${s.id}, ${s.localidadId}, '${escapeHtml(s.nombre)}')">Editar</button>
        <button class="btn-action delete" onclick="eliminarSec(${s.id})">Eliminar</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('btnGuardarSec').addEventListener('click', async () => {
  const idVal = document.getElementById('secId').value;
  const locId = parseInt(document.getElementById('secLocalidadBelongs').value);
  const nombre = document.getElementById('secNombre').value.trim();
  if (!locId || !nombre) { showStatus('⚠️ Completa la Localidad y el Nombre.'); return; }

  // Restricción: No duplicados del mismo Sector BAJO LA MISMA Localidad
  const idAct = idVal ? parseInt(idVal) : null;
  const existe = await db.sectores.where({ localidadId: locId, nombre: nombre }).first();
  if (existe && (!idAct || existe.id !== idAct)) {
    showStatus('🚨 Este sector ya se encuentra registrado en esa misma localidad.');
    return;
  }

  if (idAct) {
    await db.sectores.update(idAct, { localidadId: locId, nombre });
    showStatus('Sector modificado');
  } else {
    await db.sectores.add({ localidadId: locId, nombre });
    showStatus('Sector añadido');
  }
  resetFormSec();
  loadSectoresUI();
});

function editarSec(id, locId, nombre) {
  document.getElementById('secId').value = id;
  document.getElementById('secLocalidadBelongs').value = locId;
  document.getElementById('secNombre').value = nombre;
  document.getElementById('btnCancelarSec').style.display = 'block';
}
document.getElementById('btnCancelarSec').addEventListener('click', resetFormSec);
function resetFormSec() {
  document.getElementById('secId').value = '';
  document.getElementById('secLocalidadBelongs').value = '';
  document.getElementById('secNombre').value = '';
  document.getElementById('btnCancelarSec').style.display = 'none';
}

async function eliminarSec(id) {
  const count = await db.hogares.where('sectorId').equals(id).count();
  if (count > 0) {
    showStatus(`❌ Imposible borrar. Existen ${count} hogares en este sector.`);
    return;
  }
  if (confirm('¿Eliminar este sector?')) {
    await db.sectores.delete(id);
    loadSectoresUI();
    showStatus('Sector borrado');
  }
}

// =========================================================================
// 7. MOTOR INTERACTIVO DE REPORTES EXIGIDOS
// =========================================================================
document.getElementById('repTipo').addEventListener('change', (e) => {
  const tipo = e.target.value;
  document.getElementById('divRepFiltroLocalidad').style.display = (tipo === 'localidad' || tipo === 'sector') ? 'block' : 'none';
  document.getElementById('divRepFiltroSector').style.display = (tipo === 'sector') ? 'block' : 'none';
});

function limpiarInterfazReportes() {
  document.getElementById('cardResultadosReporte').style.display = 'none';
  document.getElementById('btnImprimirReporte').style.display = 'none';
  document.getElementById('repTipo').value = 'localidad';
  document.getElementById('divRepFiltroLocalidad').style.display = 'block';
  document.getElementById('divRepFiltroSector').style.display = 'none';
}

document.getElementById('btnGenerarReporte').addEventListener('click', async () => {
  const tipo = document.getElementById('repTipo').value;
  const locFiltro = parseInt(document.getElementById('repLocalidad').value);
  const secFiltro = parseInt(document.getElementById('repSector').value);

  let data = await db.hogares.toArray();
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const mapSec = new Map((await db.sectores.toArray()).map(s => [s.id, s.nombre]));

  let htmlResult = '';
  let tituloReporte = '';

  if (tipo === 'localidad') {
    if (locFiltro) data = data.filter(h => h.localidadId === locFiltro);
    tituloReporte = `Reporte por Localidad: ${locFiltro ? mapLoc.get(locFiltro) : 'Todas'}`;
    htmlResult = construirTablaEstandar(data, mapLoc, mapSec);
  } 
  else if (tipo === 'sector') {
    if (locFiltro) data = data.filter(h => h.localidadId === locFiltro);
    if (secFiltro) data = data.filter(h => h.sectorId === secFiltro);
    tituloReporte = `Reporte por Sector: ${secFiltro ? mapSec.get(secFiltro) : 'Todos'}`;
    htmlResult = construirTablaEstandar(data, mapLoc, mapSec);
  } 
  else if (tipo === 'costera') {
    data = data.filter(h => h.costera === 'Si');
    tituloReporte = `Reporte Específico: Fajas en Zona Costera`;
    htmlResult = `
      <table class="report-table">
        <thead>
          <tr>
            <th>Foto</th>
            <th>Localidad</th>
            <th>Sector</th>
            <th>Cabeza de Hogar</th>
            <th>Cédula</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(h => `
            <tr>
              <td style="text-align:center;">
                ${h.foto ? `<img src="${h.foto}" style="width:40px; height:40px; object-fit:cover; border-radius:4px;">` : '🏠'}
              </td>
              <td>${escapeHtml(mapLoc.get(h.localidadId))}</td>
              <td>${escapeHtml(mapSec.get(h.sectorId))}</td>
              <td><strong>${escapeHtml(h.nombre)}</strong></td>
              <td>${escapeHtml(h.cedula)}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="text-align:center;">No hay viviendas en zona costera.</td></tr>'}
        </tbody>
      </table>`;
  } 
  else if (tipo === 'hijos') {
    data = data.filter(h => h.hijos > 0);
    tituloReporte = `Reporte de Familias con Hijos Registrados`;
    htmlResult = construirTablaEstandar(data, mapLoc, mapSec);
  }

  document.getElementById('reporteContenidoTabla').innerHTML = `
    <div style="margin-bottom:15px; font-weight:bold; color:#1976D2; font-size:1.1rem;">${tituloReporte} (Total: ${data.length} hogares)</div>
    ${htmlResult}
  `;
  
  document.getElementById('cardResultadosReporte').style.display = 'block';
  document.getElementById('btnImprimirReporte').style.display = data.length > 0 ? 'inline-block' : 'none';
});

function construirTablaEstandar(data, mapLoc, mapSec) {
  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>Vivienda</th>
          <th>Cédula</th>
          <th>Nombre</th>
          <th>Ubicación</th>
          <th>Vínculo / Organización</th>
          <th>Hijos</th>
          <th>Años Const.</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(h => `
          <tr>
            <td style="text-align:center; vertical-align:middle;">
              ${h.foto ? `<img src="${h.foto}" style="width:45px; height:45px; object-fit:cover; border-radius:4px;" alt="Casa">` : '🏠'}
            </td>
            <td>${escapeHtml(h.cedula)}</td>
            <td><strong>${escapeHtml(h.nombre)}</strong></td>
            <td>${escapeHtml(mapLoc.get(h.localidadId))}<br><small style="color:#666;">${escapeHtml(mapSec.get(h.sectorId))}</small></td>
            <td>${escapeHtml(h.organizacion)}</td>
            <td style="text-align:center;">${h.hijos}</td>
            <td style="text-align:center;">${h.anosConst}</td>
          </tr>
        `).join('') || '<tr><td colspan="7" style="text-align:center;">Ningún registro coincide con los filtros aplicados.</td></tr>'}
      </tbody>
    </table>`;
}

// Evento nativo de impresión limpia mediante CSS de la PWA
document.getElementById('btnImprimirReporte').addEventListener('click', () => {
  window.print();
});

// =========================================================================
// 8. COPIAS DE SEGURIDAD Y CARGAS EXCLUSIVAS EN FORMATO .JSON
// =========================================================================
function descargarArchivoJson(objetoData, nombreArchivo) {
  const blob = new Blob([JSON.stringify(objetoData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// REQUERIMIENTO: JSON de la data cargada completa de toda la app (las fotos se exportan nativamente aquí)
document.getElementById('btnExpDataCompleta').addEventListener('click', async () => {
  const backup = {
    formato: "ejidos_pwa_completa",
    fecha: new Date().toISOString(),
    localidades: await db.localidades.toArray(),
    sectores: await db.sectores.toArray(),
    hogares: await db.hogares.toArray()
  };
  descargarArchivoJson(backup, `Ejidos-DataCompleta-${ObtenerFechaCompacta()}.json`);
  showStatus('📥 Respaldo global descargado');
});

// REQUERIMIENTO: JSON exclusivo de localidades y sus sectores
document.getElementById('btnExpLocSectores').addEventListener('click', async () => {
  const estructura = {
    formato: "ejidos_estructura_geografica",
    fecha: new Date().toISOString(),
    localidades: await db.localidades.toArray(),
    sectores: await db.sectores.toArray()
  };
  descargarArchivoJson(estructura, `Ejidos-EstructuraGeografica-${ObtenerFechaCompacta()}.json`);
  showStatus('📥 Archivo de estructura descargado');
});

// Lógica de lectura y Parsing
document.getElementById('btnClickFile').addEventListener('click', () => {
  document.getElementById('fileInputImport').click();
});

document.getElementById('fileInputImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('fileInfoLabel').innerText = `📄 ${file.name}`;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (parsed.formato === "ejidos_pwa_completa" || parsed.formato === "ejidos_estructura_geografica") {
        selectedImportData = parsed;
        importType = parsed.formato;
        document.getElementById('btnProcesarImportacion').style.display = 'block';
        showStatus('✅ JSON válido. Listo para procesar.');
      } else {
        throw new Error();
      }
    } catch {
      selectedImportData = null;
      document.getElementById('btnProcesarImportacion').style.display = 'none';
      document.getElementById('fileInfoLabel').innerText = '❌ Error: Estructura JSON incompatible.';
    }
  };
  reader.readAsText(file);
});

document.getElementById('btnProcesarImportacion').addEventListener('click', async () => {
  if (!selectedImportData) return;

  if (confirm('¿Confirmas la consolidación? Se añadirán los registros no existentes.')) {
    try {
      // 1. Procesar Localidades primero
      if (selectedImportData.localidades) {
        for (let l of selectedImportData.localidades) {
          let ex = await db.localidades.where('nombre').equalsIgnoreCase(l.nombre).first();
          if (!ex) await db.localidades.add({ nombre: l.nombre });
        }
      }
      // 2. Procesar Sectores
      if (selectedImportData.sectores) {
        for (let s of selectedImportData.sectores) {
          let ex = await db.sectores.where({ localidadId: s.localidadId, nombre: s.nombre }).first();
          if (!ex) await db.sectores.add({ localidadId: s.localidadId, nombre: s.nombre });
        }
      }
      // 3. Procesar Hogares si es el backup de Data Completa
      if (importType === "ejidos_pwa_completa" && selectedImportData.hogares) {
        let countHogares = 0;
        for (let h of selectedImportData.hogares) {
          let ex = await db.hogares.where('cedula').equalsIgnoreCase(h.cedula).first();
          if (!ex) {
            await db.hogares.add(h);
            countHogares++;
          }
        }
        showStatus(`⚡ Procesado. Se añadieron ${countHogares} nuevos hogares.`);
      } else {
        showStatus(`⚡ Estructura geográfica integrada correctamente.`);
      }

      // Reiniciar selectores de la UI
      document.getElementById('fileInputImport').value = '';
      document.getElementById('fileInfoLabel').innerText = 'Ningún archivo seleccionado';
      document.getElementById('btnProcesarImportacion').style.display = 'none';
      selectedImportData = null;
      actualizarDesplegablesLocalidades();

    } catch (err) {
      console.error(err);
      showStatus('❌ Ocurrió un fallo en la escritura de base de datos.');
    }
  }
});

// REQUERIMIENTO: Permitir resetear la data
document.getElementById('btnResetearTodo').addEventListener('click', async () => {
  if (confirm('🚨 ¿ATENCIÓN? Esta acción borrará de manera PERMANENTE todo el padrón de hogares, sectores y localidades personalizadas. ¿Proceder?')) {
    if (confirm('🚨 Confirmación final: ¿Seguro que deseas reiniciar el almacenamiento local?')) {
      await db.hogares.clear();
      await db.sectores.clear();
      await db.localidades.clear();
      
      // Volver a inyectar las de fábrica por comodidad operativa
      await verificarYPrecargarLocalidades();
      await actualizarDesplegablesLocalidades();
      
      showStatus('🗑️ Base de datos reestablecida con éxito.');
      setTimeout(() => { document.getElementById('btnBackToMenu').click(); }, 1000);
    }
  }
});

// Utilidades Generales
function ObtenerFechaCompacta() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'\"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
}