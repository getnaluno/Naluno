package com.naluno.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * NalunoMesh — the offline transport for Lifeline.
 *
 * WHAT THIS IS FOR
 * During an internet shutdown this carries Wireline messages from phone to
 * phone over Bluetooth and Wi-Fi, with no network of any kind. A phone holds
 * a sealed packet and hands it on to whoever it meets, until it reaches the
 * person it is for.
 *
 * WHAT IT DOES NOT DECIDE
 * Nothing. It finds nearby phones and moves bytes. Which packet goes where,
 * how many copies exist and when to delete them is decided in JavaScript
 * (js/lifeline.js), so the routing can be tested without any phones.
 *
 * WHAT IT NEVER SEES
 * Packets are sealed end to end before they get here, and carry no sender
 * and no recipient — only a tag that changes daily and that only the two
 * people can compute. A relaying phone cannot read what it carries or tell
 * who is talking to whom.
 *
 * REQUIREMENTS AND LIMITS (be honest with people about these)
 *  - Needs Google Play services. Nearby Connections itself works with NO
 *    internet, but a device without Play services cannot take part.
 *  - Range is tens of metres per hop. It spreads across a crowd, a market,
 *    a campus or a dense neighbourhood. It cannot leave the country — SMS
 *    is the route abroad.
 *  - Android only. iOS and the browser have no equivalent permission.
 *  - Delivery is eventual, not instant: minutes to hours, depending on how
 *    many Naluno phones are moving between the two people.
 *
 * BUILD
 *  build.gradle:  implementation 'com.google.android.gms:play-services-nearby:19.3.0'
 *  Register in MainActivity: registerPlugin(NalunoMeshPlugin.class);
 */
@CapacitorPlugin(
    name = "NalunoMesh",
    permissions = {
        @Permission(alias = "nearby", strings = {
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        })
    }
)
public class NalunoMeshPlugin extends Plugin {

    /** P2P_CLUSTER: many-to-many, which is what a crowd looks like. */
    private static final Strategy STRATEGY = Strategy.P2P_CLUSTER;
    private static final String SERVICE_ID = "com.naluno.mesh.v1";
    /** A packet is ~120–600 bytes; this is a generous ceiling. */
    private static final int MAX_PAYLOAD = 8 * 1024;

    private ConnectionsClient client;
    private final Set<String> connected = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());
    private boolean running = false;

    private ConnectionsClient client() {
        if (client == null) client = Nearby.getConnectionsClient(getContext());
        return client;
    }

    /**
     * A neutral, rotating advertising name. It must NOT be the person's
     * callsign or uid: the advertised name is visible to anything scanning
     * nearby, and a fixed name would let someone track a person's phone
     * around a city.
     */
    private String advertName() {
        return "naluno-" + Long.toHexString(System.currentTimeMillis() / 3600000L);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (running) { call.resolve(new JSObject().put("running", true)); return; }
        try {
            client().startAdvertising(
                advertName(), SERVICE_ID, lifecycle,
                new AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
            );
            client().startDiscovery(
                SERVICE_ID, discovery,
                new DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
            );
            running = true;
            call.resolve(new JSObject().put("running", true));
        } catch (Exception e) {
            call.reject("mesh could not start: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            client().stopAdvertising();
            client().stopDiscovery();
            client().stopAllEndpoints();
        } catch (Exception ignored) { }
        connected.clear();
        running = false;
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(new JSObject().put("running", running).put("peers", connected.size()));
    }

    /** Send "what I hold" to one peer. */
    @PluginMethod
    public void sendSummary(PluginCall call) {
        String peer = call.getString("peer", "");
        String s = call.getString("s", "");
        sendJson(peer, "sum", s, null, 0);
        call.resolve();
    }

    /** Send "what I hold" to everyone currently in range. */
    @PluginMethod
    public void broadcastSummary(PluginCall call) {
        String s = call.getString("s", "");
        for (String peer : connected) sendJson(peer, "sum", s, null, 0);
        call.resolve();
    }

    /** Hand one sealed packet to one peer, with the number of copies given. */
    @PluginMethod
    public void sendPacket(PluginCall call) {
        String peer = call.getString("peer", "");
        String p = call.getString("p", "");
        int copies = call.getInt("copies", 1);
        sendJson(peer, "pkt", null, p, copies);
        call.resolve();
    }

    private void sendJson(String peer, String kind, String summary, String packet, int copies) {
        if (peer == null || peer.isEmpty() || !connected.contains(peer)) return;
        try {
            JSONObject o = new JSONObject();
            o.put("k", kind);
            if (summary != null) o.put("s", summary);
            if (packet != null) { o.put("p", packet); o.put("c", copies); }
            byte[] bytes = o.toString().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > MAX_PAYLOAD) return;
            client().sendPayload(peer, Payload.fromBytes(bytes));
        } catch (Exception ignored) { }
    }

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String id, DiscoveredEndpointInfo info) {
            if (!SERVICE_ID.equals(info.getServiceId())) return;
            try { client().requestConnection(advertName(), id, lifecycle); } catch (Exception ignored) { }
        }
        @Override
        public void onEndpointLost(String id) {
            connected.remove(id);
        }
    };

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String id, ConnectionInfo info) {
            /* Accepted without a code on purpose. There is nothing to protect
               at this layer: every packet is already sealed end to end, and
               carries no names. Asking a person to confirm each stranger they
               pass in the street would stop the mesh working at all, which is
               the one thing it exists to do. */
            try { client().acceptConnection(id, payloads); } catch (Exception ignored) { }
        }
        @Override
        public void onConnectionResult(String id, ConnectionResolution result) {
            if (result.getStatus().isSuccess()) {
                connected.add(id);
                JSObject ev = new JSObject();
                ev.put("peer", id);
                notifyListeners("peerConnected", ev);
            } else {
                connected.remove(id);
            }
        }
        @Override
        public void onDisconnected(String id) {
            connected.remove(id);
        }
    };

    private final PayloadCallback payloads = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String id, Payload payload) {
            try {
                if (payload.getType() != Payload.Type.BYTES) return;
                byte[] bytes = payload.asBytes();
                if (bytes == null || bytes.length > MAX_PAYLOAD) return;
                JSONObject o = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                String kind = o.optString("k", "");
                if ("sum".equals(kind)) {
                    JSObject ev = new JSObject();
                    ev.put("peer", id);
                    ev.put("s", o.optString("s", ""));
                    notifyListeners("peerSummary", ev);
                } else if ("pkt".equals(kind)) {
                    JSObject ev = new JSObject();
                    ev.put("peer", id);
                    ev.put("p", o.optString("p", ""));
                    ev.put("copies", o.optInt("c", 1));
                    notifyListeners("packet", ev);
                }
            } catch (Exception ignored) { }
        }
        @Override
        public void onPayloadTransferUpdate(String id, PayloadTransferUpdate update) { }
    };
}
