window.STP_PRESETS = {
  "redundant": {
    "name": "Rete ridondante",
    "switches": [
      {
        "id": "SW1",
        "priority": 24576,
        "mac": "02:00:00:00:00:01"
      },
      {
        "id": "SW2",
        "mac": "02:00:00:00:00:02"
      },
      {
        "id": "SW3",
        "mac": "02:00:00:00:00:03"
      },
      {
        "id": "SW4",
        "mac": "02:00:00:00:00:04"
      },
      {
        "id": "SW5",
        "mac": "02:00:00:00:00:05"
      }
    ],
    "links": [
      {
        "from": "SW1",
        "to": "SW2",
        "dataRateMbps": 1000
      },
      {
        "from": "SW1",
        "to": "SW3",
        "dataRateMbps": 1000
      },
      {
        "from": "SW2",
        "to": "SW3",
        "dataRateMbps": 1000
      },
      {
        "from": "SW2",
        "to": "SW4",
        "dataRateMbps": 100
      },
      {
        "from": "SW3",
        "to": "SW5",
        "dataRateMbps": 100
      },
      {
        "from": "SW4",
        "to": "SW5",
        "dataRateMbps": 1000
      }
    ]
  },
  "triangle": {
    "name": "Il triangolo",
    "switches": [
      {
        "id": "SW1"
      },
      {
        "id": "SW2"
      },
      {
        "id": "SW3"
      }
    ],
    "links": [
      {
        "from": "SW1",
        "to": "SW2",
        "dataRateMbps": 100
      },
      {
        "from": "SW2",
        "to": "SW3",
        "dataRateMbps": 100
      },
      {
        "from": "SW1",
        "to": "SW3",
        "dataRateMbps": 100
      }
    ]
  },
  "weighted": {
    "name": "Il percorso meno costoso",
    "switches": [
      {
        "id": "SW1",
        "priority": 4096
      },
      {
        "id": "SW2"
      },
      {
        "id": "SW3"
      },
      {
        "id": "SW4"
      }
    ],
    "links": [
      {
        "from": "SW1",
        "to": "SW2",
        "dataRateMbps": 1000
      },
      {
        "from": "SW2",
        "to": "SW3",
        "dataRateMbps": 1000
      },
      {
        "from": "SW1",
        "to": "SW3",
        "dataRateMbps": 100
      },
      {
        "from": "SW3",
        "to": "SW4",
        "dataRateMbps": 1000
      },
      {
        "from": "SW2",
        "to": "SW4",
        "dataRateMbps": 100
      }
    ]
  },
  "parallel": {
    "name": "Spareggio tra porte",
    "switches": [
      {
        "id": "SW1"
      },
      {
        "id": "SW2"
      }
    ],
    "links": [
      {
        "from": "SW1",
        "to": "SW2",
        "fromPort": 2,
        "toPort": 1,
        "dataRateMbps": 1000
      },
      {
        "from": "SW1",
        "to": "SW2",
        "fromPort": 1,
        "toPort": 2,
        "dataRateMbps": 1000
      }
    ]
  }
};
