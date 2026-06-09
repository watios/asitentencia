// Inicializar base de datos con IndexedDB de Dexie
const db = new Dexie('AsistenciaDB');
db.version(3).stores({
  persons: '++id, cedula, nombre, sexo',
  attendance: '++id, personId, date, estado, hora',
  settings: 'key, value' 
});

let deferredPrompt = null; 
let searchFilterQuery = ''; 
let workingDays = [1, 2, 3, 4, 5]; // Lunes a Viernes por defecto
let loadedBackupData = null; // Variable temporal para guardar el JSON parseado

// ========== FUNCIÓN AUXILIAR: FECHA ACTUAL (AAAA-MM-DD) ==========
function getFormattedCurrentDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ========== FUNCIÓN AUXILIAR: OBTENER NOMBRE DEL MES EN ESPAÑOL ==========
function getMonthNameInSpanish(monthNumber) {
  const meses = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
  ];
  return meses[monthNumber - 1] || "Mes";
}

// ========== CAPTURA DEL EVENTO DE INSTALACIÓN PWA ==========
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// ========== MANEJO DEL ENRUTADOR / NAVEGACIÓN NATIIVA ==========
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const targetSectionId = item.dataset.target;
    if (!targetSectionId) return;

    const label = item.querySelector('.menu-label').innerText;
    
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById(targetSectionId).classList.add('active');
    
    document.getElementById('btnBackToMenu').style.visibility = 'visible';
    document.getElementById('appTitle').innerText = label;

    if (targetSectionId === 'sec-persons') loadPersons();
    if (targetSectionId === 'sec-attendance') loadAttendanceForToday();
  });
});

document.getElementById('btnBackToMenu').addEventListener('click', () => {
  document.querySelectorAll('.section-content').forEach(sec => sec.classList.remove('active'));
  document.getElementById('main-menu').classList.add('active');
  document.getElementById('btnBackToMenu').style.visibility = 'hidden';
  document.getElementById('appTitle').innerText = '📋 Asistencia Diaria';
});

// ========== LÓGICA DE INSTALACIÓN / AYUDA ACCESO DIRECTO ==========
document.getElementById('menuInstallBtn').addEventListener('click', async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showStatus('✅ ¡Gracias por instalar la aplicación!', 3000);
    }
    deferredPrompt = null;
  } else {
    document.getElementById('pwaHelpModal').classList.add('open');
  }
});

document.getElementById('closePwaHelpBtn').addEventListener('click', () => {
  document.getElementById('pwaHelpModal').classList.remove('open');
});

