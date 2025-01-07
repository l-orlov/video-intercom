# Video Call App
A one-to-one audio and video calls application built with WebRTC and Web Socket.

### How to configure

#### URL config
- `cd web`
- rename `config.example.js` to `config.js`
- update settings if it is needed

#### STUN/TURN servers
'Xirsys' can be used for free STUN/TURN servers:
- get a free [xirsys](https://xirsys.com/) account
- `cd web`
- rename `Server.example.php` to `Server.php`
- update it with your free credentials

Alternatively, you can use any STUN/TURN of your choice.

### Run locally with node js
In first terminal:
```
cd web/ws/nodejs/
npm install
node ws_server.js
```
In second terminal:
```
cd web
php -S 0.0.0.0:8888
```
Then open: localhost:8888

### Usefull commands to run on remote server
Run ws server in background
```
nohup node ws_server.js > server.log 2>&1 &
```
Show processes for user
```
ps -u <USERNAME>
```
Kill process
```
kill -9 <PID>
```
