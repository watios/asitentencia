// Inicializar base de datos
const db = new Dexie('AsistenciaDB');
db.version(1).stores({
  persons: '++id, cedula, nombre',
  attendance: '++id, personId, date, estado'  // estado: 'presente' o 'ausente'
});

let deferredPrompt = null; // para instalación

// ========== MANEJO DE INSTALACIÓN / ACCESO DIRECTO ==========
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('btnInstall').style.display = 'block';
  document.getElementById('btnShortcut').style.display = 'block';
});

document.getElementById('btnInstall').addEventListener('click', async () => {
  if (!deferredPrompt) {
    showStatus('Tu navegador ya instaló la app o no permite instalación automática.', 3000);
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    showStatus('✅ App instalada. Revisa tu pantalla de inicio.', 3000);
  } else {
    showStatus('❌ Instalación cancelada.', 2000);
  }
  deferredPrompt = null;
});

document.getElementById('btnShortcut').addEventListener('click', () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
  } else {
    showStatus('🔖 Abre el menú del navegador (tres puntos) y selecciona "Añadir a pantalla de inicio"', 5000);
  }
});

// ========== FUNCIONES CRUD PERSONAS ==========
async function loadPersons() {
  const persons = await db.persons.toArray();
  const container = document.getElementById('personList');
  if (persons.length === 0) {
    container.innerHTML = '<p>No hay personas. Agrega una cédula y nombre.</p>';
    return;
  }
  container.innerHTML = persons.map(p => `
    <div class="person-item" data-id="${p.id}">
      <div class="person-info">
        <div class="nombre">${escapeHtml(p.nombre)}</div>
        <div class="cedula">${escapeHtml(p.cedula)}</div>
      </div>
      <button class="delete-person" data-id="${p.id}">Eliminar</button>
    </div>
  `).join('');

  document.querySelectorAll('.delete-person').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = parseInt(btn.dataset.id);
      await db.persons.delete(id);
      await db.attendance.where('personId').equals(id).delete();
      loadPersons();
      loadAttendanceForToday();
      showStatus('Persona eliminada', 1500);
    });
  });
}

document.getElementById('addPersonBtn').addEventListener('click', async () => {
  const nombre = document.getElementById('personName').value.trim();
  const cedula = document.getElementById('personCedula').value.trim();
  if (!nombre || !cedula) {
    showStatus('Completa nombre y cédula', 2000);
    return;
  }
  const existe = await db.persons.where('cedula').equals(cedula).first();
  if (existe) {
    showStatus('Ya existe una persona con esa cédula', 2000);
    return;
  }
  await db.persons.add({ nombre, cedula });
  document.getElementById('personName').value = '';
  document.getElementById('personCedula').value = '';
  loadPersons();
  loadAttendanceForToday();
  showStatus('Persona agregada', 1500);
});

// ========== ASISTENCIA DEL DÍA ==========
function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

let currentAttendanceState = {};

async function loadAttendanceForToday() {
  const today = getTodayISO();
  document.getElementById('todayDate').innerText = `Fecha: ${today}`;
  const persons = await db.persons.toArray();
  const attendanceList = document.getElementById('attendanceList');
  if (persons.length === 0) {
    attendanceList.innerHTML = '<p>No hay personas registradas. Ve a la pestaña "Personas" para agregar.</p>';
    return;
  }
  
  const savedAtt = await db.attendance.where('date').equals(today).toArray();
  const savedMap = new Map();
  savedAtt.forEach(a => { savedMap.set(a.personId, a.estado === 'presente'); });
  
  currentAttendanceState = {};
  for (let p of persons) {
    currentAttendanceState[p.id] = savedMap.get(p.id) || false;
  }
  
  attendanceList.innerHTML = persons.map(p => `
    <div class="attendance-item" data-id="${p.id}">
      <label>
        <input type="checkbox" ${currentAttendanceState[p.id] ? 'checked' : ''} data-id="${p.id}">
        <span><strong>${escapeHtml(p.nombre)}</strong> - ${escapeHtml(p.cedula)}</span>
      </label>
    </div>
  `).join('');
  
  document.querySelectorAll('.attendance-item input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const personId = parseInt(chk.dataset.id);
      currentAttendanceState[personId] = chk.checked;
    });
  });
}

document.getElementById('saveAttendanceBtn').addEventListener('click', async () => {
  const today = getTodayISO();
  const persons = await db.persons.toArray();
  await db.attendance.where('date').equals(today).delete();
  
  const registros = [];
  for (let p of persons) {
    const presente = currentAttendanceState[p.id] || false;
    registros.push({
      personId: p.id,
      date: today,
      estado: presente ? 'presente' : 'ausente'
    });
  }
  if (registros.length > 0) {
    await db.attendance.bulkAdd(registros);
    showStatus(`Asistencia guardada para ${registros.length} personas`, 2000);
  } else {
    showStatus('No hay personas para guardar', 1500);
  }
});

// ========== HISTORIAL POR FECHA ==========
document.getElementById('loadHistoryBtn').addEventListener('click', async () => {
  const fecha = document.getElementById('historyDate').value;
  if (!fecha) {
    showStatus('Selecciona una fecha', 1500);
    return;
  }
  const asistencias = await db.attendance.where('date').equals(fecha).toArray();
  const persons = await db.persons.toArray();
  const personMap = new Map(persons.map(p => [p.id, p]));
  
  const resultDiv = document.getElementById('historyResult');
  if (asistencias.length === 0) {
    resultDiv.innerHTML = `<p>📭 No hay registros de asistencia para el día ${fecha}</p>`;
    return;
  }
  
  let html = `<h4>Asistencia del ${fecha}</h4><ul style="list-style:none; padding-left:0;">`;
  for (let a of asistencias) {
    const persona = personMap.get(a.personId);
    if (persona) {
      const estadoIcon = a.estado === 'presente' ? '✅' : '❌';
      html += `<li>${estadoIcon} ${escapeHtml(persona.nombre)} (${escapeHtml(persona.cedula)}) - ${a.estado}</li>`;
    }
  }
  html += `</ul>`;
  resultDiv.innerHTML = html;
});

// ========== UTILIDADES ==========
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, function(m) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    };
    return map[m];
  });
}

function showStatus(msg, duration) {
  const statusDiv = document.getElementById('statusMsg');
  statusDiv.innerText = msg;
  statusDiv.classList.add('show');
  setTimeout(() => statusDiv.classList.remove('show'), duration);
}

// ========== NAVEGACIÓN POR TABS ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`${tabId}-tab`).classList.add('active');
    
    if (tabId === 'attendance') loadAttendanceForToday();
    if (tabId === 'persons') loadPersons();
  });
});

// Carga inicial
loadPersons();
loadAttendanceForToday();