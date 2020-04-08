// Load Mongoose OS API
load('api_timer.js');
load('api_gpio.js');
load('api_sys.js');
load('api_mqtt.js');
load('api_config.js');
load('api_log.js');
load('api_math.js');
load('api_file.js');
load('api_rpc.js');

// (convert A-Z to a-z)
let tolowercase = function(s) {
    let ls = '';
    for (let i = 0; i < s.length; i++) {
	let ch = s.at(i);
	if(ch >= 0x41 && ch <= 0x5A)
	    ch |= 0x20;
	ls += chr(ch);
    }
    return ls;
};
/*
 * get event values, lookup mongoose.h:
 *
 * #define MG_MQTT_CMD_CONNACK 2
 * #define MG_MQTT_EVENT_BASE 200
 *
 * #define MG_EV_CLOSE 5
 *
 * #define MG_EV_MQTT_CONNACK (MG_MQTT_EVENT_BASE + MG_MQTT_CMD_CONNACK)
 *
*/
let MG_EV_MQTT_CONNACK = 202;
let MG_EV_CLOSE = 5;


let client_id = Cfg.get('device.id');
let thing_id = tolowercase(client_id.slice(client_id.length-6, client_id.length));
//let dev_name = 'edGarDo_' + thing_id;	
let base_topic = 'homie/edgardo' + thing_id;
let state_topic = base_topic + '/$state';
let hab_door_topic = base_topic + '/door/state';    	// see homie_init
let hab_button_topic = base_topic + '/button/state';	// see homie_init
let hab_control_topic = hab_button_topic + '/set';
let bindled_pin = 14;
let onlineled_pin = 13;
let relay_pin = 12;
let button_pin = 0;
let closed_pin = 25;
let open_pin = 26;          // if you don't have a switch for this function, ground this pin
let activity_pin = 27;      // if your controller does not provide this function, leave this pin open
let mqtt_connected = false;
let door_state = 'undef';
let former_door_state = door_state;
// homie-required last will
if(Cfg.get('mqtt.will_topic') !== state_topic) {
	Cfg.set({mqtt: {will_topic: state_topic}});
	Cfg.set({mqtt: {will_message: 'lost'}});
	Cfg.set({mqtt: {client_id: client_id}});
	Log.print(Log.INFO, 'MQTT last will has been updated');
};

// init hardware
GPIO.set_mode(relay_pin, GPIO.MODE_OUTPUT);
GPIO.write(relay_pin, 0);
GPIO.set_mode(bindled_pin, GPIO.MODE_OUTPUT);
GPIO.write(bindled_pin, 0);
GPIO.set_mode(onlineled_pin, GPIO.MODE_OUTPUT);
GPIO.blink(onlineled_pin, 100, 100);
GPIO.set_mode(button_pin, GPIO.MODE_INPUT);
GPIO.set_mode(closed_pin, GPIO.MODE_INPUT);
GPIO.set_mode(activity_pin, GPIO.MODE_INPUT);
GPIO.set_mode(open_pin, GPIO.MODE_INPUT);
// *** REMOVE
GPIO.set_pull(closed_pin, GPIO.PULL_UP);
GPIO.set_pull(activity_pin,GPIO.PULL_UP);
GPIO.set_pull(open_pin,GPIO.PULL_DOWN);
// ***


// operate control (relay) pin
let activate = function () {
    Log.print(Log.INFO,'Operating on door control');
    GPIO.write(relay_pin, 1);
    Timer.set(1500, 0, function() {
        Log.print(Log.DEBUG,'Timer expired, deactivating');
        GPIO.write(relay_pin, 0);
    }, null);
};


// MQTT publish
let publish = function (topic, msg) {
    let ok = MQTT.pub(topic, msg, 1, true);	// QoS = 1, retain
    Log.print(Log.INFO, 'Published:' + (ok ? 'OK' : 'FAIL') + ' topic:' + topic + ' msg:' +  msg);
    return ok;
};


// handle door states, and report to cloud if online
let state_handler = function(forced) {
    if(GPIO.read(activity_pin) === 0) {            // 'activity' takes precedence (1 if not used)
        door_state = 'moving';
    } else if(GPIO.read(closed_pin) === 0) {       // then 'closed'
        door_state = 'closed';
    } else if(GPIO.read(open_pin) === 0) {         // then 'open' (0 if not used)
        door_state = 'open';
    } else {                                       // if all are true, asume half-open
        door_state = 'halfopen';
    }
    if(door_state !== former_door_state || forced) {
        Log.print(Log.INFO, 'Door state changed to ' + door_state);
        if(mqtt_connected === true) {
            publish(hab_door_topic, door_state);
        }
        former_door_state = door_state;
    }
};


