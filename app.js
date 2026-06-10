// =========================================================================
// 1. INICIALIZACIÓN DE BASE DE DATOS LOCAL CON DEXIE.JS
// =========================================================================
const db = new Dexie('ControlEjidosDB');
db.version(1).stores({
  localidades: '++id, nombre',
  sectores: '++id, localidadId, nombre',
  hogares: '++id, cedula, nombre, localidadId, sectorId, costera, hijos' 
});

let activeSearchQuery = '';
let selectedImportData = null;
let importType = ''; 
let currentFotoBase64 = ''; 

const localidadesPredefinidas = ["San Pedro", "Bichar", "Guinima", "Amparo", "Guamache", "La Uva", "Zulica"];

document.addEventListener('DOMContentLoaded', async () => {
  await verificarYPrecargarLocalidades();
  actualizarDesplegablesLocalidades();
  loadHogares();
  loadLocalidadesUI();
  loadSectoresUI();
  inicializarManejadorFoto();
  inicializarManejadorGps(); // Nueva inicialización operativa
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
    if (item.id === 'menu-item-update') return;

    const targetId = item.dataset.target;
    if (!targetId) return;

    const label = item.querySelector('.menu-label').innerText;
    
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById(targetId).classList.add('active');
    
    document.getElementById('btnBackToMenu').style.visibility = 'visible';
    document.getElementById('appTitle').innerText = label;

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

document.getElementById('hogarLocalidad').addEventListener('change', async (e) => {
  const locId = parseInt(e.target.value);
  await actualizarDesplegableSectores(locId, 'hogarSector', 'Seleccione un Sector...');
});

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

        let calidad = 0.85;
        let base64Result = '';
        let flagCompreso = false;

        while (calidad > 0.1) {
          base64Result = canvas.toDataURL('image/jpeg', calidad);
          const stringLength = base64Result.length - 'data:image/jpeg;base64,'.length;
          const sizeInBytes = stringLength * (3 / 4);
          
          if (sizeInBytes <= 70000) { 
            flagCompreso = true;
            const sizeInKb = (sizeInBytes / 1024).toFixed(1);
            document.getElementById('hogarFotoStatus').innerText = `Foto optimizada con éxito (${sizeInKb} KB)`;
            break;
          }
          calidad -= 0.1; 
        }

        if (!flagCompreso) {
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
// 3.6 TRADUCTOR DE COORDENADAS DECIMALES A FORMATO DMS (PWA GEOLOCALIZACIÓN)
// =========================================================================
function inicializarManejadorGps() {
  document.getElementById('btnCapturarGps').addEventListener('click', () => {
    if (!navigator.geolocation) {
      showStatus('❌ Tu navegador no soporta geolocalización.');
      return;
    }
    showStatus('🛰️ Conectando con satélites GPS...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        
        const latDms = convertirDecimalAGpsDms(lat, true);
        const lngDms = convertirDecimalAGpsDms(lng, false);
        
        document.getElementById('hogarGps').value = `${latDms} ${lngDms}`;
        showStatus('✅ Coordenadas GPS fijadas con éxito.');
      },
      (error) => {
        console.error(error);
        showStatus('⚠️ Permiso denegado o señal GPS muy débil.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

function convertirDecimalAGpsDms(decimal, esLatitud) {
  const hemisferio = esLatitud 
    ? (decimal >= 0 ? 'N' : 'S') 
    : (decimal >= 0 ? 'E' : 'O');
  
  const absVal = Math.abs(decimal);
  const grados = Math.floor(absVal);
  const minutosDecimal = (absVal - grados) * 60;
  const minutos = Math.floor(minutosDecimal);
  const segundos = ((minutosDecimal - minutos) * 60).toFixed(2);
  
  return `${grados}°${minutos}'${segundos}"${hemisferio}`;
}

// =========================================================================
// 4. MÓDULO: CRUD Y VALIDACIÓN DE HOGARES
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
        ${h.gps ? `<div class="cedula" style="color:#009688;">🛰️ GPS: <strong>${escapeHtml(h.gps)}</strong></div>` : ''}
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
  const gps = document.getElementById('hogarGps').value.trim(); // Lectura del nuevo campo opcional
  const organizacion = document.getElementById('hogarOrganizacion').value;
  const costera = document.getElementById('hogarCostera').value;
  const hijos = parseInt(document.getElementById('hogarHijos').value) || 0;
  const pareja = document.getElementById('hogarPareja').value;
  const anosConst = parseInt(document.getElementById('hogarAnosConst').value) || 0;

  if (!locId || !secId || !nombre || !cedula || !telefono) {
    showStatus('⚠️ Por favor completa todos los campos requeridos (*)');
    return;
  }

  const idAct = idVal ? parseInt(idVal) : null;
  const existeCedula = await db.hogares.where('cedula').equalsIgnoreCase(cedula).first();
  if (existeCedula && (!idAct || existeCedula.id !== idAct)) {
    showStatus('🚨 Error: Esta Cédula de Identidad ya está registrada en el padrón.');
    return;
  }

  const datosHogar = {
    localidadId: locId, sectorId: secId, nombre, cedula, nacionalidad,
    rif, correo, telefono, casaNo, gps, organizacion, costera, hijos, pareja, anosConst,
    foto: currentFotoBase64 
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
  await actualizarDesplegableSectores(h.localidadId, 'hogarSector', 'Seleccione un Sector...');
  document.getElementById('hogarSector').value = h.sectorId;
  document.getElementById('hogarNombre').value = h.nombre;
  document.getElementById('hogarCedula').value = h.cedula;
  document.getElementById('hogarNacionalidad').value = h.nacionalidad;
  document.getElementById('hogarRif').value = h.rif || '';
  document.getElementById('hogarCorreo').value = h.correo || '';
  document.getElementById('hogarTelefono').value = h.telefono;
  document.getElementById('hogarCasaNo').value = h.casaNo || '';
  document.getElementById('hogarGps').value = h.gps || ''; // Carga del valor GPS para edición
  document.getElementById('hogarOrganizacion').value = h.organizacion;
  document.getElementById('hogarCostera').value = h.costera;
  document.getElementById('hogarHijos').value = h.hijos;
  document.getElementById('hogarPareja').value = h.pareja;
  document.getElementById('hogarAnosConst').value = h.anosConst;
  
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

document.getElementById('btnCancelarHogarEdicion').addEventListener('click', () => { resetFormHogar(); });

function resetFormHogar() {
  document.getElementById('hogarId').value = '';
  document.getElementById('hogarLocalidad').value = '';
  document.getElementById('hogarSector').innerHTML = '<option value="">Seleccione una Localidad primero...</option>';
  document.getElementById('hogarNombre').value = '';
  document.getElementById('hogarCedula').value = '';
  document.getElementById('hogarRif').value = '';
  document.getElementById('hogarCorreo').value = '';
  document.getElementById('hogarTelefono').value = '';
  document.getElementById('hogarCasaNo').value = '';
  document.getElementById('hogarGps').value = ''; // Reset físico del campo
  document.getElementById('hogarOrganizacion').value = 'Ninguna';
  document.getElementById('hogarCostera').value = 'No';
  document.getElementById('hogarHijos').value = '0';
  document.getElementById('hogarPareja').value = 'No';
  document.getElementById('hogarAnosConst').value = '0';
  currentFotoBase64 = '';
  document.getElementById('hogarFotoInput').value = '';
  document.getElementById('hogarFotoPreviewContainer').style.display = 'none';
  document.getElementById('hogarFotoStatus').innerText = 'Sin foto cargada';
  document.getElementById('btnCancelarHogarEdicion').style.display = 'none';
}

async function eliminarHogar(id) {
  if (confirm('🚨 ¿Seguro que deseas eliminar este registro de hogar del padrón local?')) {
    await db.hogares.delete(id);
    showStatus('🗑️ Registro eliminado.');
    loadHogares();
  }
}

// =========================================================================
// 5. MÓDULO: MANTENEDOR CRUD DE LOCALIDADES
// =========================================================================
async function loadLocalidadesUI() {
  const locs = await db.localidades.orderBy('nombre').toArray();
  const container = document.getElementById('localidadesList');
  if (locs.length === 0) {
    container.innerHTML = '<p>No hay localidades customizadas.</p>';
    return;
  }
  container.innerHTML = locs.map(l => `
    <div class="person-item">
      <div class="person-info"><div class="nombre">📍 ${escapeHtml(l.nombre)}</div></div>
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

  if (idVal) {
    await db.localidades.update(parseInt(idVal), { nombre });
    showStatus('🔄 Localidad actualizada');
  } else {
    await db.localidades.add({ nombre });
    showStatus('✅ Localidad añadida');
  }
  resetFormLoc(); loadLocalidadesUI(); actualizarDesplegablesLocalidades();
});

function editarLoc(id, nombre) {
  document.getElementById('locId').value = id;
  document.getElementById('locNombre').value = nombre;
  document.getElementById('btnCancelarLocEdicion').style.display = 'block';
}
document.getElementById('btnCancelarLocEdicion').addEventListener('click', () => { resetFormLoc(); });
function resetFormLoc() {
  document.getElementById('locId').value = '';
  document.getElementById('locNombre').value = '';
  document.getElementById('btnCancelarLocEdicion').style.display = 'none';
}

async function eliminarLoc(id) {
  const vinculados = await db.hogares.where('localidadId').equals(id).count();
  if (vinculados > 0) {
    showStatus(`🚨 Imposible eliminar: existen ${vinculados} hogares asociados a esta localidad.`);
    return;
  }
  if (confirm('¿Eliminar esta localidad permanentemente?')) {
    await db.localidades.delete(id);
    showStatus('🗑️ Localidad removida.');
    loadLocalidadesUI(); actualizarDesplegablesLocalidades();
  }
}

// =========================================================================
// 6. MÓDULO: MANTENEDOR CRUD DE SECTORES
// =========================================================================
async function loadSectoresUI() {
  const secs = await db.sectores.toArray();
  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const container = document.getElementById('sectoresList');
  
  if (secs.length === 0) {
    container.innerHTML = '<p>No hay sectores asignados.</p>';
    return;
  }
  container.innerHTML = secs.map(s => `
    <div class="person-item">
      <div class="person-info">
        <div class="nombre">🧭 ${escapeHtml(s.nombre)}</div>
        <div class="cedula">Adscrito a: <strong>${escapeHtml(mapLoc.get(s.localidadId) || 'Desconocido')}</strong></div>
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

  if (!locId || !nombre) { showStatus('⚠️ Completa los campos obligatorios'); return; }

  if (idVal) {
    await db.sectores.update(parseInt(idVal), { localidadId: locId, nombre });
    showStatus('🔄 Sector actualizado');
  } else {
    await db.sectores.add({ localidadId: locId, nombre });
    showStatus('✅ Sector guardado');
  }
  resetFormSec(); loadSectoresUI();
});

function editarSec(id, locId, nombre) {
  document.getElementById('secId').value = id;
  document.getElementById('secLocalidadBelongs').value = locId;
  document.getElementById('secNombre').value = nombre;
  document.getElementById('btnCancelarSecEdicion').style.display = 'block';
}
document.getElementById('btnCancelarSecEdicion').addEventListener('click', () => { resetFormSec(); });
function resetFormSec() {
  document.getElementById('secId').value = '';
  document.getElementById('secLocalidadBelongs').value = '';
  document.getElementById('secNombre').value = '';
  document.getElementById('btnCancelarSecEdicion').style.display = 'none';
}

async function eliminarSec(id) {
  const vinculados = await db.hogares.where('sectorId').equals(id).count();
  if (vinculados > 0) {
    showStatus(`🚨 Bloqueado: hay ${vinculados} hogares habitando este sector.`);
    return;
  }
  if (confirm('¿Eliminar sector?')) {
    await db.sectores.delete(id);
    showStatus('🗑️ Sector removido');
    loadSectoresUI();
  }
}

// =========================================================================
// 7. MOTOR DE REPORTES CONSOLIDADO INTEGRADO
// =========================================================================
function limpiarInterfazReportes() {
  document.getElementById('repLocalidad').value = '';
  document.getElementById('repSector').innerHTML = '<option value="">-- Todos los Sectores --</option>';
  document.getElementById('repCostera').value = 'TODOS';
  document.getElementById('repCarga').value = 'TODOS';
  document.getElementById('reportTableBody').innerHTML = `<tr><td colspan="7" style="text-align:center; color:#999; padding:20px;">Utiliza los filtros superiores para renderizar la sábana de datos.</td></tr>`;
  document.getElementById('statTotalHogares').innerText = '0';
  document.getElementById('statTotalHijos').innerText = '0';
  document.getElementById('statTotalCostera').innerText = '0';
}

document.getElementById('btnFiltrarReporte').addEventListener('click', async () => {
  const locId = parseInt(document.getElementById('repLocalidad').value);
  const secId = parseInt(document.getElementById('repSector').value);
  const costeraFilter = document.getElementById('repCostera').value;
  const cargaFilter = document.getElementById('repCarga').value;

  let dataset = await db.hogares.toArray();

  if (locId) dataset = dataset.filter(h => h.localidadId === locId);
  if (secId) dataset = dataset.filter(h => h.sectorId === secId);
  if (costeraFilter !== 'TODOS') dataset = dataset.filter(h => h.costera === costeraFilter);
  if (cargaFilter === 'CON_HIJOS') dataset = dataset.filter(h => h.hijos > 0);
  if (cargaFilter === 'SIN_HIJOS') dataset = dataset.filter(h => h.hijos === 0);

  const mapLoc = new Map((await db.localidades.toArray()).map(l => [l.id, l.nombre]));
  const mapSec = new Map((await db.sectores.toArray()).map(s => [s.id, s.nombre]));

  let cChicos = 0;
  let cCosta = 0;

  if (dataset.length === 0) {
    document.getElementById('reportTableBody').innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px;">Ningún hogar coincide con el criterio de filtrado parametrizado.</td></tr>`;
  } else {
    document.getElementById('reportTableBody').innerHTML = dataset.map(h => {
      cChicos += h.hijos;
      if (h.costera === 'Si') cCosta++;
      return `
        <tr>
          <td><strong>${escapeHtml(h.cedula)}</strong></td>
          <td>${escapeHtml(h.nombre)}</td>
          <td><small>${escapeHtml(mapLoc.get(h.localidadId))}<br>🧭 ${escapeHtml(mapSec.get(h.sectorId))}</small></td>
          <td>${escapeHtml(h.telefono)}</td>
          <td>${h.hijos}</td>
          <td>${h.costera}</td>
          <td>${escapeHtml(h.organizacion)}</td>
        </tr>`;
    }).join('');
  }

  document.getElementById('statTotalHogares').innerText = dataset.length;
  document.getElementById('statTotalHijos').innerText = cChicos;
  document.getElementById('statTotalCostera').innerText = cCosta;
});

document.getElementById('btnImprimirReporte').addEventListener('click', () => {
  document.getElementById('printMetaDate').innerText = `Fecha de Emisión Oficial: ${ObtenerFechaCompacta()} | Procesado de forma segura local PWA`;
  window.print();
});

// =========================================================================
// 8. SUBSISTEMA DE RESPALDO Y PORTABILIDAD LOCAL
// =========================================================================
document.getElementById('btnExportarTodo').addEventListener('click', async () => {
  const dataExportacion = {
    localidades: await db.localidades.toArray(),
    sectores: await db.sectores.toArray(),
    hogares: await db.hogares.toArray()
  };
  const jsonString = JSON.stringify(dataExportacion, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const tempLink = document.createElement('a');
  tempLink.href = url;
  tempLink.download = `RESPALDO_EJIDOS_${ObtenerFechaCompacta()}.json`;
  document.body.appendChild(tempLink);
  tempLink.click();
  document.body.removeChild(tempLink);
  URL.revokeObjectURL(url);
  showStatus('✅ Respaldo descargado con éxito.');
});

document.getElementById('btnClickFile').addEventListener('click', () => {
  document.getElementById('fileInputImport').click();
});

document.getElementById('fileInputImport').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('fileInfoLabel').innerText = `Archivo cargado: ${file.name}`;
  
  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const parsed = JSON.parse(event.target.result);
      if (parsed.localidades && parsed.sectores && parsed.hogares) {
        selectedImportData = parsed;
        importType = 'completa';
        document.getElementById('btnProcesarImportacion').style.display = 'block';
        showStatus('📦 Estructura válida detectada. Listo para consolidar.');
      } else {
        throw new Error();
      }
    } catch (err) {
      showStatus('❌ Archivo incompatible o corrupto.');
      selectedImportData = null;
      document.getElementById('fileInfoLabel').innerText = 'Ningún archivo seleccionado';
      document.getElementById('btnProcesarImportacion').style.display = 'none';
    }
  };
  reader.readAsText(file);
});

document.getElementById('btnProcesarImportacion').addEventListener('click', async () => {
  if (!selectedImportData) return;
  if (confirm('🚨 ¡PRECAUCIÓN! Importar este archivo reescribirá la data actual del dispositivo por completo. ¿Deseas continuar?')) {
    try {
      await db.hogares.clear();
      await db.sectores.clear();
      await db.localidades.clear();

      for (let l of selectedImportData.localidades) { await db.localidades.add(l); }
      for (let s of selectedImportData.sectores) { await db.sectores.add(s); }
      for (let h of selectedImportData.hogares) { await db.hogares.add(h); }

      showStatus('⚡ ¡Importación de Datos Completada Exitosamente!');
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

document.getElementById('btnResetearTodo').addEventListener('click', async () => {
  if (confirm('🚨 ¿ATENCIÓN? Esta acción borrará de manera PERMANENTE todo el padrón de hogares, sectores y localidades personalizadas. ¿Proceder?')) {
    if (confirm('🚨 Confirmación final: ¿Seguro que deseas reiniciar el almacenamiento local?')) {
      await db.hogares.clear();
      await db.sectores.clear();
      await db.localidades.clear();
      
      await verificarYPrecargarLocalidades();
      await actualizarDesplegablesLocalidades();
      
      showStatus('🗑️ Base de datos reestablecida con éxito.');
      setTimeout(() => { document.getElementById('btnBackToMenu').click(); }, 1000);
    }
  }
});

function ObtenerFechaCompacta() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =========================================================================
// 9. GESTOR DE ACTUALIZACIONES AUTOMÁTICAS Y MANUALES DE LA PWA
// =========================================================================
let clickRegistration = null;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        clickRegistration = reg;
        
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              solicitarActualizacionAlUsuario();
            }
          });
        });
      })
      .catch(err => console.error('Error registrando Service Worker:', err));
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

document.getElementById('menu-item-update').addEventListener('click', async () => {
  if (!clickRegistration) {
    showStatus('⚠️ El Service Worker no está activo en este navegador.');
    return;
  }

  showStatus('🔍 Buscando actualizaciones en el servidor...');
  
  try {
    await clickRegistration.update();
    
    setTimeout(() => {
      if (!clickRegistration.installing && !clickRegistration.waiting) {
        showStatus('✅ Tienes instalada la versión más reciente.');
      }
    }, 1200);
    
  } catch (error) {
    console.error(error);
    showStatus('❌ Error al conectar con el servidor. Verifica tu red.');
  }
});

function solicitarActualizacionAlUsuario() {
  if (confirm('📦 ¡Nueva actualización disponible del sistema! ¿Deseas actualizar la aplicación ahora mismo para cargar los cambios técnicos?')) {
    showStatus('⚡ Actualizando archivos del sistema...');
    if (clickRegistration && clickRegistration.waiting) {
      clickRegistration.waiting.postMessage({ action: 'skipWaiting' });
    } else {
      window.location.reload();
    }
  }
}