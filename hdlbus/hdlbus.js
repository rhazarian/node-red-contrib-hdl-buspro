var util = require("util");
var SmartBus = require('smart-bus');
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

        node.bus.on('listening', function() {
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
                //console.log(cmd.data.channel + " " + cmd.data.level);
                break;
            case 0x0033:
                if (ctrlr.daliId && cmd.target.subnet == ctrlr.subnetid && cmd.target.id == ctrlr.daliId) { //} && cmd.data.channel > 64) {
                    //Respond on behalf of useless DALI controller for groups (from stored values)
                    var chs = [];
                    for (var d = 1; d <= 80; d++) {
                        chs.push({number: d, level: chLvl(cmd.target.subnet, cmd.target.id, d)});
                    }
                    ctrlr.bus.sendAs(cmd.target, cmd.sender, 0x0034, {channels: chs});
                    //var lvl = chLvl(cmd.target.subnet, cmd.target.id, cmd.data.channel);
                    //ctrlr.bus.sendAs(cmd.target, cmd.sender, 0x0032, {channel: cmd.data.channel, level: lvl, success: true});
                }
                break;
            case 0x0034:
                for (channel of cmd.data.channels) {
                    chUpd(cmd.sender.subnet, cmd.sender.id, channel.number, channel.level);
                    //console.log(channel.number + " " + channel.level);
                }
                break;
        }
        //console.log(util.inspect('hdl:' + cmd));
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
                msg.sender = cmd.sender.address;// cmd.sender.address;
                msg.payload = cmd.data.level;
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
            if (msg.payload && msg.payload.config) {
                if (msg.payload.chOut) {
                    if (msg.payload.chOut.address) config.address = msg.payload.chOut.address;
                    if (msg.payload.chOut.channel) config.channel = msg.payload.chOut.channel;
                    if (msg.payload.chOut.level) config.channel = msg.payload.chOut.level;
                }
                //Don't actually do anything with this
                return;
            }

            if (!config.channel && (msg.channel == undefined) || (!config.level && (msg.level == undefined))) {
                node.error("Required parameters msg.channel and msg.level");
                return;
            }
            var tgtChannel = msg.channel != undefined  ? msg.channel : config.channel;
            var tgtLevel = msg.level != undefined ? msg.level : config.level;
            node.bus.send(config.address, 0x31, {channel: tgtChannel, level: tgtLevel}, function(err) {
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
            if (msg.payload && msg.payload.config) {
                if (msg.payload.chOut) {
                    if (msg.payload.chOut.address) config.address = msg.payload.chOut.address;
                    if (msg.payload.chOut.channel) config.channel = msg.payload.chOut.channel;
                }
                //Pass it on
                node.send(msg);
                return;
            }

            if (!config.address && (msg.address == undefined) || !config.channel && (msg.channel == undefined)) {
                node.error("Required parameter(s) missing - address (opt:msg.address) and channel (opt:msg.channel) are required.");
                return;
            }
            
            var tgtAddress = msg.address != undefined  ? msg.address : config.address;
            var tgtChannel = msg.channel != undefined ? msg.channel : config.channel;
            var ch = tgtAddress.split(".");
            if (msg.payload || msg.payload == false) 
                msg.payload = {original: msg.payload};
            else
                msg.payload = {};
            msg.payload.get = {
                address: tgtAddress, 
                channel: tgtChannel, 
                level: chLvl(parseInt(ch[0]), parseInt(ch[1]), parseInt(tgtChannel))
            };
            node.send(msg);
            // node.bus.send(tgtAddress, 0x31, {channel: tgtChannel}, function(err) {
            //     if (err){
            //         node.error(err);   
            //     }
            // });
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
                    msg.payload = cmd.data.status;
                    msg.topic = 'uv_switch';
                    if (config.reset == true) msg.reset = true;
                    node.send(msg);
            }
        }

        this.on('input', (msg)=>{
            //Process the config input
            if (msg.payload && msg.payload.config) {
                if (msg.payload.uvIn) {
                    if (msg.payload.uvIn.address) config.address = msg.payload.uvIn.address;
                    if (msg.payload.uvIn.switch) config.switch = msg.payload.uvIn.switch;
                }
            }

            //Pass it on
            node.send(msg);
        });

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
            //console.log(util.inspect(config));
            if (!config.switch && (msg.switch == undefined) || ((config.state == undefined) && (msg.state == undefined))) {
                node.error("Required parameters msg.switch and msg.state");
                return;
            }
            var tgtSwitch = msg.switch != undefined  ? msg.switch : config.switch;
            var tgtState = msg.state != undefined ? msg.state : config.state;
            node.bus.send(config.address, 0xE01C, {switch: tgtSwitch, status: tgtState}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-uv-out", HdlUvOut);

    function getColourIndex(name) {
        switch (name) {
            case "red": return 2;
            case "green": return 3;
            case "blue": return 4;
            case "orange": return 5;
            default: return 1;
        }
    }

    function HblBtnColour(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            //<option value="1">white</option>
            //<option value="2">red</option>
            //<option value="3">green</option>
            //<option value="4">blue</option>
            //<option value="5">orange</option>
            if (msg.payload && msg.payload.config) {
                if (msg.payload.btn) {
                    if (msg.payload.btn.colours) {
                        config.colourOn = getColourIndex(msg.payload.btn.colours);
                        config.colourOff = getColourIndex(msg.payload.btn.colours);
                    }
                    if (msg.payload.btn.colourOn) config.colourOn = getColourIndex(msg.payload.btn.colourOn);
                    if (msg.payload.btn.colourOff) config.colourOn = getColourIndex(msg.payload.btn.colourOff);
                }
                //Don't actually do anything with this
                return;
            }

            var colourOff = config.colourOff;
            var colourOn = config.colourOn;

            //Colour override
            if (msg.btnColours) {
                colourOn = getColourIndex(msg.btnColours);
                colourOff = getColourIndex(msg.btnColours);
            }
            
            switch (parseInt(colourOff)) {
                case 0: colourOff = [0, 0, 0]; break;
                case 1: colourOff = [255, 255, 255]; break;
                case 2: colourOff = [255, 0, 0]; break;
                case 3: colourOff = [0, 255, 0]; break;
                case 5: colourOff = [255, 155, 5]; break;
                default: colourOff = [255, 255, 255]; // white default
            }
            
            switch (parseInt(colourOn)) {
                case 0: colourOn = [0, 0, 0]; break;
                case 1: colourOn = [255, 255, 255]; break;
                case 2: colourOn = [255, 0, 0]; break;
                case 3: colourOn = [0, 255, 0]; break;
                case 4: colourOn = [0, 0, 255]; break;
                case 5: colourOn = [255, 155, 5]; break;
                default: colourOn = [0, 0, 255]; // blue default
            }

            //console.log(util.inspect(colourOn));
            //console.log(util.inspect(colourOff));
            //if (!config.switch && (msg.switch == undefined) || ((config.state == undefined) && (msg.state == undefined))) {
            //    node.error("Required parameters msg.switch and msg.state");
            //    return;
            //}
            //var tgtSwitch = msg.switch != undefined  ? msg.switch : config.switch;
            //var tgtState = msg.state != undefined ? msg.state : config.state;
            node.bus.sendAs('253.254', config.address, 0xE14E, {button: config.button, colour: {on: colourOn, off: colourOff}}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-btn-colour", HblBtnColour);

    function HdlPanelBrightness(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (msg.payload && msg.payload.config) {
                if (msg.payload.panelBrightness)  config.brightness = msg.payload.panelBrightness;
                //Don't actually do anything with this
                return;
            }
            
            if (msg.panel) {
                // Address override
                var address = config.address;
                if (msg.panel.address) address = msg.panel.address;

                // Brightness override
                var brightness = config.brightness;
                if (msg.panel.brightness) brightness = msg.panel.brightness
            }
            node.bus.sendAs('253.254', address, 0xE012, {backlight: brightness, statusLights: brightness}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-panel-brightness", HdlPanelBrightness);
}