// ========== RESPALDOS (JSON EXPORT CON NOMENCLATURA CONFIGURADA) ==========
function triggerFileDownload(jsonData, defaultFileName) {
  const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultFileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// 1. Respaldo por Mes y Año Seleccionado
document.getElementById('btnBackupMonth').addEventListener('click', async () => {
  const monthValue = document.getElementById('backupMonthPicker').value; // Ejemplo: "2026-06"
  if (!monthValue) { showStatus('⚠️ Selecciona un mes y año para respaldar', 2500); return; }

  const [year, month] = monthValue.split('-').map(Number);
  const totalDias = new Date(year, month, 0).getDate();
  const monthPad = String(month).padStart(2, '0');

  const records = await db.attendance
    .where('date')
    .between(`${year}-${monthPad}-01`, `${year}-${monthPad}-${String(totalDias).padStart(2, '0')}`, true, true)
    .toArray();

  if (records.length === 0) {
    showStatus('📭 No hay registros de asistencia en el periodo elegido', 2500);
    return;
  }

  const backupData = {
    tipoRespaldo: "asistencia_mensual",
    periodo: monthValue,
    fechaExportacion: new Date().toISOString(),
    datos: records
  };

  const nombreMesStr = getMonthNameInSpanish(month);
  const fileName = `RespaldoAsistencia-${nombreMesStr}-${getFormattedCurrentDate()}.json`;
  triggerFileDownload(backupData, fileName);
  showStatus('📥 Respaldo mensual generado', 2000);
});

// 2. Respaldo exclusivo de Personal
document.getElementById('btnBackupPersons').addEventListener('click', async () => {
  const persons = await db.persons.toArray();
  if (persons.length === 0) { showStatus('⚠️ La lista de personal está vacía', 2500); return; }

  const backupData = {
    tipoRespaldo: "personal_completo",
    fechaExportacion: new Date().toISOString(),
    datos: persons
  };

  const fileName = `RespaldoAsistencia-Personal-${getFormattedCurrentDate()}.json`;
  triggerFileDownload(backupData, fileName);
  showStatus('📥 Lista de personas descargada', 2000);
});

// 3. Respaldo General (Toda la BD)
document.getElementById('btnBackupAll').addEventListener('click', async () => {
  const persons = await db.persons.toArray();
  const attendance = await db.attendance.toArray();
  const settings = await db.settings.toArray();

  const backupData = {
    tipoRespaldo: "base_datos_completa",
    fechaExportacion: new Date().toISOString(),
    tablas: {
      persons: persons,
      attendance: attendance,
      settings: settings
    }
  };

  const fileName = `RespaldoAsistencia-Total-${getFormattedCurrentDate()}.json`;
  triggerFileDownload(backupData, fileName);
  showStatus('📦 Respaldo total descargado con éxito', 2500);
});

// ========== MÓDULO: CARGAR / IMPORTAR RESPALDOS ==========
document.getElementById('btnTriggerFileInput').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  document.getElementById('selectedFileInfo').innerText = `📄 ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
  
  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      loadedBackupData = JSON.parse(evt.target.result);
      if (loadedBackupData.tipoRespaldo || loadedBackupData.tablas) {
        document.getElementById('btnProcessImport').style.display = 'block';
        showStatus('✅ Archivo analizado correctamente. Listo para importar.', 2000);
      } else {
        throw new Error("Formato no válido");
      }
    } catch(err) {
      loadedBackupData = null;
      document.getElementById('btnProcessImport').style.display = 'none';
      document.getElementById('selectedFileInfo').innerText = '❌ Error: El archivo no tiene el formato de respaldo de la app';
      showStatus('❌ Archivo incompatible', 3000);
    }
  };
  reader.readAsText(file);
});

document.getElementById('btnProcessImport').addEventListener('click', async () => {
  if (!loadedBackupData) return;

  try {
    if (loadedBackupData.tipoRespaldo === "base_datos_completa" || loadedBackupData.tablas) {
      if (confirm('Esta acción combinará y actualizará el sistema con todos los datos guardados. ¿Continuar?')) {
        for (let p of loadedBackupData.tablas.persons) {
          let existe = await db.persons.where('cedula').equals(p.cedula).first();
          if (!existe) {
            await db.persons.add({ cedula: p.cedula, nombre: p.nombre, sexo: p.sexo || 'M' });
          }
        }
        for (let a of loadedBackupData.tablas.attendance) {
          let existeAsist = await db.attendance.where({ personId: a.personId, date: a.date }).first();
          if (!existeAsist) {
            await db.attendance.add({ personId: a.personId, date: a.date, estado: a.estado, hora: a.hora || '--:--:--' });
          }
        }
        for (let s of loadedBackupData.tablas.settings) {
          await db.settings.put(s);
        }
        await loadSettings();
        showStatus('📦 Base de datos completa restaurada e integrada con éxito', 3500);
      }
    }
    else if (loadedBackupData.tipoRespaldo === "personal_completo" && loadedBackupData.datos) {
      let count = 0;
      for (let p of loadedBackupData.datos) {
        let existe = await db.persons.where('cedula').equals(p.cedula).first();
        if (!existe) {
          await db.persons.add({ cedula: p.cedula, nombre: p.nombre, sexo: p.sexo || 'M' });
          count++;
        }
      }
      showStatus(`👥 Personal importado: ${count} nuevas personas agregadas`, 3000);
    }
    else if (loadedBackupData.tipoRespaldo === "asistencia_mensual" && loadedBackupData.datos) {
      let count = 0;
      for (let a of loadedBackupData.datos) {
        let existeAsist = await db.attendance.where({ personId: a.personId, date: a.date }).first();
        if (!existeAsist) {
          await db.attendance.add({ personId: a.personId, date: a.date, estado: a.estado, hora: a.hora || '--:--:--' });
          count++;
        }
      }
      showStatus(`📅 Historial cargado: ${count} registros añadidos con éxito`, 3000);
    }

    document.getElementById('importFileInput').value = '';
    document.getElementById('selectedFileInfo').innerText = 'Ningún archivo seleccionado';
    document.getElementById('btnProcessImport').style.display = 'none';
    loadedBackupData = null;

  } catch (error) {
    console.error(error);
    showStatus('❌ Ocurrió un error procesando los datos internos', 3000);
  }
});

// ========== CONFIGURACIÓN DE DÍAS LABORABLES ==========
async function loadSettings() {
  const savedDays = await db.settings.get('workingDays');
  if (savedDays) {
    workingDays = savedDays.value;
  } else {
    await db.settings.put({ key: 'workingDays', value: workingDays });
  }
  [0, 1, 2, 3, 4, 5, 6].forEach(day => {
    const chk = document.getElementById(`workDay-${day}`);
    if (chk) chk.checked = workingDays.includes(day);
  });
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const selectedDays = [];
  [0, 1, 2, 3, 4, 5, 6].forEach(day => {
    const chk = document.getElementById(`workDay-${day}`);
    if (chk && chk.checked) selectedDays.push(day);
  });
  workingDays = selectedDays;
  await db.settings.put({ key: 'workingDays', value: workingDays });
  showStatus('⚙️ Configuración semanal guardada con éxito', 2000);
});

// ========== CRUD PERSONAS ==========
async function loadPersons() {
  let persons = await db.persons.toArray();
  const container = document.getElementById('personList');
  if (persons.length === 0) {
    container.innerHTML = '<p>No hay personas registradas.</p>';
    return;
  }
  if (searchFilterQuery.trim() !== '') {
    const query = searchFilterQuery.toLowerCase().trim();
    persons = persons.filter(p => p.nombre.toLowerCase().includes(query) || p.cedula.toLowerCase().includes(query));
  }
  
  container.innerHTML = persons.map(p => `
    <div class="person-item">
      <div class="person-info">
        <div class="nombre">${escapeHtml(p.nombre)} <span class="tag-sexo">(${escapeHtml(p.sexo || 'M')})</span></div>
        <div class="cedula">C.I: ${escapeHtml(p.cedula)}</div>
      </div>
      <div class="action-buttons">
        <button class="edit-person btn-action" data-id="${p.id}">Editar</button>
        <button class="delete-person btn-action delete" data-id="${p.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  document.querySelectorAll('.delete-person').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('¿Eliminar persona e historial completo?')) return;
      const id = parseInt(btn.dataset.id);
      await db.persons.delete(id);
      await db.attendance.where('personId').equals(id).delete();
      loadPersons();
      showStatus('Persona eliminada', 1500);
    });
  });

  document.querySelectorAll('.edit-person').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      const p = await db.persons.get(id);
      if (p) {
        document.getElementById('editPersonId').value = p.id;
        document.getElementById('editPersonName').value = p.nombre;
        document.getElementById('editPersonCedula').value = p.cedula;
        document.getElementById('editPersonSexo').value = p.sexo || 'M';
        document.getElementById('editPersonModal').classList.add('open');
      }
    });
  });
}

