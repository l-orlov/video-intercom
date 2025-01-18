const { Boom } = require('@hapi/boom');
const NodeCache = require('node-cache');
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

const useStore = false;
const myNumber = '5491168271180@s.whatsapp.net';
let counter = 1;

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
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
    });

    if (store) store.bind(sock.ev);

    const sendMessage = async (msg, jid) => {
        try {
            await sock.sendMessage(jid, { text: msg });
            console.log(`Sent message: "${msg}" to ${jid}`);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    // Send message each second
    const startSendingMessages = () => {
        const interval = setInterval(async () => {
            if (counter > 40) {
                clearInterval(interval); // Stop after 40 messages
                console.log('Finished sending all messages.');
                return;
            }
            await sendMessage(`Number: ${counter}`, myNumber);
            counter++;
        }, 1000); // Each second
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

            // После успешного подключения начинаем отправку сообщений
            if (connection === 'open') {
                console.log('Connection opened. Starting message sending...');
                startSendingMessages();
            }
        }

        if (events['creds.update']) {
            await saveCreds();
        }
    });

    return sock;
};

startSock();
