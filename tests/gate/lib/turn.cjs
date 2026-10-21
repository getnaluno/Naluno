/* A TURN relay for the two-phone tests (node-turn). node lib/turn.cjs <port>
   Listens on 192.0.2.2, an address Chrome treats as a real network (it
   leaves loopback out of calls). run.cjs adds that address if it is missing. */
const Turn = require('node-turn');
const port = +(process.argv[2] || 3479);
const base = 49500 + (port - 3479) * 120;
const s = new Turn({ authMech: 'long-term', credentials: { u: 'c' }, listeningPort: port, listeningIps: ['192.0.2.2'], relayIps: ['192.0.2.2'], externalIps: '192.0.2.2', debugLevel: 'ERROR', minPort: base, maxPort: base + 100 });
s.start();
console.log('turn up ' + port);