document.getElementById('searchPersonInput').addEventListener('input', (e) => {
  searchFilterQuery = e.target.value;
  loadPersons();
});

document.getElementById('addPersonBtn').addEventListener('click', async () => {
  const nombre = document.getElementById('personName').value.trim();
  const cedula = document.getElementById('personCedula').value.trim();
  const sexo = document.getElementById('personSexo').value;
  if (!nombre || !cedula) { showStatus('Completa los campos', 2000); return; }
  
  const existe = await db.persons.where('cedula').equals(cedula).first();
  if (existe) { showStatus('Cédula duplicada', 2000); return; }
  
  await db.persons.add({ nombre, cedula, sexo });
  document.getElementById('personName').value = '';
  document.getElementById('personCedula').value = '';
  loadPersons();
  showStatus('Persona registrada', 1500);
});

document.getElementById('cancelEditBtn').addEventListener('click', () => {
  document.getElementById('editPersonModal').classList.remove('open');
});

document.getElementById('saveEditBtn').addEventListener('click', async () => {
  const id = parseInt(document.getElementById('editPersonId').value);
  const nombre = document.getElementById('editPersonName').value.trim();
  const cedula = document.getElementById('editPersonCedula').value.trim();
  const sexo = document.getElementById('editPersonSexo').value;

  if (!nombre || !cedula) { showStatus('No dejes campos vacíos', 2000); return; }
  await db.persons.update(id, { nombre, cedula, sexo });
  document.getElementById('editPersonModal').classList.remove('open');
  loadPersons();
  showStatus('Cambios guardados', 1500);
});

