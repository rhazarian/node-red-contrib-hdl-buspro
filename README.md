# node-red-contrib-hdlbus
Node-Red implementation of HDL BusPro (SmartBus) protocol http://hdlautomation.com - forked from [node-red-contrib-buspro](https://github.com/efa2000/node-red-contrib-buspro), based on [smart-bus](https://github.com/caligo-mentis/smart-bus).

The motivation for creating this node set was to fill a perceived gap in functionality.  This package provides:
* state storage of devices - all level updates are stored in a JS object
* input/output nodes for device channels
* input/output nodes for universal switches
* a get node for device channels (based on stored values)
* a button colour node to change the LED colour of the new capacitive touch buttons
* a panel brightness node to facilitate dimming panels eg. at night
* raw nodes to allow you to craft messages to send/receive anything on the HDL network

This is by no means perfect - happy to hear any suggestions.  

If you're looking for a event timer - check out [eztimer](https://github.com/mrgadget/node-red-contrib-eztimer).

## BusPro-Controller
node that holds connection to IP Gateway of BusPro (Smart-Bus) network

### Config
```js
defaults: {
            host: {value:"",required:true},   // HDL SmartBus gateway IP 
            port: {value:6000,required:true,validate:RED.validators.number()},    // and port, default: 6000 
            subnetid: {value: 1, required: true, validate: RED.validators.number()}, // Connector address in HDL network (Subnet ID)
            deviceid: {value: 99, required: true, validate: RED.validators.number()} // Connector address in HDL network (Device ID)
        }
```

## hdl-channel-in
Trigger flows based on pre-determined channel/level messages

## hdl-channel-out
Send channel level request

## hdl-channel-get
Inject into the message the current level of a given channel.  This is obtained from the level store maintained by watching events (rather than requiring a request/response to get the current level).

## hdl-uv-in
Trigger a flow based on a pre-determined uv switch change

## hdl-uv-out
Send UV switch request

## hdl-btn-colour
Send request to update button colour.  This commands supports updating both the **on** and **off** colours independantly.

## hdl-panel-brightness
Send request to update panel brightness.

## hdl-raw-in
Receive (any) commands from HDL (Smart-Bus) network

### Outgoing message
```js
msg:{
  sender: "1.2" //ID of Sender Device
  target: "255.255" //ID of Target Device
  code: 50    //Integer with command operation code
  payload: {}   //Object with decoded data or raw buffer if data can not be parsed automatically
}
```

## hdl-raw-out
Send (any) commands to the HDL (Smart-Bus) network

### Outgoing message
```js
msg:{
  target: "1.52" //ID of Target Device
  code: 49    //Integer with command operation code
  payload: { //Object with data or raw buffer 
  		channel: 2,
  		level: 100
  	}   
}
```
