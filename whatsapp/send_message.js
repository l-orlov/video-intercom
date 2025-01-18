const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
const readline = require('readline');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    makeInMemoryStore,
    delay
} = require('@whiskeysockets/baileys');
const fs = require('fs');
const P = require('pino');

const logger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` }, P.destination('./wa-logs.txt'));
logger.level = 'trace';

const useStore = !process.argv.includes('--no-store');
const usePairingCode = process.argv.includes('--use-pairing-code');

// External cache for message retries
const msgRetryCounterCache = new NodeCache();

// Memory store for connection data
const store = useStore ? makeInMemoryStore({ logger }) : undefined;
if (store) {
    store.readFromFile('./baileys_store_multi.json');
    setInterval(() => store.writeToFile('./baileys_store_multi.json'), 10000);
}

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA version ${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: !usePairingCode,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        msgRetryCounterCache,
    });

    if (store) store.bind(sock.ev);

    const sendMessageWTyping = async (msg, jid) => {
        try {
            await sock.sendMessage(jid, msg);
            console.log(`Sent message: "${msg.text}" to ${jid}`);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    sock.ev.process(async (events) => {
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) startSock();
                else console.log('Connection closed. You are logged out.');
            }
            console.log('Connection update:', update);
        }

        if (events['creds.update']) {
            await saveCreds();
        }

        if (events['messages.upsert']) {
            const upsert = events['messages.upsert'];
            console.log('Received messages:', JSON.stringify(upsert, null, 2));

            if (upsert.type === 'notify') {
                for (const msg of upsert.messages) {
                    if (!msg.key.fromMe) {
                        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
                        if (text) {
                            console.log(`Received message: "${text}" from ${msg.key.remoteJid}`);
                            await sendMessageWTyping({ text: `Hello! You said: "${text}"` }, msg.key.remoteJid);
                        } else {
                            console.log('Received a non-text message, ignoring.');
                        }
                    }
                }
            }
        }
    });

    return sock;
};

startSock();