// ========== PASAR ASISTENCIA DE HOY ==========
function getTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let currentAttendanceState = {};

async function loadAttendanceForToday() {
  const today = getTodayISO();
  const dayOfWeek = new Date().getDay();
  document.getElementById('todayDate').innerText = `Hoy: ${today}`;
  document.getElementById('workDayWarning').style.display = workingDays.includes(dayOfWeek) ? 'none' : 'block';

  const presidential_persons = await db.persons.toArray();
  const container = document.getElementById('attendanceList');
  if (presidential_persons.length === 0) {
    container.innerHTML = '<p>No hay personas para tomar asistencia.</p>';
    return;
  }

  const saved = await db.attendance.where('date').equals(today).toArray();
  const savedMap = new Map(saved.map(a => [a.personId, a.estado === 'presente']));

  currentAttendanceState = {};
  container.innerHTML = presidential_persons.map(p => {
    currentAttendanceState[p.id] = savedMap.has(p.id) ? savedMap.get(p.id) : false;
    return `
      <div class="attendance-item">
        <label style="display:flex; width:100%; gap:10px; align-items:center; cursor:pointer;">
          <input type="checkbox" ${currentAttendanceState[p.id] ? 'checked' : ''} data-id="${p.id}" style="width:auto; margin:0;">
          <span><strong>${escapeHtml(p.nombre)}</strong> (${escapeHtml(p.cedula)})</span>
        </label>
      </div>
    `;
  }).join('');

  container.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      currentAttendanceState[parseInt(chk.dataset.id)] = chk.checked;
    });
  });
}

document.getElementById('saveAttendanceBtn').addEventListener('click', async () => {
  const today = getTodayISO();
  const presidential_persons = await db.persons.toArray();
  const previas = await db.attendance.where('date').equals(today).toArray();
  const horasMap = new Map(previas.map(a => [a.personId, a.hora]));

  await db.attendance.where('date').equals(today).delete();
  const horaActual = new Date().toTimeString().split(' ')[0];

  const registros = presidential_persons.map(p => ({
    personId: p.id,
    date: today,
    estado: currentAttendanceState[p.id] ? 'presente' : 'ausente',
    hora: currentAttendanceState[p.id] ? (horasMap.get(p.id) || horaActual) : '--:--:--'
  }));

  if(registros.length > 0) {
    await db.attendance.bulkAdd(registros);
    showStatus('📝 Asistencia del día guardada', 2000);
  }
});

// ========== REPORTES (DIARIO Y MENSUAL) ==========
document.getElementById('loadHistoryBtn').addEventListener('click', async () => {
  const fecha = document.getElementById('historyDate').value;
  if (!fecha) { showStatus('Selecciona una fecha', 1500); return; }
  
  const asistencias = await db.attendance.where('date').equals(fecha).toArray();
  const presidential_persons = await db.persons.toArray();
  const pMap = new Map(presidential_persons.map(p => [p.id, p]));
  const resultDiv = document.getElementById('historyResult');

  if(asistencias.length === 0) {
    resultDiv.innerHTML = '<p>📭 No hay asistencia guardada para esta fecha.</p>';
    return;
  }

  resultDiv.innerHTML = '<h4>Resultados de Lista:</h4>' + asistencias.map(a => {
    const p = pMap.get(a.personId);
    if(!p) return '';
    return `<div style="padding:6px 0; border-bottom:1px solid #f0f0f0;">
      ${a.estado === 'presente' ? '✅' : '❌'} <b>${escapeHtml(p.nombre)}</b> - ${a.estado.toUpperCase()} (${a.hora})
    </div>`;
  }).join('');
});

