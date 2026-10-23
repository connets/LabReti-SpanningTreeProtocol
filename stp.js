(function (global) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  // IEEE 802.1D short path-cost values for the Ethernet rates supported here.
  const SHORT_COSTS = Object.freeze({ 10: 100, 100: 19, 1000: 4, 10000: 2, 25000: 1, 40000: 1 });
  const formatDataRate = mbps => mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`;
  const compare = (a, b) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  };
  function normalize(input) {
    if (!input || !Array.isArray(input.switches) || !Array.isArray(input.links)) throw Error('Servono due elenchi: switches e links.');
    if (!input.switches.length || input.switches.length > 30) throw Error('Inserisci da 1 a 30 switch.');
    if (input.links.length > 60) throw Error('Sono supportati al massimo 60 collegamenti.');
    const ids = new Set(), bids = new Set();
    const switches = input.switches.map((s, i) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw Error(`Switch ${i + 1}: serve un oggetto con un id.`);
      if (typeof s.id !== 'string' || !/^[\w-]{1,24}$/.test(s.id)) throw Error('Ogni switch deve avere un id di 1–24 lettere, numeri, _ o -.');
      if (ids.has(s.id)) throw Error(`ID duplicato: ${s.id}.`);
      ids.add(s.id);
      const priority = s.priority ?? 32768;
      if (!Number.isInteger(priority) || priority < 0 || priority > 61440 || priority % 4096) throw Error(`Priorità non valida per ${s.id}: usa multipli di 4096, da 0 a 61440.`);
      const mac = s.mac ?? `02:00:00:00:${Math.floor((i + 1) / 256).toString(16).padStart(2, '0')}:${((i + 1) % 256).toString(16).padStart(2, '0')}`;
      if (typeof mac !== 'string' || !/^([\da-f]{2}:){5}[\da-f]{2}$/i.test(mac)) throw Error(`MAC non valido per ${s.id}: usa il formato 02:00:00:00:00:01.`);
      const bid = `${String(priority).padStart(5, '0')}.${mac.toLowerCase().replaceAll(':', '')}`;
      if (bids.has(bid)) throw Error('Due switch hanno lo stesso Bridge ID (priorità + MAC).');
      bids.add(bid);
      return { id: s.id, priority, mac: mac.toLowerCase(), bid };
    });
    const used = Object.fromEntries(switches.map(s => [s.id, new Set()]));
    const linkIds = new Set();
    function port(id, supplied) {
      let value = supplied;
      if (value === undefined) { value = 1; while (used[id].has(value)) value++; }
      if (!Number.isInteger(value) || value < 1 || value > 4095) throw Error(`Porta non valida su ${id}: usa un intero da 1 a 4095.`);
      if (used[id].has(value)) throw Error(`Porta ${value} usata più volte su ${id}.`);
      used[id].add(value);
      return value;
    }
    const links = input.links.map((l, i) => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) throw Error(`Collegamento ${i + 1}: serve un oggetto con from e to.`);
      if (!ids.has(l.from) || !ids.has(l.to)) throw Error(`Collegamento ${i + 1}: uno switch non esiste.`);
      if (l.from === l.to) throw Error('I collegamenti di uno switch a sé stesso non sono supportati.');
      let dataRateMbps = l.dataRateMbps;
      if (dataRateMbps === undefined && l.cost !== undefined) {
        // Backward compatibility only where a legacy cost identifies one rate.
        const matches = Object.keys(SHORT_COSTS).filter(rate => SHORT_COSTS[rate] === l.cost);
        if (matches.length !== 1) throw Error(`Collegamento ${i + 1}: specifica dataRateMbps. Il costo viene calcolato dalla capacità; il solo costo ${l.cost} non identifica una capacità univoca supportata.`);
        dataRateMbps = Number(matches[0]);
      }
      if (dataRateMbps === undefined) dataRateMbps = 100;
      if (typeof dataRateMbps !== 'number' || !Number.isFinite(dataRateMbps) || !Object.hasOwn(SHORT_COSTS, dataRateMbps)) throw Error(`Capacità non valida sul collegamento ${i + 1}: dataRateMbps deve essere 10, 100, 1000, 10000, 25000 o 40000 (Mbps).`);
      const cost = SHORT_COSTS[dataRateMbps];
      if (l.cost !== undefined && l.cost !== cost) throw Error(`Collegamento ${i + 1}: ${formatDataRate(dataRateMbps)} corrisponde al costo standard short ${cost}, non ${l.cost}. Rimuovi cost: viene calcolato automaticamente.`);
      const id = l.id ?? `L${i + 1}`;
      if (typeof id !== 'string' || !/^[\w-]{1,24}$/.test(id) || linkIds.has(id)) throw Error('Ogni collegamento deve avere un id univoco di 1–24 lettere, numeri, _ o -.');
      linkIds.add(id);
      return { id, from: l.from, to: l.to, dataRateMbps, cost, fromPort: port(l.from, l.fromPort), toPort: port(l.to, l.toPort) };
    });
    return { name: typeof input.name === 'string' ? input.name.slice(0, 100) : 'La mia topologia', switches, links };
  }
  function simulate(input) {
    const topology = normalize(input);
    const byId = Object.fromEntries(topology.switches.map(s => [s.id, s]));
    const nodes = Object.fromEntries(topology.switches.map(s => [s.id, { root: s.id, cost: 0, rootPort: null, ports: {} }]));
    for (const l of topology.links) {
      nodes[l.from].ports[l.fromPort] = { link: l.id, peer: l.to, peerPort: l.toPort, dataRateMbps: l.dataRateMbps, cost: l.cost, role: 'DP', state: 'blocking', received: null };
      nodes[l.to].ports[l.toPort] = { link: l.id, peer: l.from, peerPort: l.fromPort, dataRateMbps: l.dataRateMbps, cost: l.cost, role: 'DP', state: 'blocking', received: null };
    }
    const frames = [];
    function save(event) { frames.push({ nodes: clone(nodes), ...event }); }
    const advertised = (id, port) => [byId[nodes[id].root].bid, nodes[id].cost, byId[id].bid, Number(port)];
    function recalculate(id) {
      const node = nodes[id];
      let best = [byId[id].bid, 0, byId[id].bid, 0, 0];
      let root = id, rootPort = null;
      for (const [p, port] of Object.entries(node.ports)) {
        if (!port.received) continue;
        const bpdu = port.received;
        const candidate = [byId[bpdu.root].bid, bpdu.cost + port.cost, byId[bpdu.sender].bid, bpdu.senderPort, Number(p)];
        if (compare(candidate, best) < 0) { best = candidate; root = bpdu.root; rootPort = Number(p); }
      }
      node.root = root; node.cost = best[1]; node.rootPort = rootPort;
      for (const [p, port] of Object.entries(node.ports)) {
        if (Number(p) === rootPort) port.role = 'RP';
        else if (!port.received) port.role = 'DP';
        else {
          const b = port.received;
          port.role = compare(advertised(id, p), [byId[b.root].bid, b.cost, byId[b.sender].bid, b.senderPort]) < 0 ? 'DP' : 'BL';
        }
      }
    }
    save({ type: 'init', round: 0, title: 'Ogni switch si considera root', description: 'Tutti iniziano annunciando il proprio Bridge ID e un costo pari a 0. Le porte sono provvisoriamente designated, ma restano in blocking: nessun frame dati può ancora passare.' });
    let settled = false, round = 0;
    for (round = 1; round <= topology.switches.length * 3 + 5; round++) {
      const before = JSON.stringify(nodes);
      // Synchronous teaching rounds: advertisements are captured before delivery.
      // Only locally designated ports originate configuration BPDUs.
      const messages = [];
      for (const s of topology.switches) {
        for (const [p, port] of Object.entries(nodes[s.id].ports)) {
          if (port.role === 'DP') messages.push({ sender: s.id, senderPort: Number(p), receiver: port.peer, receiverPort: port.peerPort, root: nodes[s.id].root, cost: nodes[s.id].cost, link: port.link });
        }
      }
      for (const bpdu of messages) {
        const receiver = nodes[bpdu.receiver], port = receiver.ports[bpdu.receiverPort];
        const old = { root: receiver.root, cost: receiver.cost, rootPort: receiver.rootPort };
        const oldBpdu = port.received;
        const tuple = b => [byId[b.root].bid, b.cost, byId[b.sender].bid, b.senderPort];
        const accepted = !oldBpdu || compare(tuple(bpdu), tuple(oldBpdu)) <= 0;
        if (accepted) port.received = clone(bpdu);
        recalculate(bpdu.receiver);
        const changed = old.root !== receiver.root || old.cost !== receiver.cost || old.rootPort !== receiver.rootPort;
        let reason;
        if (old.root !== receiver.root) reason = `Il Bridge ID di ${receiver.root} è minore di quello di ${old.root}. ${bpdu.receiver} adotta ${receiver.root} come root, con costo ${receiver.cost} e root port P${receiver.rootPort}.`;
        else if (old.cost !== receiver.cost) reason = `A parità di root, il costo totale ${bpdu.cost} + ${port.cost} = ${bpdu.cost + port.cost} migliora il percorso precedente (${old.cost}). P${receiver.rootPort} diventa la root port.`;
        else if (old.rootPort !== receiver.rootPort) reason = `Root e costo sono uguali: vince il minore Bridge ID del mittente, poi il Port ID del mittente, poi la porta locale. La root port è P${receiver.rootPort}.`;
        else reason = `Il percorso selezionato da ${bpdu.receiver} resta quello verso ${receiver.root}, costo ${receiver.cost}. Il confronto sulla porta P${bpdu.receiverPort} aggiorna o conferma il ruolo ${port.role}.`;
        save({ type: 'bpdu', round, bpdu: clone(bpdu), changed, accepted, old, title: `${bpdu.sender} → ${bpdu.receiver}: ${changed ? 'percorso aggiornato' : 'confronto BPDU'}`, description: reason });
      }
      if (before === JSON.stringify(nodes)) { settled = true; break; }
    }
    if (!settled) throw Error('La topologia non converge nel limite di sicurezza.');
    save({ type: 'elected', round, title: 'Elezione completata', description: 'Un intero turno di BPDU non cambia più le informazioni. In ogni componente connessa il Bridge ID minimo è la root; ogni altro switch ha una root port. Su ogni collegamento viene scelta una designated port. Le porte BL interrompono i cicli.' });
    for (const state of ['listening', 'learning', 'forwarding']) {
      for (const node of Object.values(nodes)) for (const port of Object.values(node.ports)) port.state = port.role === 'BL' ? 'blocking' : state;
      const descriptions = {
        listening: 'Le porte RP e DP entrano in listening: partecipano a STP ma non apprendono MAC e non inoltrano dati. Inizia il primo forward delay di 15 s.',
        learning: 'Dopo 15 s le porte RP e DP entrano in learning: apprendono gli indirizzi MAC, ma non inoltrano ancora dati. Inizia il secondo forward delay di 15 s.',
        forwarding: 'Dopo altri 15 s le porte RP e DP inoltrano i dati. Le porte BL restano in blocking e continuano a ricevere BPDU. La rete attiva forma un albero per ogni componente connessa.'
      };
      save({ type: state, round, timer: state === 'listening' ? 0 : state === 'learning' ? 15 : 30, title: state === 'forwarding' ? 'Spanning tree operativo' : `Porte in ${state}`, description: descriptions[state] });
    }
    return { topology, frames };
  }
  const api = { normalize, simulate, compare, SHORT_COSTS, formatDataRate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.STP = api;
})(typeof window !== 'undefined' ? window : globalThis);
