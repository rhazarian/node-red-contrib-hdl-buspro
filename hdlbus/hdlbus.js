var util = require("util");
var SmartBus = require('smart-bus-mrgadget');
var EventEmitter = require('events').EventEmitter;
var cmdsLink = {
	49: 50
};

module.exports = function(RED) {
    var ctrlr = null;

    var db = [];

    function net() {
        this.name = 'None';
        this.dev = [];
    }

    function device(chCount, uvCount) {
        this.chCount = chCount;
        this.uvCount = uvCount;
        this.ch = [];
        this.uv = [];
    }

    var dev = {
        uv: [],
    }

    function chGet(n, d, c) {
        if (db[n] == undefined) db[n] = new net();
        if (db[n].dev[d] == undefined) db[n].dev[d] = new device();
        if (db[n].dev[d].ch[c] == undefined) db[n].dev[d].ch[c] = 0;
        return db[n].dev[d];
    }

    function chLvl(n, d, c) {
        return chGet(n, d, c).ch[c];
    }

    function chUpd(n, d, c, l) {
        var val = chGet(n, d).ch[c];
        if (chGet(n, d).ch[c] != l) {
            //module.emit('ch', n, d, c, l);
            //log.event.verbose('ch upd - dst:' + n + '.' + d + ', ch:' + c + ', lvl:' + l);
        }
        chGet(n, d).ch[c] = l;
    }

    function uvGet(n, d, c) {
        if (db[n] == undefined) db[n] = new net();
        if (db[n].dev[d] == undefined) db[n].dev[d] = new device();
        if (db[n].dev[d].uv[c] == undefined) db[n].dev[d].uv[c] = 0;
        return db[n].dev[d];
    }

    function uvLvl(n, d, c) {
        return uvGet(n, d, c).uv[c];
    }

    function uvUpd(n, d, c, l) {
        var val = uvGet(n, d).uv[c];
        if (uvGet(n, d).uv[c] != l) {
            //module.emit('uv', n, d, c, l);
            //log.event.verbose('uv upd - dst:' + n + '.' + d + ', uv:' + c + ', ' + (l == 0 ? 'off' : 'on'));
        }
        uvGet(n, d).uv[c] = l;
    }

    function HdlBusControllerNode(n) {
        RED.nodes.createNode(this,n);
        this.host = n.host;
        this.port = n.port || 6000;
        this.subnetid= n.subnetid;
        this.deviceid = n.deviceid;
        this.broadcast = n.broadcast
        //this.deviceid = parseInt(n.subnetid)+"."+parseInt(n.deviceid);
        this.deviceAddress = parseInt(n.subnetid) + "." + parseInt(n.deviceid);
        var node = this;
		this.bus = new SmartBus({
            device: node.deviceAddress,     // Connector address in HDL network (subnet.id)
  			gateway: node.host, 		    // HDL SmartBus gateway IP
            port: node.port,                // port, default: 6000
            broadcast: node.broadcast       // listen to broadcast rather than just specified IP gateway
        });

        if (n.daliId) this.daliId = n.daliId;


        this.bus.on('listening', function() {
            node.bus.setBroadcast(true);
        });

        this.bus.on('command', processCommand);

		this.on("close",function(){
			node.bus.removeAllListeners();
			node.bus.socket.close();
        })

        //Lots of listeners required, have to increase the limit
        this.bus.setMaxListeners(0);
        
        ctrlr = this;
    }
    RED.nodes.registerType("hdl-controller",HdlBusControllerNode);

    function processCommand(cmd) {
        switch (cmd.code) {
            case 0xE01C:
                if (cmd.target.subnet == ctrlr.subnetid && cmd.target.id == ctrlr.deviceid) {
                    // UV switch to us, we need to ack this...
                    ctrlr.bus.send('255.255', 0xE01D, {switch: cmd.data.switch, status: cmd.data.status ? 1 : 0} );
                }
                break;
            case 0xE019:
            case 0xE01D:
                uvUpd(cmd.target.subnet, cmd.target.id, cmd.data.switch, cmd.data.status);
                break;
            case 0x0032:
                chUpd(cmd.sender.subnet, cmd.sender.id, cmd.data.channel, cmd.data.level);
                break;
            case 0x0033:
                break;
            case 0x0034:
                for (channel of cmd.data.channels) {
                    chUpd(cmd.sender.subnet, cmd.sender.id, channel.number, channel.level);
                }
                break;
        }
    }

    function HdlBusIn(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){
        	var msg = {};
		  	msg.sender = cmd.sender.address;
		  	msg.target = cmd.target.address;
		  	msg.code = cmd.code;
		  	msg.payload = cmd.data;
            msg.topic = 'command';
		  	node.send(msg);
		};

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-raw-in",HdlBusIn);

    function HdlBusOut(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!msg.target || !msg.code){
                node.error("Required parameters msg.target and msg.code");
                return;
            }
            node.bus.send(msg.target, msg.code, msg.payload, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-raw-out",HdlBusOut);

    function HdlChannelIn(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){    
            if (cmd.code == 0x32
                && config.address == cmd.sender.address
                && config.channel == cmd.data.channel
            ) {
                switch (config.level) {
                    case undefined || '':
                        //Raise event on all changes
                        break;
                    case 'on':
                        if (cmd.data.level == 0) return;
                        break;
                    case 'off':
                        if (cmd.data.level > 0) return;
                        break;
                    default:
                        if (cmd.data.level != config.level) return;
                }
                var msg = {};
                msg.sender = cmd.sender.address;
                msg.payload = {
                    level: cmd.data.level
                };
                msg.topic = 'command';
                node.send(msg);
            }
		};

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-channel-in",HdlChannelIn);

    function HdlChannelOut(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!config.channel && (msg.payload.channel == undefined) || (!config.level && (msg.payload.level == undefined))) {
                node.error("Required parameters msg.payload.channel and msg.payload.level");
                return;
            }

            // Create payload if it doesn't exist
            if (msg.payload == null || typeof msg.payload != "object") msg.payload = {};
        
            // Insert config values if override doesn't exist
            if (msg.payload.address == null) msg.payload.address = config.address;
            if (msg.payload.channel == null ) msg.payload.channel = config.channel;
            if (msg.payload.level == null ) msg.payload.level = config.level;

            node.bus.send(msg.payload.address, 0x31, {channel: msg.payload.channel, level: msg.payload.level}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-channel-out", HdlChannelOut);

    function HdlChannelGet(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!config.address && (msg.payload.address == undefined) || !config.channel && (msg.payload.channel == undefined)) {
                node.error("Required parameter(s) missing - address (opt:msg.address) and channel (opt:msg.channel) are required.");
                return;
            }

            // Create payload if it doesn't exist
            if (msg.payload == null || typeof msg.payload != "object") msg.payload = {};
            
            // Insert config values if override doesn't exist
            if (msg.payload.address == null) msg.payload.address = config.address;
            if (msg.payload.channel == null ) msg.payload.channel = config.channel;

            var ch = msg.payload.address.split(".");
            msg.payload.level = chLvl(parseInt(ch[0]), parseInt(ch[1]), parseInt(msg.payload.channel));
            node.send(msg);
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-channel-get", HdlChannelGet);

    function HdlBusUvIn(config) {
        RED.nodes.createNode(this, config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){
            if (cmd.code == 0xE01C
                    && controller.deviceAddress == (cmd.target.address)
                    && config.switch == cmd.data.switch
                    && (config.state == 2 || config.state == cmd.data.status)
                ) {
                    var msg = {};
                    msg.sender = cmd.sender.address;
                    msg.payload = {state: cmd.data.status};
                    msg.topic = 'uv_switch';
                    if (config.reset == true) msg.reset = true;
                    node.send(msg);
            }
        }

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-uv-in",HdlBusUvIn);

    function HdlUvOut(config) {
        RED.nodes.createNode(this, config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!config.switch && (msg.payload.switch == undefined) || ((config.state == undefined) && (msg.payload.state == undefined))) {
                node.error("Required parameters msg.switch and msg.state");
                return;
            }

            // Create payload if it doesn't exist
            if (msg.payload == null || typeof msg.payload != "object") msg.payload = {};
            
            // Insert config values if override doesn't exist
            if (msg.payload.address == null) msg.payload.address = config.address;
            if (msg.payload.switch == null ) msg.payload.switch = config.switch;
            if (msg.payload.state == null) msg.payload.state = config.state;
            msg.payload.status = msg.payload.state;

            node.bus.send(msg.payload.address, 0xE01C, msg.payload, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-uv-out", HdlUvOut);

    function getColorIndex(name) {
        switch (name) {
            case "red": return 2;
            case "green": return 3;
            case "blue": return 4;
            case "orange": return 5;
            default: return 1;
        }
    }

    function HblBtnColor(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            var colorOff = 0;
            var colorOn = 0;
            //<option value="1">white</option>
            //<option value="2">red</option>
            //<option value="3">green</option>
            //<option value="4">blue</option>
            //<option value="5">orange</option>

            // Create payload if it doesn't exist
            if (msg.payload == null || typeof msg.payload != "object") msg.payload = {};
                        
            if (msg.payload.colorOff == null) colorOff = config.colorOff;
            if (msg.payload.colorOn == null) colorOn = config.colorOn;
            if (msg.payload.color != null) {
                colorOff = getColorIndex(msg.payload.color);
                colorOn = getColorIndex(msg.payload.color);
            }
            
            switch (parseInt(colorOff)) {
                case 0: colorOff = [0, 0, 0]; break;
                case 1: colorOff = [255, 255, 255]; break;
                case 2: colorOff = [255, 0, 0]; break;
                case 3: colorOff = [0, 255, 0]; break;
                case 5: colorOff = [255, 155, 5]; break;
                default: colorOff = [255, 255, 255]; // white default
            }
            
            switch (parseInt(colorOn)) {
                case 0: colorOn = [0, 0, 0]; break;
                case 1: colorOn = [255, 255, 255]; break;
                case 2: colorOn = [255, 0, 0]; break;
                case 3: colorOn = [0, 255, 0]; break;
                case 4: colorOn = [0, 0, 255]; break;
                case 5: colorOn = [255, 155, 5]; break;
                default: colorOn = [0, 0, 255]; // blue default
            }

            var data = {
                "button": config.button, 
                "color": {
                    "off": colorOff, 
                    "on": colorOn
                }    
            };

            node.bus.send(config.address, 0xE14E, data, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-btn-color", HblBtnColor);

    function HdlPanelBrightness(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            // Create payload if it doesn't exist
            if (msg.payload == null || typeof msg.payload != "object") msg.payload = {};
            
            // Insert config values if override doesn't exist
            if (msg.payload.address == null) msg.payload.address = config.address;
            if (msg.payload.brightness == null ) msg.payload.brightness = config.brightness;
            msg.payload.backlight = msg.payload.brightness;
            msg.payload.statusLights = msg.payload.brightness;

            node.bus.send(msg.payload.address, 0xE012, msg.payload, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{

        });
    }
    RED.nodes.registerType("hdl-panel-brightness", HdlPanelBrightness);

    function HdlDaliGroups(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;

        var physical = new node.bus.createDevice(config.physicalAddress);
        var virtual = new node.bus.createDevice(config.virtualAddress);

        node.receivedCmd = function(cmd) {
            if (cmd.target.address == virtual.address) {
                switch (cmd.code) {
                    case 0x0031:
                        // Single channel request, forward to physical
                        cmd.data.channel += 64
                        node.bus.sendAs(cmd.sender, physical, cmd.code, cmd.data);
                        break;
                    case 0x0033:
                        // Status request to virtual - respond as virtual (from data array)
                        var chs = [];
                        for (var d = 1; d <= 16; d++) {
                            var ch = d + 64;
                            chs.push({number: d, level: chLvl(physical.subnet, physical.id, ch)});
                        }
                        node.bus.sendAs(virtual, cmd.sender, 0x0034, {channels: chs});
                        break;
                }
            } else if (cmd.sender.address == physical.address) {
                switch (cmd.code) {
                    case 0x0032:
                        //Single channel response - forward as virtual device
                        if (cmd.data.channel > 64) {
                            cmd.data.channel -= 64
                            node.bus.sendAs(virtual, cmd.target, cmd.code, cmd.data);
                        }
                        break;
                }
            }
		};

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-dali-groups", HdlDaliGroups);

    function HdlVirtualHvacIn(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){    
            if (cmd.code == 0x193A
                && config.address == cmd.target.address
            ) {
                var msg = {};
                msg.sender = cmd.sender.address;
                msg.payload = cmd.data;
                msg.topic = 'command';
                node.send(msg);
            }
		};

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-virtual-hvac-in",HdlVirtualHvacIn);

    function HdlVirtualHvacOut(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!msg.payload) {
                node.error("Required parameter: msg.payload");
                return;
            }

            node.bus.sendAs(config.address, "255.255", 0x193B, msg.payload, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-virtual-hvac-out", HdlVirtualHvacOut);

    function HdlVirtualTempSensor(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;

        node.temp = [];

        node.receivedCmd = function(cmd){    
            if (cmd.code == 0x1948 && config.address == cmd.target) {
                // Request for temperature received, create payload from stored data
                var payload = {
                    channel: cmd.data.channel || 0,
                    temperature: node.temp[cmd.data.channel || 0] || -1
                }
                // Send to network
                node.bus.sendAs(config.address, "255.255", 0x1949, payload, function(err) {
                    if (err){
                        node.error(err);   
                    }
                });
            }
		};
        
        this.on('input', (msg)=>{
            if (!msg.payload || !msg.payload.temperature) {
                node.error("Required parameter: msg.payload.temperature");
                return;
            }
            
            node.temp[msg.payload.channel || 0] = msg.payload.temperature;
        });
       
		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-virtual-temp-sensor", HdlVirtualTempSensor);    
}