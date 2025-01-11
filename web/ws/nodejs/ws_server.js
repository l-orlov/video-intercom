const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

class Client {
    constructor(ws) {
        this.ws = ws;
        this.room = '';
        this.isOwner = false;
    }
}

class Room {
    constructor(name) {
        this.name = name;
        this.clients = new Set();
    }

    addClient(client) {
        this.clients.add(client);
    }

    removeClient(client) {
        this.clients.delete(client);
    }
}

class Hub {
    constructor() {
        this.rooms = new Map();
    }

    subscribe(client, roomName, isOwner) {
        if (!this.rooms.has(roomName)) {
            this.rooms.set(roomName, new Room(roomName));
        }

        const room = this.rooms.get(roomName);

        // Check if room already has 2 clients
        if (room.clients.size >= 2) {
            client.ws.send(JSON.stringify({ action: 'subRejected', reason: 'Only two users allowed in room. Communication disallowed.' }));
            return;
        }
        // Check if owner already exists
        const ownerExists = Array.from(room.clients).some((c) => c.isOwner);
        if (isOwner && ownerExists) {
            client.ws.send(JSON.stringify({ action: 'subRejected', reason: 'Owner already exists in room' }));
            return;
        }
        // Check if non-owner already exists
        const nonOwnerExists = Array.from(room.clients).some((c) => !c.isOwner);
        if (!isOwner && nonOwnerExists) {
            client.ws.send(JSON.stringify({ action: 'subRejected', reason: 'Non-owner already exists in room' }));
            return;
        }

        client.isOwner = isOwner;
        room.addClient(client);
        client.room = roomName;
        this.notify(roomName, client, { action: 'newSub', room: roomName });

        // If there are now 2 participants in room, initiate call process
        if (room.clients.size === 2) {
            const caller = room.clients.values().next().value;

            // Notify first participant (caller) to start call
            caller.ws.send(JSON.stringify({ action: 'startCall', isCaller: true, room: roomName }));
        }
    }

    unsubscribe(client) {
        if (!client.room) return;

        const room = this.rooms.get(client.room);
        if (!room) return;

        room.removeClient(client);
        this.notify(client.room, client, { action: 'imOffline', room: client.room });

        if (room.clients.size === 0) {
            this.rooms.delete(client.room);
        }

        client.room = '';
    }

    broadcast(roomName, message, sender) {
        const room = this.rooms.get(roomName);
        if (!room) return;

        room.clients.forEach((client) => {
            if (client !== sender) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }

    notify(roomName, sender, message) {
        const room = this.rooms.get(roomName);
        if (!room) return;

        room.clients.forEach((client) => {
            if (client !== sender) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }
}

const hub = new Hub();
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    const client = new Client(ws);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            switch (message.action) {
                case 'subscribe':
                    const { room, isOwner } = message;
                    hub.subscribe(client, room, isOwner);
                    break;
                case 'unsubscribe':
                    hub.unsubscribe(client);
                    break;
                default:
                    hub.broadcast(client.room, message, client);
                    break;
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        hub.unsubscribe(client);
    });
});

const PORT = 2735;
server.listen(PORT, () => {
    console.log(`WebSocket server running on ws://0.0.0.0:${PORT}/`);
});
