'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { simulate, normalize, compare } = require('../stp.js');
const example = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../examples', name + '.json')));

// Independent oracle: connected components + Dijkstra + final STP port rules.
function verify(input) {
  const { topology, frames } = simulate(input), final = frames.at(-1);
  const bridges = Object.fromEntries(topology.switches.map(s => [s.id, s]));
  const neighbors = Object.fromEntries(topology.switches.map(s => [s.id, []]));
  for (const l of topology.links) { neighbors[l.from].push([l.to, l.cost]); neighbors[l.to].push([l.from, l.cost]); }
  let componentCount = 0; const visited = new Set();
  for (const s of topology.switches) {
    if (visited.has(s.id)) continue;
    componentCount++;
    const members = [], pending = [s.id];
    while (pending.length) {
      const id = pending.pop(); if (visited.has(id)) continue;
      visited.add(id); members.push(id); pending.push(...neighbors[id].map(([n]) => n));
    }
    const root = members.toSorted((a, b) => bridges[a].bid.localeCompare(bridges[b].bid))[0];
    const distances = Object.fromEntries(members.map(id => [id, Infinity])); distances[root] = 0;
    const todo = new Set(members);
    while (todo.size) {
      const id = [...todo].sort((a, b) => distances[a] - distances[b])[0]; todo.delete(id);
      for (const [peer, cost] of neighbors[id]) distances[peer] = Math.min(distances[peer], distances[id] + cost);
    }
    for (const id of members) {
      const node = final.nodes[id];
      assert.equal(node.root, root, `root for ${id}`); assert.equal(node.cost, distances[id], `cost for ${id}`);
      assert.equal(Object.values(node.ports).filter(p => p.role === 'RP').length, id === root ? 0 : 1);
      const candidates = [];
      for (const [p, port] of Object.entries(node.ports)) {
        candidates.push({ p: Number(p), tuple: [distances[port.peer] + port.cost, bridges[port.peer].bid, port.peerPort, Number(p)] });
      }
      candidates.sort((a, b) => compare(a.tuple, b.tuple));
      if (id !== root) assert.equal(node.rootPort, candidates[0].p, `root-port tie-break for ${id}`);
    }
  }
  let active = 0;
  for (const l of topology.links) {
    const a = final.nodes[l.from], b = final.nodes[l.to], pa = a.ports[l.fromPort], pb = b.ports[l.toPort];
    const winner = compare([a.cost, bridges[l.from].bid, l.fromPort], [b.cost, bridges[l.to].bid, l.toPort]) < 0;
    assert.equal(winner ? pa.role : pb.role, 'DP');
    assert.equal(pa.state === 'blocking', pa.role === 'BL'); assert.equal(pb.state === 'blocking', pb.role === 'BL');
    if (pa.state === 'forwarding' && pb.state === 'forwarding') active++;
  }
  assert.equal(active, topology.switches.length - componentCount, 'forwarding forest edge count');
  for (const f of frames.filter(f => ['init', 'bpdu', 'elected'].includes(f.type))) {
    assert.ok(Object.values(f.nodes).every(n => Object.values(n.ports).every(p => p.state === 'blocking')));
  }
  assert.deepEqual(frames.slice(-3).map(f => [f.type, f.timer]), [['listening', 0], ['learning', 15], ['forwarding', 30]]);
  const repeat = simulate(input); assert.deepEqual(frames, repeat.frames, 'deterministic history');
  return { topology, frames };
}
test('all teaching examples match an independent shortest-path and role oracle', () => {
  for (const name of ['rete-ridondante', 'triangolo', 'costi-diversi', 'porte-parallele']) verify(example(name));
});
test('the cheaper multi-hop route beats a more expensive direct link', () => {
  const result = verify(example('costi-diversi'));
  assert.equal(result.frames.at(-1).nodes.SW3.cost, 8);
});
test('parallel-link tie uses sender port before receiver port', () => {
  const result = verify(example('porte-parallele'));
  assert.equal(result.frames.at(-1).nodes.SW2.rootPort, 2);
});
test('priority wins before MAC, MAC wins at equal priority', () => {
  const input = { switches: [{ id: 'A', mac: '00:00:00:00:00:01' }, { id: 'B', priority: 4096, mac: 'ff:ff:ff:ff:ff:ff' }, { id: 'C', priority: 4096, mac: '02:00:00:00:00:02' }], links: [{ from: 'A', to: 'B' }, { from: 'B', to: 'C' }] };
  const { frames } = verify(input); assert.equal(frames.at(-1).nodes.A.root, 'C');
});
test('disconnected components, isolated bridge, and empty link set', () => {
  verify({ switches: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }], links: [{ from: 'A', to: 'B' }, { from: 'C', to: 'D' }] });
  verify({ switches: [{ id: 'alone' }], links: [] });
});
test('history contains independent snapshots and does not mutate input', () => {
  const input = example('triangolo'), original = JSON.stringify(input), { frames } = simulate(input);
  assert.equal(JSON.stringify(input), original);
  frames.at(-1).nodes.SW1.root = 'edited';
  assert.equal(frames[0].nodes.SW1.root, 'SW1');
});
test('maximum-size chain propagates the root across 29 hops', () => {
  const switches = Array.from({ length: 30 }, (_, i) => ({ id: `S${i}`, priority: i === 29 ? 0 : 32768 }));
  const links = Array.from({ length: 29 }, (_, i) => ({ from: `S${i}`, to: `S${i + 1}`, cost: 19 }));
  const { frames } = verify({ switches, links });
  assert.equal(frames.at(-1).nodes.S0.cost, 29 * 19);
});
test('invalid topology is rejected before simulation', () => {
  const invalid = [null, {}, { switches: [], links: [] }, { switches: [{ id: 'A' }, { id: 'A' }], links: [] }, { switches: [{ id: 'A', priority: 1 }], links: [] }, { switches: [{ id: 'A', mac: 'no' }], links: [] }, { switches: [{ id: 'A' }], links: [{ from: 'A', to: 'A' }] }, { switches: [{ id: 'A' }], links: [{ from: 'A', to: 'B' }] }];
  for (const input of invalid) assert.throws(() => normalize(input));
  for (const cost of [0, -1, 1.5, '19', Infinity]) assert.throws(() => normalize({ switches: [{ id: 'A' }, { id: 'B' }], links: [{ from: 'A', to: 'B', cost }] }));
  assert.throws(() => normalize({ switches: [{ id: 'A' }, { id: 'B' }], links: [{ from: 'A', to: 'B', fromPort: 1 }, { from: 'A', to: 'B', fromPort: 1 }] }));
});
test('capacity determines the standard short cost, including ambiguous reverse mappings', () => {
  for (const [dataRateMbps, expectedCost] of [[10, 100], [100, 19], [1000, 4], [10000, 2], [25000, 1], [40000, 1]]) {
    const result = verify({ switches: [{ id: 'A' }, { id: 'B' }], links: [{ from: 'A', to: 'B', dataRateMbps }] });
    assert.equal(result.topology.links[0].cost, expectedCost);
    assert.equal(result.frames.at(-1).nodes.B.cost, expectedCost);
    assert.equal(result.frames[0].nodes.B.ports[1].dataRateMbps, dataRateMbps);
  }
});
test('a capacity change changes the selected path', () => {
  const input = { switches: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], links: [{ from: 'A', to: 'B', dataRateMbps: 1000 }, { from: 'B', to: 'C', dataRateMbps: 1000 }, { from: 'A', to: 'C', dataRateMbps: 100 }] };
  assert.equal(verify(input).frames.at(-1).nodes.C.rootPort, 1);
  input.links[2].dataRateMbps = 10000;
  const final = verify(input).frames.at(-1);
  assert.equal(final.nodes.C.rootPort, 2);
  assert.equal(final.nodes.C.cost, 2);
});
test('rejects invalid capacities and cost overrides; migrates unambiguous legacy costs', () => {
  const input = link => ({ switches: [{ id: 'A' }, { id: 'B' }], links: [{ from: 'A', to: 'B', ...link }] });
  for (const dataRateMbps of [null, 0, -10, '1000', 123, NaN, Infinity]) assert.throws(() => normalize(input({ dataRateMbps })));
  assert.throws(() => normalize(input({ dataRateMbps: 1000, cost: 19 })), /costo standard short 4/);
  assert.throws(() => normalize(input({ cost: 1 })), /non identifica una capacità univoca/);
  assert.equal(normalize(input({ cost: 4 })).links[0].dataRateMbps, 1000);
  assert.equal(normalize(input({})).links[0].dataRateMbps, 100);
});
test('200 reproducible random networks converge to a correct forest', () => {
  let seed = 20261021;
  function random(max) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; }
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + random(12), switches = Array.from({ length: n }, (_, i) => ({ id: `S${i}`, priority: random(16) * 4096 }));
    const links = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (random(4) === 0) links.push({ from: `S${a}`, to: `S${b}`, dataRateMbps: [10, 100, 1000, 10000, 25000, 40000][random(6)] });
    verify({ switches, links });
  }
});
