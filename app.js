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

// ========== CAPTURA DEL EVENTO DE INSTALACIÓN PWA ==========
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e; // Guardamos el evento si el dispositivo soporta instalación automática
});

// ========== MANEJO DEL ENRUTADOR / NAVEGACIÓN NATIIVA ==========
document.querySelectorAll('.menu-item').forEach(item => {
  item.addEventListener('click', () => {
    const targetSectionId = item.dataset.target;
    if (!targetSectionId) return; // Si es el botón de instalación, no navega directamente

    const label = item.querySelector('.menu-label').innerText;
    
    // Ocultar menú y mostrar sección destino
    document.getElementById('main-menu').classList.remove('active');
    document.getElementById(targetSectionId).classList.add('active');
    
    // Cambiar header: Hacer visible el botón de retorno y actualizar título
    document.getElementById('btnBackToMenu').style.visibility = 'visible';
    document.getElementById('appTitle').innerText = label;

    // Disparar cargas automáticas según la sección abierta
    if (targetSectionId === 'sec-persons') loadPersons();
    if (targetSectionId === 'sec-attendance') loadAttendanceForToday();
  });
});

// EVENTO DEL BOTÓN DE RETORNO MEJORADO
document.getElementById('btnBackToMenu').addEventListener('click', () => {
  // Ocultar todas las secciones activas
  document.querySelectorAll('.section-content').forEach(sec => sec.classList.remove('active'));
  
  // Reestablecer menú de cuadrícula principal
  document.getElementById('main-menu').classList.add('active');
  
  // Ocultar estéticamente el botón de retorno y restaurar título principal
  document.getElementById('btnBackToMenu').style.visibility = 'hidden';
  document.getElementById('appTitle').innerText = '📋 Asistencia Diaria';
});

// ========== LÓGICA DE INSTALACIÓN / AYUDA ACCESO DIRECTO ==========
document.getElementById('menuInstallBtn').addEventListener('click', async () => {
  if (deferredPrompt) {
    // Si el navegador permite el prompt automático de instalación
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      showStatus('✅ ¡Gracias por instalar la aplicación!', 3000);
    }
    deferredPrompt = null;
  } else {
    // Si ya está instalada o el dispositivo requiere añadirla manualmente (como la mayoría de Android/iOS)
    document.getElementById('pwaHelpModal').classList.add('open');
  }
});

