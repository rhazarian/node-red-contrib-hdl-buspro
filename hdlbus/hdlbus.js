var util = require("util");
var SmartBus = require('smart-bus');
var EventEmitter = require('events').EventEmitter;
var cmdsLink = {
	49: 50
};


module.exports = function(RED) {
    var ctrlr = null;

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
        
        ctrlr = this;
    }
    RED.nodes.registerType("hdl-controller",HdlBusControllerNode);

    function processCommand(cmd) {
        if (cmd.code == 0xE01C
            && cmd.target.subnet == ctrlr.subnetid
            && cmd.target.id == ctrlr.deviceid
            ) {
                // UV switch to us, we need to ack this...
                ctrlr.bus.send('255.255', 0xE01D, {switch: cmd.data.switch, status: cmd.data.status ? 1 : 0} );
        } else {
            console.log(util.inspect('hdl-other:' + cmd));
        }
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

    function HdlBusUv(config) {
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
    RED.nodes.registerType("hdl-uv-switch-in",HdlBusUv);

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
            if ((!config.channel && !msg.channel) || (!config.level && !msg.level)) {
                node.error("Required parameters msg.channel and msg.level");
                return;
            }
            node.bus.send(config.deviceAddress, 0x0031, {channel: config.channel, level: config.level}, function(err) {
                if (err){
                    node.error(err);   
                }
            });
        });
       
        this.on("close", ()=>{
        });
    }
    RED.nodes.registerType("hdl-channel-out", HdlChannelOut);


}

