/* Carrier-network simulator: the two phones cannot reach each other's own
   addresses (host/srflx), only a TURN relay. Every non-relay candidate the
   page is given has its port replaced by a dead one, so only relay routes
   (and routes learned through a relay) can connect. The IP stays, so TURN
   permissions are created as on a real network. */
(function(){
  const dead = function(line){
    return String(line).replace(/^((?:a=)?candidate:\S+ \d+ \S+ \d+ \S+ )(\d+)( typ (?!relay)\w+)/, function(_, a, port, c){ return a + '64999' + c; });
  };
  const P = RTCPeerConnection.prototype;
  const srd = P.setRemoteDescription;
  P.setRemoteDescription = function(d){
    try{
      if(d && d.sdp){
        const sdp = d.sdp.split('\r\n').map(function(l){ return /^a=candidate:/.test(l) ? dead(l) : l; }).join('\r\n');
        d = { type: d.type, sdp: sdp };
      }
    }catch(_){}
    return srd.apply(this, [d].concat([].slice.call(arguments, 1)));
  };
  const aic = P.addIceCandidate;
  P.addIceCandidate = function(c){
    try{
      if(c && c.candidate){
        c = { candidate: dead(c.candidate), sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment };
      }
    }catch(_){}
    return aic.apply(this, [c].concat([].slice.call(arguments, 1)));
  };
  window.__natsim = true;
})();