document.getElementById('closePwaHelpBtn').addEventListener('click', () => {
  document.getElementById('pwaHelpModal').classList.remove('open');
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

  const persons = await db.persons.toArray();
  const container = document.getElementById('attendanceList');
  if (persons.length === 0) {
    container.innerHTML = '<p>No hay personas para tomar asistencia.</p>';
    return;
  }

  const saved = await db.attendance.where('date').equals(today).toArray();
  const savedMap = new Map(saved.map(a => [a.personId, a.estado === 'presente']));

  currentAttendanceState = {};
  container.innerHTML = persons.map(p => {
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
  const persons = await db.persons.toArray();
  const previas = await db.attendance.where('date').equals(today).toArray();
  const horasMap = new Map(previas.map(a => [a.personId, a.hora]));

  await db.attendance.where('date').equals(today).delete();
  const horaActual = new Date().toTimeString().split(' ')[0];

  const registros = persons.map(p => ({
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

// ========== SECCIÓN 4: REPORTES (DIARIO Y MENSUAL) ==========
document.getElementById('loadHistoryBtn').addEventListener('click', async () => {
  const fecha = document.getElementById('historyDate').value;
  if (!fecha) { showStatus('Selecciona una fecha', 1500); return; }
  
  const asistencias = await db.attendance.where('date').equals(fecha).toArray();
  const persons = await db.persons.toArray();
  const pMap = new Map(persons.map(p => [p.id, p]));
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

  const persons = await db.persons.toArray();
  if(persons.length === 0 || diasLaborables.length === 0) {
    container.innerHTML = '<p>Sin datos o días laborables válidos.</p>';
    return;
  }

  const asistencias = await db.attendance.where('date').between(`${ano}-${mesPad}-01`, `${ano}-${mesPad}-${String(totalDias).padStart(2,'0')}`, true, true).toArray();
  const mapAsist = new Map(asistencias.map(a => [`${a.personId}-${a.date}`, a.estado]));

  let html = `<table class="report-table">
    <thead><tr><th>Nombre</th><th>Días Lab.</th><th style="color:green;">Pres.</th><th style="color:red;">Inasist.</th></tr></thead><tbody>`;

  persons.forEach(p => {
    let pres = 0, aus = 0;
    diasLaborables.forEach(f => {
      if(mapAsist.get(`${p.id}-${f}`) === 'presente') pres++; else aus++;
    });
    html += `<tr><td><b>${escapeHtml(p.nombre)}</b></td><td>${diasLaborables.length}</td><td>${pres}</td><td style="background:#ffebee; font-weight:bold; color:red;">${aus}</td></tr>`;
  });
  
  container.innerHTML = html + '</tbody></table>';
});

// ========== SECCIÓN 5: ESTADÍSTICAS GENERALES ==========
document.getElementById('loadStatsBtn').addEventListener('click', async () => {
  const mSel = document.getElementById('statsMonth').value;
  if(!mSel) { showStatus('Selecciona un mes', 2000); return; }
  
  const [ano, mes] = mSel.split('-').map(Number);
  const totalDias = new Date(ano, mes, 0).getDate();
  const mesPad = String(mes).padStart(2, '0');

  const diasLaborables = [];
  for(let d=1; d<=totalDias; d++) {
    if (workingDays.includes(new Date(`${ano}/${mesPad}/${String(d).padStart(2,'0')}`).getDay())) {
      diasLaborables.push(`${ano}-${mesPad}-${String(d).padStart(2,'0')}`);
    }
  }

  const persons = await db.persons.toArray();
  if(persons.length === 0 || diasLaborables.length === 0) {
    showStatus('No hay datos suficientes', 2000);
    return;
  }

  const asistencias = await db.attendance.where('date').between(`${ano}-${mesPad}-01`, `${ano}-${mesPad}-${String(totalDias).padStart(2,'0')}`, true, true).toArray();
  const mapAsist = new Map(asistencias.map(a => [`${a.personId}-${a.date}`, a.estado]));

  let totalEsperados = persons.length * diasLaborables.length;
  let realesPresentes = 0;
  let rankingFaltas = [];

  persons.forEach(p => {
    let faltasPersona = 0;
    diasLaborables.forEach(f => {
      if(mapAsist.get(`${p.id}-${f}`) === 'presente') { realesPresentes++; } else { faltasPersona++; }
    });
    rankingFaltas.push({ nombre: p.nombre, faltas: faltasPersona });
  });

  let tasa = totalEsperados > 0 ? Math.round((realesPresentes / totalEsperados) * 100) : 0;
  
  document.getElementById('stat-total-persons').innerText = Math.round(persons.length);
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
  const persons = await db.persons.toArray();
  const pMap = new Map(persons.map(p => [p.id, p]));

  if(asistencias.length === 0) { showStatus('Sin datos para exportar', 2000); return; }

  let filas = asistencias.map(a => {
    const p = pMap.get(a.personId);
    if(!p) return '';
    return `<tr><td>${p.cedula}</td><td>${p.nombre}</td><td>${a.estado.toUpperCase()}</td><td>${a.hora}</td></tr>`;
  }).join('');

  document.getElementById('printArea').innerHTML = `
    <h2>Reporte de Asistencia Diario</h2>
    <p><b>Fecha del Control:</b> ${fecha}</p>
    <table style="width:100%; border-collapse:collapse;" border="1">
      <thead><tr><th>Cédula</th><th>Nombre</th><th>Estado</th><th>Hora</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;
  window.print();
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