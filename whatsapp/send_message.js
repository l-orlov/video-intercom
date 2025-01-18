const QRCode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const myNumber = '5491168271180@s.whatsapp.net';
let counter = 1;

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
    });

    const sendMessage = async (msg, jid) => {
        try {
            await sock.sendMessage(jid, { text: msg });
            console.log(`Sent message: "${msg}" to ${jid}`);
        } catch (err) {
            console.error('Failed to send message:', err);
        }
    };

    const startSendingMessages = () => {
        const interval = setInterval(async () => {
            if (counter > 40) {
                clearInterval(interval);
                console.log('Finished sending all messages.');
                return;
            }
            await sendMessage(`Number: ${counter}`, myNumber);
            counter++;
        }, 1000);
    };

    sock.ev.process(async (events) => {
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR code received. Saving to file...');
                try {
                    await QRCode.toFile('./qr.png', qr);
                    console.log('QR code saved to qr.png');
                } catch (err) {
                    console.error('Failed to save QR code:', err);
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) startSock();
                else console.log('Connection closed. You are logged out.');
            }

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