document.getElementById('loadMonthlyReportBtn').addEventListener('click', async () => {
  const selectedMonth = document.getElementById('reportMonth').value;
  const container = document.getElementById('monthlyReportResult');
  if(!selectedMonth) { showStatus('Selecciona Mes/Año', 2000); return; }

  const [ano, mes] = selectedMonth.split('-').map(Number);
  const totalDias = new Date(ano, mes, 0).getDate();
  const mesPad = String(mes).padStart(2, '0');

  const diasLaborables = [];
  for(let d=1; d<=totalDias; d++) {
    const diaPad = String(d).padStart(2, '0');
    if (workingDays.includes(new Date(`${ano}/${mesPad}/${diaPad}`).getDay())) {
      diasLaborables.push(`${ano}-${mesPad}-${diaPad}`);
    }
  }

  const presidential_persons = await db.persons.toArray();
  if(presidential_persons.length === 0 || diasLaborables.length === 0) {
    container.innerHTML = '<p>Sin datos o días laborables válidos.</p>';
    return;
  }

  const asistencias = await db.attendance.where('date').between(`${ano}-${mesPad}-01`, `${ano}-${mesPad}-${String(totalDias).padStart(2,'0')}`, true, true).toArray();
  const mapAsist = new Map(asistencias.map(a => [`${a.personId}-${a.date}`, a.estado]));

  let html = `<table class="report-table">
    <thead><tr><th>Nombre</th><th>Días Lab.</th><th style="color:green;">Pres.</th><th style="color:red;">Inasist.</th></tr></thead><tbody>`;

  presidential_persons.forEach(p => {
    let pres = 0, aus = 0;
    diasLaborables.forEach(f => {
      if(mapAsist.get(`${p.id}-${f}`) === 'presente') pres++; else aus++;
    });
    html += `<tr><td><b>${escapeHtml(p.nombre)}</b></td><td>${diasLaborables.length}</td><td>${pres}</td><td style="background:#ffebee; font-weight:bold; color:red;">${aus}</td></tr>`;
  });
  
  container.innerHTML = html + '</tbody></table>';
});

// ========== ESTADÍSTICAS GENERALES ==========
document.getElementById('loadStatsBtn').addEventListener('click', async () => {
  const mSel = document.getElementById('statsMonth').value;
  if(!mSel) { showStatus('Selecciona un mes', 2000); return; }
  
  const [ano, mes] = mSel.split('-').map(Number);
  const totalDias = new Date(ano, mes, 0).getDate();
  const mesPad = String(mes).padStart(2, '0');

  const diasLaborables = [];
  for(let d=1; d<=totalDias; d++) {
    if (workingDays.includes(new Date(`${ano}/${mesPad}-${String(d).padStart(2,'0')}`).getDay())) {
      diasLaborables.push(`${ano}-${mesPad}-${String(d).padStart(2,'0')}`);
    }
  }

  const presidential_persons = await db.persons.toArray();
  if(presidential_persons.length === 0 || diasLaborables.length === 0) {
    showStatus('No hay datos suficientes', 2000);
    return;
  }

  const asistencias = await db.attendance.where('date').between(`${ano}-${mesPad}-01`, `${ano}-${mesPad}-${String(totalDias).padStart(2,'0')}`, true, true).toArray();
  const mapAsist = new Map(asistencias.map(a => [`${a.personId}-${a.date}`, a.estado]));

  let totalEsperados = presidential_persons.length * diasLaborables.length;
  let realesPresentes = 0;
  let rankingFaltas = [];

  presidential_persons.forEach(p => {
    let faltasPersona = 0;
    diasLaborables.forEach(f => {
      if(mapAsist.get(`${p.id}-${f}`) === 'presente') { realesPresentes++; } else { faltasPersona++; }
    });
    rankingFaltas.push({ nombre: p.nombre, faltas: faltasPersona });
  });

  let tasa = totalEsperados > 0 ? Math.round((realesPresentes / totalEsperados) * 100) : 0;
  
  document.getElementById('stat-total-persons').innerText = Math.round(presidential_persons.length);
  document.getElementById('stat-working-days').innerText = Math.round(diasLaborables.length);
  document.getElementById('stat-attendance-rate').innerText = `${tasa}%`;

  rankingFaltas.sort((a,b) => b.faltas - a.faltas);
  
  document.getElementById('statsTopAbsences').innerHTML = rankingFaltas.slice(0, 5).map(r => `
    <div style="display:flex; justify-content:space-between; padding:8px; border-bottom:1px solid #eee; background:${r.faltas > 3 ? '#fff3e0' : 'none'}">
      <span>👤 ${escapeHtml(r.nombre)}</span>
      <span style="font-weight:bold; color:#d32f2f;">${r.faltas} inasistencias</span>
    </div>
  `).join('');

  document.getElementById('statsResult').style.display = 'block';
});

