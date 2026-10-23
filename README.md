# STP Lab

Un piccolo laboratorio di Spanning Tree Protocol, in italiano, con una rete grafica interattiva e una cronologia completamente navigabile.

## Avvio

Apri `index.html` nel browser: non servono installazioni, build o un server. Il caricamento dei file avviene localmente e non invia dati a servizi esterni. I font online sono facoltativi e hanno alternative di sistema.

In alternativa, dalla cartella del progetto:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Apri <http://localhost:8765>. Non sono necessarie dipendenze npm.

## Uso

- Scegli uno dei quattro esempi oppure carica un file JSON trascinandolo nell’area di caricamento.
- Modifica una rete con l’editor JSON integrato e scaricala per riutilizzarla.
- Avanza o torna indietro di una BPDU, riproduci automaticamente, usa il cursore temporale o seleziona un evento nel diario.
- Seleziona uno switch per esaminare Bridge ID, root conosciuta, costo, porte e candidati alla root port.
- Trascina gli switch per spostarli; trascina lo sfondo per spostare la vista. I pulsanti + e − cambiano lo zoom, ⤢ ripristina la vista iniziale.
- “Solo albero” visualizza esclusivamente i link in forwarding: prima della fase finale non mostra collegamenti.
- I tasti freccia navigano i passi, Spazio avvia o ferma, Home/End vanno all’inizio/alla fine. I normali controlli mantengono i propri comportamenti da tastiera.

## Formato di ingresso

```json
{
  "name": "Il triangolo",
  "switches": [
    { "id": "SW1", "priority": 24576, "mac": "02:00:00:00:00:01" },
    { "id": "SW2" },
    { "id": "SW3" }
  ],
  "links": [
    { "from": "SW1", "to": "SW2", "dataRateMbps": 100 },
    { "from": "SW2", "to": "SW3", "dataRateMbps": 100 },
    { "from": "SW1", "to": "SW3", "dataRateMbps": 1000 }
  ]
}
```

| Campo | Regola |
| --- | --- |
| `name` | Facoltativo; nome visualizzato della rete |
| `switches` | Da 1 a 30 switch/bridge |
| `switches[].id` | Univoco, 1–24 lettere ASCII, numeri, `_` o `-` |
| `switches[].priority` | Default 32768; multiplo di 4096 da 0 a 61440 |
| `switches[].mac` | MAC esadecimale con `:`; generato automaticamente se omesso |
| `links` | Da 0 a 60 collegamenti punto a punto |
| `links[].id` | Facoltativo, univoco; generato come L1, L2, … |
| `links[].from`, `to` | ID di due switch esistenti e diversi |
| `links[].dataRateMbps` | Capacità in Mbps: 10, 100, 1000, 10000, 25000 o 40000. Default 100; il costo standard short viene calcolato automaticamente |
| `links[].fromPort`, `toPort` | Facoltativi; interi da 1 a 4095, univoci sullo switch; assegnati in ordine se omessi |

Ogni Bridge ID (priorità + MAC) deve essere univoco. Sono ammessi collegamenti paralleli e componenti disconnesse. Le priorità delle porte sono tutte 128. Il costo viene determinato automaticamente dalla capacità, con il metodo **short IEEE 802.1D**:

| Capacità del link | Costo standard short |
| --- | --- |
| 10 Mbps | 100 |
| 100 Mbps | 19 |
| 1 Gbps | 4 |
| 10 Gbps | 2 |
| 25 Gbps | 1 |
| 40 Gbps | 1 |

Queste sono le capacità supportate. La capacità e il costo calcolato sono mostrati sui link e nella tabella delle porte. Non si utilizzano i valori del metodo long. [Riferimento per i costi short: Cisco, Default Spanning-Tree Configuration](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst9400/software/release/17-3/configuration_guide/lyr2/b_173_lyr2_9400_cg/configuring_spanning_tree_protocol.html).

Per compatibilità, i vecchi file con solo `cost` sono convertiti se il costo individua una capacità univoca supportata (100, 19, 4, 2). Un costo 1 da solo è ambiguo: occorre specificare `dataRateMbps`. Se un file contiene sia capacità sia costo, il costo deve coincidere con quello standard calcolato. Editor e download salvano la capacità e omettono il costo derivato.

## Modello e limiti didattici

L’algoritmo confronta informazioni STP locali, ricevute mediante BPDU. Ogni switch parte come root e ogni porta come designated, con stato dati blocking. Un turno fotografa le BPDU inviate dalle porte localmente designated; ogni consegna crea uno snapshot indipendente della rete. Le informazioni superiori vengono mantenute e la root port viene scelta confrontando Root ID, costo totale, Bridge ID del mittente, Port ID del mittente e Port ID locale. Una porta non root è designated se il proprio vettore pubblicizzato prevale su quello ricevuto, altrimenti è bloccata.

Quando un intero turno non modifica più informazioni o ruoli, l’elezione è terminata. Per separare visivamente le fasi, le porte RP/DP passano insieme a listening, learning e forwarding; le BL restano in blocking. Il primo forward delay è di 15 s, il secondo di altri 15 s, rappresentati con passi immediati. Non sono secondi trascorsi durante la riproduzione.

Questo è un modello di avvio a turni sincroni, con topologia fissa e una sola istanza STP, **non un emulatore temporale completo IEEE 802.1D**. In un apparato reale invio, ricezione e transizioni delle porte sono asincroni. Non sono modellati Max Age, hello periodici dopo la convergenza, guasti e riconvergenza, TCN, VLAN multiple, LAN condivise, priorità delle porte personalizzate, PortFast o RSTP. Le componenti disconnesse formano una foresta, con una root per componente.

Riferimento: [Cisco, Spanning Tree Protocol](https://www.cisco.com/c/en/us/td/docs/switches/lan/catalyst6500/ios/15-5SY/config_guide/sup2T/15_4_sy_swcg_2T/spanning_tree.html).

## Verifica

Con Node.js 20 o successivo:

```sh
node --test tests/stp.test.cjs
```

I test verificano gli esempi, gli spareggi, i percorsi a costo minimo, i componenti disconnessi, la validazione e l’indipendenza degli snapshot. Duecento reti casuali riproducibili vengono confrontate con un oracolo indipendente basato su componenti connesse, Dijkstra e regole di selezione delle porte.

## File

- `stp.js`: motore di simulazione, utilizzabile anche da Node.js.
- `index.html`, `styles.css`, `app.js`: interfaccia, disegno SVG e controlli.
- `presets.js`: esempi incorporati per funzionare anche con apertura diretta da disco.
- `examples/`: topologie JSON modificabili.
- `tests/stp.test.cjs`: verifiche del motore.
