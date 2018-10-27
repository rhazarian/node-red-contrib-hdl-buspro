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
        //this.deviceid = parseInt(n.subnetid)+"."+parseInt(n.deviceid);
        this.deviceAddress = parseInt(n.subnetid) + "." + parseInt(n.deviceid);
        var node = this;
		this.bus = new SmartBus({
  			device: node.deviceAddress,      // Connector address in HDL network (subnet.id)
  			gateway: node.host, 		// HDL SmartBus gateway IP
  			port: node.port                	// and port, default: 6000
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
            case 0xe01c:
                if (cmd.target.subnet == ctrlr.subnetid && cmd.target.id == ctrlr.deviceid) {
                        // UV switch to us, we need to ack this...
                        ctrlr.bus.send('255.255', 0xE01D, {switch: cmd.data.switch, status: cmd.data.status ? 1 : 0} );
                }
                break;
            case 0xe019:
            case 0xe01d:
                uvUpd(cmd.target.subnet, cmd.target.id, cmd.data.switch, cmd.data.status);
                break;
            case 0x32:
                chUpd(cmd.sender.subnet, cmd.sender.id, cmd.data.channel, cmd.data.level);
                break;
        }
        // if (cmd.code == 0xE01C
        //     && cmd.target.subnet == ctrlr.subnetid
        //     && cmd.target.id == ctrlr.deviceid
        //     ) {
        //         // UV switch to us, we need to ack this...
        //         ctrlr.bus.send('255.255', 0xE01D, {switch: cmd.data.switch, status: cmd.data.status ? 1 : 0} );
        // } else {
        console.log(util.inspect('hdl:' + cmd));
        // }
    }

    function HdlBusIn(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){
        	var msg = {};
		  	msg.sender = cmd.sender.subnet + "." + cmd.sender.id;
		  	msg.target = cmd.target.subnet + "." + cmd.target.id;
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

    function HdlChannelIn(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){
            
            if (cmd.code == 0x31
                && config.address == cmd.target.address
                && config.channel == cmd.data.channel
            ) {
                switch (config.level) {
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
                msg.sender = cmd.sender.subnet + "." + cmd.sender.id;
                msg.payload = cmd.data.level;
                msg.topic = 'command';
                //console.log(config.level);
                node.send(msg);
            }
		};

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-channel-in",HdlChannelIn);

    function HdlBusUvIn(config) {
        RED.nodes.createNode(this, config);
        var controller = RED.nodes.getNode(config.controller);
        var node = this;
        node.bus = controller.bus;
        node.receivedCmd = function(cmd){
            if (cmd.code == 0xE01C
                    && controller.deviceAddress == (cmd.target.subnet + "." + cmd.target.id)
                    && config.switch == cmd.data.switch
                    && config.state == cmd.data.status
                ) {
                    var msg = {};
                    msg.sender = cmd.sender.subnet + "." + cmd.sender.id;
                    msg.payload = cmd.data.status;
                    msg.topic = 'uv_switch';
                    node.send(msg);
            }
		}

		this.bus.on('command', node.receivedCmd);

		this.on("close", ()=>{
            this.bus.removeListener('command', node.receivedCmd);
		});
    }
    RED.nodes.registerType("hdl-uv-switch-in",HdlBusUvIn);

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

    function HdlChannelOut(config) {
        RED.nodes.createNode(this,config);
        var controller = RED.nodes.getNode(config.controller);
        this.bus = controller.bus;
        var node = this;
        this.on('input', (msg)=>{
            if (!config.channel && (msg.channel == undefined) || (!config.level && (msg.level == undefined))) {
                node.error("Required parameters msg.channel and msg.level");
                return;
            }
            var tgtChannel = msg.channel != undefined  ? msg.channel : config.channel;
            var tgtLevel = msg.level != undefined ? msg.level : config.level;
            node.bus.send(config.deviceAddress, 0x31, {channel: tgtChannel, level: tgtLevel}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-channel-out", HdlChannelOut);

    function HdlUvOut(config) {
        RED.nodes.createNode(this,config);
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


}