// ========== EXPORTACIÓN PDF DIARIO ==========
document.getElementById('generatePdfBtn').addEventListener('click', async () => {
  const fecha = document.getElementById('historyDate').value;
  if (!fecha) { showStatus('Selecciona una fecha', 2000); return; }
  
  const asistencias = await db.attendance.where('date').equals(fecha).toArray();
  const presidential_persons = await db.persons.toArray();
  const pMap = new Map(presidential_persons.map(p => [p.id, p]));

  if(asistencias.length === 0) { showStatus('Sin datos para exportar', 2000); return; }

  let filas = asistencias.map(a => {
    const p = pMap.get(a.personId);
    if(!p) return '';
    return `<tr><td>${p.cedula}</td><td>${p.nombre}</td><td>${a.estado.toUpperCase()}</td><td>${a.hora}</td></tr>`;
  }).join('');

  // Formatear la fecha visualmente para el encabezado de impresión (ej: 09/06/2026)
  const [aaa, mmm, ddd] = fecha.split('-');
  const fechaFormateada = `${ddd}/${mmm}/${aaa}`;

  // Se reestructura con un <h1> limpio: "Reporte de Asistencia" y la fecha abajo.
  document.getElementById('printArea').innerHTML = `
    <h1>Reporte de Asistencia</h1>
    <p><b>Fecha del reporte:</b> ${fechaFormateada}</p>
    <table>
      <thead>
        <tr>
          <th>Cédula</th>
          <th>Nombre</th>
          <th>Estado</th>
          <th>Hora</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;
  window.print();
});

// ========== MODULO: RESETEAR TODA LA BASE DE DATOS ==========
document.getElementById('resetAllDataBtn').addEventListener('click', async () => {
  if (!confirm('⚠️ ¿ESTÁS SEGURO? Esta acción borrará de forma PERMANENTE a todo el personal registrado y el historial de asistencias.')) {
    return;
  }
  
  if (!confirm('🚨 ¿Confirmar reseteo total? Perderás todos los datos locales si no has descargado un respaldo.')) {
    return;
  }

  try {
    await db.persons.clear();
    await db.attendance.clear();
    await db.settings.clear();

    workingDays = [1, 2, 3, 4, 5];
    await db.settings.put({ key: 'workingDays', value: workingDays });
    
    await loadSettings();

    showStatus('🔥 Todos los datos han sido eliminados con éxito', 3500);
    
    setTimeout(() => {
      document.getElementById('btnBackToMenu').click();
    }, 1000);

  } catch (error) {
    console.error(error);
    showStatus('❌ Error al intentar resetear la base de datos', 3000);
  }
});

// ========== UTILIDADES GENERALES ==========
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
}

function showStatus(msg, duration) {
  const div = document.getElementById('statusMsg');
  div.innerText = msg; div.classList.add('show');
  setTimeout(() => div.classList.remove('show'), duration);
}

// Inicialización automática
(async () => {
  await loadSettings();
})();