// Update state every second
Timer.set(1000, Timer.REPEAT, state_handler, false);


// MQTT control
MQTT.sub(hab_control_topic, function(conn, topic, command) {
    Log.print(Log.DEBUG, 'rcvd ctrl msg:' + command);
    if ( command === 'true' ) {
        Log.print(Log.DEBUG,'MQTT control received');
        activate();
    } else if ( command === 'false' ) {
        
    } else {
        Log.print(Log.ERROR, 'Unsupported command');
    }
    state_handler(false);
}, null);

// MQTT startup
MQTT.setEventHandler(function(conn, ev, edata) {
    if (ev === MG_EV_MQTT_CONNACK) {
        mqtt_connected = true;
        GPIO.blink(onlineled_pin, 100, 3900);
        Log.print(Log.INFO, 'MQTT connected');
        // auto-discovery
        homie_init();
        state_handler(true);
    }
    else if (ev === MG_EV_CLOSE) {
        mqtt_connected = false;
        GPIO.blink(onlineled_pin, 100, 100);
        Log.print(Log.ERROR, 'MQTT disconnected');
    }
}, null);

// BT security
let tobindornottobind = ffi('bool mgos_bt_gap_set_pairing_enable(bool)');
let advertising = ffi('bool mgos_bt_gap_set_adv_enable(bool)');

// handle button: enable (advertising and) binding for some time
GPIO.set_button_handler(button_pin, GPIO.PULL_NONE, GPIO.INT_EDGE_POS, 100, function() {
//    let ok = advertising(true);
//    Log.print(Log.DEBUG,'Button pressed, advertising call:' + (ok ? 'success' : 'failure'));
    let ok = tobindornottobind(true);
    Log.print(Log.DEBUG,'Button pressed, pairing call:' + (ok ? 'success' : 'failure'));
    GPIO.blink(bindled_pin, 200, 300);
    Timer.set(30000, 0, function() {
        let ok = false;
//        ok = advertising(false);
//        Log.print(Log.DEBUG,'Timer expired after button pressed, advertising call:' + (ok ? 'success' : 'failure'));
        ok = tobindornottobind(false);
        Log.print(Log.DEBUG,'Timer expired after button pressed, pairing call:' + (ok ? 'success' : 'failure'));
        GPIO.blink(bindled_pin, 0, 0);
    }, null);
}, null);

// RPC control
// set RPC command: enable output for some time
RPC.addHandler('Door.Set', function(args) {
	// no args parsing required
    Log.print(Log.DEBUG,'Control RPC function called');
    activate();
    state_handler(false);
    let response = {
    	rc: (1) ? 'OK' : 'Failed'
    };
    return response;
});
// set RPC command: report door state
RPC.addHandler('Door.Get', function(args) {
	// no args parsing required
    Log.print(Log.DEBUG,'Status RPC function called');
    state_handler(false);
    let response = {
    	rc: door_state
    };
    return response;
});


let homie_init = function () {
    publish(state_topic, 'init');
    publish(base_topic + '/$homie', '4.0.0');
    publish(base_topic + '/$name', 'edGarDo, ed Garage Door opener');
    publish(base_topic + '/$extensions', '');
    publish(base_topic + '/$nodes', 'button,door');
    publish(base_topic + '/button/$name', 'Control button');
    publish(base_topic + '/button/$type', 'Push button');
    publish(base_topic + '/button/$properties', 'state');
    publish(hab_button_topic + '/$name', 'Button state');
    publish(hab_button_topic + '/$settable', 'true');
//    publish(hab_button_topic + '/$retained', false);
    publish(hab_button_topic + '/$datatype', 'boolean');
    publish(base_topic + '/door/$name', 'Door');
    publish(base_topic + '/door/$type', 'Open Close');
    publish(base_topic + '/door/$properties', 'state');
    publish(hab_door_topic + '/$name', 'Door state');
    publish(hab_door_topic + '/$datatype', 'enum');
    publish(hab_door_topic + '/$format', 'open,moving,halfopen,closed');
    publish(hab_button_topic, 'false');
    publish(state_topic, 'ready');
};

Log.print(Log.WARN, "### init script started ###");

