(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let simulation, source, step = 0, selected, playing = null, positions = {}, drag = null, camera = null, graphSize = {};
  const svg = $('network');
  const types = { init: 'INIZIALIZZAZIONE', bpdu: 'SCAMBIO BPDU', elected: 'ELEZIONE COMPLETATA', listening: 'FORWARD DELAY · 0 S', learning: 'FORWARD DELAY · 15 S', forwarding: 'FORWARD DELAY · 30 S' };
  const phases = { init: 'Inizializzazione', bpdu: 'Elezione e scelta porte', elected: 'Informazioni stabili', listening: 'Listening', learning: 'Learning', forwarding: 'Albero operativo' };
  const frame = () => simulation.frames[step];
  const byId = id => simulation.topology.switches.find(s => s.id === id);

  function stop() { clearInterval(playing); playing = null; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Riproduci simulazione'); }
  function load(input, custom = false) {
    const nextSimulation = STP.simulate(input);
    stop(); source = JSON.parse(JSON.stringify(input));
    source.links = source.links.map((link, i) => {
      const { cost, ...fields } = link;
      return { ...fields, dataRateMbps: nextSimulation.topology.links[i].dataRateMbps };
    });
    simulation = nextSimulation; step = 0;
    selected = simulation.topology.switches[0].id; positions = {}; camera = null;
    if (custom) {
      let option = $('preset').querySelector('[value="custom"]');
      if (!option) { option = document.createElement('option'); option.value = 'custom'; $('preset').append(option); }
      option.textContent = simulation.topology.name; $('preset').value = 'custom';
    }
    $('file-error').hidden = true;
    $('network-name').textContent = simulation.topology.name;
    $('switch-count').textContent = simulation.topology.switches.length;
    $('link-count').textContent = simulation.topology.links.length;
    $('timeline').max = simulation.frames.length - 1;
    render();
  }
  function setStep(index) {
    step = Math.max(0, Math.min(simulation.frames.length - 1, Number(index)));
    if (step === simulation.frames.length - 1) stop();
    render();
  }
  function moveTo(index) { stop(); setStep(index); }
  function togglePlay() {
    if (playing) { stop(); return; }
    if (step === simulation.frames.length - 1) setStep(0);
    $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Metti in pausa');
    playing = setInterval(() => setStep(step + 1), Number($('speed').value));
  }
  function render() {
    const f = frame(), last = simulation.frames.length - 1;
    $('timeline').value = step; $('step-label').textContent = `${step} / ${last}`;
    $('phase-label').textContent = phases[f.type];
    $('first').disabled = $('previous').disabled = step === 0;
    $('next').disabled = $('last').disabled = step === last;
    $('event-number').textContent = String(step).padStart(2, '0');
    $('event-type').textContent = types[f.type]; $('round-label').textContent = `Turno ${f.round}`;
    $('event-title').textContent = f.title; $('event-description').textContent = f.description;
    $('bpdu-strip').hidden = !f.bpdu;
    if (f.bpdu) {
      const b = f.bpdu;
      $('bpdu-strip').innerHTML = `<span>ROOT ${escape(b.root)}</span><span>COSTO ${b.cost}</span><span>MITTENTE ${escape(b.sender)} · P${b.senderPort}</span><span>→ ${escape(b.receiver)} · P${b.receiverPort}</span>`;
    }
    $('canvas-caption').innerHTML = `${f.type === 'forwarding' ? 'ALBERO OPERATIVO' : f.type === 'init' ? 'STATO INIZIALE' : f.type === 'bpdu' ? 'PROPAGAZIONE DELLE INFORMAZIONI' : 'ATTIVAZIONE DELLE PORTE'}<span>${$('tree-only').checked ? 'Sono visibili solo i collegamenti in forwarding' : f.type === 'init' ? 'Ogni switch è la propria root' : f.type === 'bpdu' ? `Turno ${f.round} · Le porte dati restano in blocking` : f.type === 'forwarding' ? 'I collegamenti tratteggiati hanno una porta bloccata' : 'Le porte bloccate interrompono i cicli'}</span>`;
    const phase = f.type === 'init' ? 0 : ['bpdu', 'elected'].includes(f.type) ? 1 : 2;
    $('stages').querySelectorAll('li').forEach((li, i) => { li.classList.toggle('active', i === phase); li.classList.toggle('done', i < phase); });
    renderGraph(); renderInspector(); renderJournal();
  }

  function defaultPositions(w, h) {
    const switches = simulation.topology.switches, n = switches.length;
    let points;
    if (n === 5) points = [[.5, .24], [.25, .47], [.75, .47], [.25, .79], [.75, .79]];
    else if (n === 3) points = [[.5, .26], [.23, .75], [.77, .75]];
    else if (n === 2) points = [[.23, .52], [.77, .52]];
    else if (n === 1) points = [[.5, .52]];
    else points = switches.map((_, i) => [.5 + .36 * Math.cos(-Math.PI / 2 + i * 2 * Math.PI / n), .53 + .33 * Math.sin(-Math.PI / 2 + i * 2 * Math.PI / n)]);
    return Object.fromEntries(switches.map((s, i) => [s.id, { x: points[i][0] * w, y: points[i][1] * h }]));
  }
  function renderGraph() {
    const f = frame(), n = simulation.topology.switches.length;
    const scale = Math.max(1, n / 10);
    const w = Math.max(250, $('canvas').clientWidth) * scale, h = $('canvas').clientHeight * scale;
    graphSize = { w, h };
    if (!Object.keys(positions).length) positions = defaultPositions(w, h);
    if (!camera) camera = { x: 0, y: 0, w, h };
    svg.setAttribute('viewBox', `${camera.x} ${camera.y} ${camera.w} ${camera.h}`);
    const groups = {};
    for (const l of simulation.topology.links) {
      const key = [l.from, l.to].sort().join('|');
      (groups[key] ??= []).push(l.id);
    }
    let paths = '', tags = '', packet = '';
    for (const l of simulation.topology.links) {
      const a = positions[l.from], b = positions[l.to], pa = f.nodes[l.from].ports[l.fromPort], pb = f.nodes[l.to].ports[l.toPort];
      const forwarding = pa.state === 'forwarding' && pb.state === 'forwarding';
      if ($('tree-only').checked && !forwarding) continue;
      const siblings = groups[[l.from, l.to].sort().join('|')];
      const offset = (siblings.indexOf(l.id) - (siblings.length - 1) / 2) * 64 * (l.from < l.to ? 1 : -1);
      const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy));
      const c = { x: (a.x + b.x) / 2 - dy / distance * offset, y: (a.y + b.y) / 2 + dx / distance * offset };
      const at = t => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });
      const active = f.bpdu?.link === l.id;
      const blocked = pa.role === 'BL' || pb.role === 'BL';
      paths += `<path class="network-link${forwarding ? ' forwarding' : ''}${blocked ? ' blocked' : ''}${active ? ' active' : ''}" d="M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}"><title>${escape(l.from)} P${l.fromPort} ↔ ${escape(l.to)} P${l.toPort} · ${STP.formatDataRate(l.dataRateMbps)} · costo ${l.cost} (short)</title></path>`;
      const middle = at(.5);
      const rateLabel = STP.formatDataRate(l.dataRateMbps);
      const width = Math.max(rateLabel.length * 5.5, (`costo ${l.cost}`).length * 5) + 14;
      const vertical = Math.abs(dy) > Math.abs(dx);
      const diagonal = Math.abs(dx) > 20 && Math.abs(dy) > 20;
      const labelX = diagonal ? middle.x + (middle.x < w / 2 ? -32 : 32) : vertical ? Math.max(width / 2 + 5, middle.x - width / 2 - 20) : middle.x;
      const labelY = diagonal ? middle.y - 15 : vertical ? middle.y : middle.y - 27;
      tags += `<g class="link-cost" transform="translate(${labelX},${labelY})"><title>${rateLabel} → costo standard short ${l.cost}</title><rect x="${-width / 2}" y="-16" width="${width}" height="32"/><text class="link-rate" y="-6">${rateLabel}</text><text class="link-cost-value" y="7">costo ${l.cost}</text></g>`;
      for (const [port, t] of [[pa, Math.min(.35, 52 / distance)], [pb, Math.max(.65, 1 - 52 / distance)]]) {
        const p = at(t);
        tags += `<g class="port-tag ${port.role}" transform="translate(${p.x},${p.y})"><rect x="-13" y="-9" width="26" height="18"/><text>${port.role}</text></g>`;
      }
      if (active) {
        const from = at(f.bpdu.sender === l.from ? .35 : .65), to = at(f.bpdu.sender === l.from ? .65 : .35);
        packet = `<path d="M${from.x},${from.y} L${to.x},${to.y}" stroke="#8065b6" stroke-width="2.5" marker-end="url(#bpdu-arrow)" fill="none"/><g><circle class="packet" cx="${from.x}" cy="${from.y}" r="4"/><text class="packet-label" x="${middle.x}" y="${middle.y + 23}">BPDU → ${escape(f.bpdu.receiver)}</text></g>`;
      }
    }
    let nodes = '';
    const stable = !['init', 'bpdu'].includes(f.type);
    for (const s of simulation.topology.switches) {
      const p = positions[s.id], node = f.nodes[s.id], isRoot = node.root === s.id;
      const label = s.id.length > 5 ? s.id.slice(0, 4) + '…' : s.id;
      nodes += `<g class="node${selected === s.id ? ' selected' : ''}${drag?.id === s.id ? ' dragging' : ''}" data-node="${escape(s.id)}" transform="translate(${p.x},${p.y})" role="button" tabindex="0" aria-label="Switch ${escape(s.id)}, root conosciuta ${escape(node.root)}, costo ${node.cost}" aria-pressed="${selected === s.id}"><title>${escape(s.id)} · root ${escape(node.root)} · costo ${node.cost}</title><rect class="selection-ring" x="-36" y="-27" width="72" height="54"/><rect class="node-body" x="-34" y="-25" width="68" height="50"/><g class="switch-symbol"><rect x="-14" y="-15" width="5" height="3" rx="1"/><rect x="-6" y="-15" width="5" height="3" rx="1"/><rect x="2" y="-15" width="5" height="3" rx="1"/><rect x="10" y="-15" width="5" height="3" rx="1"/></g><text class="node-name" y="3">${escape(label)}</text><text class="node-cost" y="17">${node.cost === 0 ? 'costo 0' : 'costo ' + node.cost}</text>${isRoot ? `<rect class="root-crown" x="-22" y="-43" width="44" height="14"/><text class="root-label" x="0" y="-33">${stable ? 'ROOT' : 'ROOT ?'}</text>` : ''}</g>`;
    }
    svg.innerHTML = `<defs><marker id="bpdu-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="#8065b6"/></marker></defs>${paths}${tags}${packet}${nodes}`;
  }

  function renderInspector() {
    const s = byId(selected), node = frame().nodes[selected], ports = Object.entries(node.ports);
    const root = byId(node.root), stable = !['init', 'bpdu'].includes(frame().type);
    const candidates = ports.filter(([, p]) => p.received).map(([p, port]) => ({ p, port, b: port.received }));
    candidates.sort((a, b) => STP.compare([byId(a.b.root).bid, a.b.cost + a.port.cost, byId(a.b.sender).bid, a.b.senderPort, Number(a.p)], [byId(b.b.root).bid, b.b.cost + b.port.cost, byId(b.b.sender).bid, b.b.senderPort, Number(b.p)]));
    $('inspector').innerHTML = `<div class="inspector-heading"><span class="inspector-avatar" aria-hidden="true">⇄</span><div><h3>${escape(s.id)}</h3><p>Bridge / switch</p></div>${node.root === s.id ? `<span class="inspector-title-badge">${stable ? 'ROOT BRIDGE' : 'SI CANDIDA'}</span>` : ''}</div><div class="property"><span>Priorità</span><code>${s.priority}</code></div><div class="property mac"><span>MAC</span><code>${s.mac}</code></div><div class="property"><span>Bridge ID</span><code>${s.priority}.${s.mac.replaceAll(':', '')}</code></div><div class="root-summary"><span class="field-label">${stable ? 'ROOT ELETTA' : 'ROOT CONOSCIUTA'}</span><div><strong>${escape(node.root)}</strong><small>Costo <b>${node.cost}</b></small></div><p>${node.rootPort === null ? 'Questo switch si considera la root.' : `Percorso selezionato: P${node.rootPort} → ${escape(node.ports[node.rootPort].peer)}`}</p></div><div class="ports-title"><span class="field-label">TABELLA DELLE PORTE</span><span>${ports.length} porte</span></div><table class="ports-table"><thead><tr><th>Porta / vicino</th><th>Capacità / costo</th><th>Ruolo / stato</th></tr></thead><tbody>${ports.length ? ports.map(([p, port]) => `<tr><td>P${p}<small>→ ${escape(port.peer)} · P${port.peerPort}</small></td><td><span class="port-rate">${STP.formatDataRate(port.dataRateMbps)}</span><small>Costo ${port.cost}</small></td><td><span class="role-badge ${port.role}">${port.role}</span><small class="port-state">${port.state}</small></td></tr>`).join('') : '<tr><td colspan="3">Nessuna porta collegata</td></tr>'}</tbody></table><div class="ports-title"><span class="field-label">CANDIDATI ALLA ROOT PORT</span></div>${candidates.length ? `<ul class="candidate-list">${candidates.map(({ p, port, b }) => `<li class="${Number(p) === node.rootPort ? 'selected-candidate' : ''}"><strong>${Number(p) === node.rootPort ? '✓ ' : ''}P${p} via ${escape(b.sender)}</strong> · root ${escape(b.root)}<br><code>${b.cost} + ${port.cost} = ${b.cost + port.cost}</code> · BID ${byId(b.sender).priority}.${byId(b.sender).mac.replaceAll(':', '')}<br>Port ID mittente 128.${b.senderPort}</li>`).join('')}</ul>` : '<p class="candidate-empty">Nessuna BPDU ancora ricevuta.<br>Avanza per confrontare i percorsi.</p>'}<p class="comparison-note">Vince il primo valore minore:<br>Root ID → costo totale → BID mittente → porta mittente → porta locale.<br>La priorità di tutte le porte è 128.</p>`;
  }
  function renderJournal() {
    const changesOnly = $('changes-only').checked;
    $('journal').innerHTML = simulation.frames.map((f, i) => ({ f, i })).filter(({ f }) => !changesOnly || f.type !== 'bpdu' || f.changed).map(({ f, i }) => `<button class="journal-event${i === step ? ' current' : ''}${i > step ? ' future' : ''}" data-step="${i}" aria-current="${i === step ? 'step' : 'false'}"><span><span>${String(i).padStart(2, '0')} · ${f.type === 'bpdu' ? 'BPDU' : phases[f.type].toUpperCase()}</span><span>${i === step ? '●' : '↗'}</span></span><strong>${escape(f.title)}</strong><small>${i > step ? 'Da esplorare' : i === step ? 'Stai osservando questo passo' : 'Torna a questo passo'}</small></button>`).join('');
    const current = $('journal').querySelector('.current');
    if (current) $('journal').scrollLeft = current.offsetLeft - $('journal').offsetLeft - ($('journal').clientWidth - current.offsetWidth) / 2;
  }

  $('first').onclick = () => moveTo(0);
  $('previous').onclick = () => moveTo(step - 1);
  $('next').onclick = () => moveTo(step + 1);
  $('last').onclick = () => moveTo(simulation.frames.length - 1);
  $('play').onclick = togglePlay;
  $('timeline').oninput = e => moveTo(e.target.value);
  $('speed').onchange = () => { if (playing) { stop(); togglePlay(); } };
  $('preset').onchange = e => { if (e.target.value !== 'custom') load(STP_PRESETS[e.target.value]); };
  $('tree-only').onchange = render;
  $('changes-only').onchange = renderJournal;
  $('layout-reset').onclick = () => { positions = {}; camera = null; renderGraph(); };
  function zoom(factor) {
    const width = Math.max(graphSize.w / 6, Math.min(graphSize.w * 1.5, camera.w * factor)), height = width * camera.h / camera.w;
    camera = { x: camera.x + (camera.w - width) / 2, y: camera.y + (camera.h - height) / 2, w: width, h: height };
    renderGraph();
  }
  $('zoom-in').onclick = () => zoom(.8); $('zoom-out').onclick = () => zoom(1.25);
  $('journal').onclick = e => { const item = e.target.closest('[data-step]'); if (item) moveTo(item.dataset.step); };
  const resize = new ResizeObserver(() => { positions = {}; camera = null; if (simulation) renderGraph(); }); resize.observe($('canvas'));

  function selectNode(id) { selected = id; $('inspector').parentElement.classList.add('mobile-visible'); renderInspector(); renderGraph(); }
  function point(e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }
  svg.addEventListener('pointerdown', e => {
    const target = e.target.closest('[data-node]');
    if (!target) { const p = point(e); drag = { pan: true, startX: p.x, startY: p.y, camera: { ...camera } }; svg.setPointerCapture(e.pointerId); return; }
    e.preventDefault(); const p = point(e), id = target.dataset.node;
    drag = { id, dx: p.x - positions[id].x, dy: p.y - positions[id].y };
    svg.setPointerCapture(e.pointerId); selectNode(id);
  });
  svg.addEventListener('pointermove', e => {
    if (!drag) return;
    const p = point(e);
    if (drag.pan) { camera.x += drag.startX - p.x; camera.y += drag.startY - p.y; renderGraph(); return; }
    positions[drag.id] = { x: Math.max(42, Math.min(graphSize.w - 42, p.x - drag.dx)), y: Math.max(68, Math.min(graphSize.h - 40, p.y - drag.dy)) };
    renderGraph();
  });
  const finishDrag = () => { if (drag) { drag = null; renderGraph(); } };
  svg.addEventListener('pointerup', finishDrag); svg.addEventListener('pointercancel', finishDrag);
  svg.addEventListener('keydown', e => { const target = e.target.closest('[data-node]'); if (target && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); selectNode(target.dataset.node); svg.querySelector(`[data-node="${selected}"]`)?.focus(); } });
  svg.addEventListener('click', e => { const target = e.target.closest('[data-node]'); if (target) selectNode(target.dataset.node); });
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(e.target.tagName) || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
    if (['ArrowRight', 'ArrowLeft', ' ', 'Home', 'End'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowRight') moveTo(step + 1);
    if (e.key === 'ArrowLeft') moveTo(step - 1);
    if (e.key === 'Home') moveTo(0);
    if (e.key === 'End') moveTo(simulation.frames.length - 1);
    if (e.key === ' ') togglePlay();
  });

  $('upload').onclick = () => $('file-input').click();
  async function readFile(file) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw Error('Il file supera 1 MB. Riduci la topologia.');
      const text = await file.text();
      let input;
      try { input = JSON.parse(text); } catch { throw Error('Il file non contiene JSON valido. Controlla parentesi, virgolette e virgole.'); }
      load(input, true);
    } catch (error) { $('file-error').textContent = error.message; $('file-error').hidden = false; }
    $('file-input').value = '';
  }
  $('file-input').onchange = e => readFile(e.target.files[0]);
  for (const name of ['dragover', 'dragenter']) $('drop-area').addEventListener(name, e => { e.preventDefault(); $('drop-area').classList.add('dragging'); });
  $('drop-area').ondragleave = () => $('drop-area').classList.remove('dragging');
  $('drop-area').ondrop = e => { e.preventDefault(); $('drop-area').classList.remove('dragging'); readFile(e.dataTransfer.files[0]); };
  $('edit-open').onclick = () => { stop(); $('json-editor').value = JSON.stringify(source, null, 2); $('editor-error').hidden = true; $('editor-dialog').showModal(); };
  $('editor-form').onsubmit = e => {
    e.preventDefault();
    try {
      let data;
      try { data = JSON.parse($('json-editor').value); } catch { throw Error('JSON non valido: controlla parentesi, virgolette e virgole.'); }
      load(data, true); $('editor-dialog').close();
    } catch (error) { $('editor-error').textContent = error.message; $('editor-error').hidden = false; }
  };
  $('download').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2) + '\n'], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'topologia-stp.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  for (const id of ['help-open', 'model-open']) $(id).onclick = () => { stop(); $('help-dialog').showModal(); };
  document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => $(button.dataset.close).close());
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } }));
  $('cost-reference-rows').innerHTML = Object.entries(STP.SHORT_COSTS).map(([rate, cost]) => `<tr><td>${STP.formatDataRate(Number(rate))}</td><td>${cost}</td></tr>`).join('');
  load(STP_PRESETS.redundant);
})();
