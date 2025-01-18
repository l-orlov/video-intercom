const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const INTERVAL = 1000; // Interval for fetching messages (in milliseconds)
const BATCH_SIZE = 500; // Number of messages to process at a time
const SENDING_TIMEOUT = 60000; // Timeout for processing messages (in milliseconds)

const dbConfig = {
    host: 'localhost',
    port: 3306,
    user: 'user',
    password: 'password',
    database: 'db',
};

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const sock = makeWASocket({
        printQRInTerminal: false, // Disable QR code printing in the terminal
        auth: state,
    });

    const db = await mysql.createConnection(dbConfig);

    const sendMessagesBatch = async (messages) => {
        const successfulIds = [];
        const failedIds = [];

        for (const msg of messages) {
            try {
                await sock.sendMessage(msg.recipient, { text: msg.content });
                console.log(`Sent message: "${msg.content}" to ${msg.recipient}`);
                successfulIds.push(msg.id);
            } catch (err) {
                console.error(`Failed to send message "${msg.content}" to ${msg.recipient}:`, err);
                failedIds.push(msg.id);
            }
        }

        // Update message statuses in the database
        if (successfulIds.length > 0) {
            const placeholders = successfulIds.map(() => '?').join(',');
            await db.execute(
                `UPDATE messages SET status = 'sent', updated_at = NOW() WHERE id IN (${placeholders})`,
                successfulIds
            );
        }

        if (failedIds.length > 0) {
            const placeholders = failedIds.map(() => '?').join(',');
            await db.execute(
                `UPDATE messages SET status = 'pending', updated_at = NOW() WHERE id IN (${placeholders})`,
                failedIds
            );
        }
    };

    const processMessages = async () => {
        try {
            await db.beginTransaction();

            // Reset stuck messages back to 'pending'
            await db.execute(
                `UPDATE messages SET status = 'pending' WHERE status = 'sending' AND TIMESTAMPDIFF(SECOND, updated_at, NOW()) > ?`,
                [SENDING_TIMEOUT / 1000]
            );

            // Fetch messages for processing
            const [rows] = await db.execute(
                `SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT ${BATCH_SIZE} FOR UPDATE`
            );

            if (rows.length === 0) {
                await db.commit();
                return;
            }

            const messageIds = rows.map((row) => row.id);
            
            const placeholders = messageIds.map(() => '?').join(',');
            await db.execute(
                `UPDATE messages SET status = 'sending', updated_at = NOW() WHERE id IN (${placeholders})`,
                messageIds
            );

            await db.commit();

            // Send messages in a batch
            await sendMessagesBatch(rows);
        } catch (err) {
            console.error('Error processing messages:', err);
            await db.rollback();
        }
    };

    sock.ev.process(async (events) => {
        if (events['connection.update']) {
            const update = events['connection.update'];
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('QR code received. Saving to file...');
                try {
                    await QRCode.toFile('./qr.png', qr); // Save QR code to a file
                    console.log('QR code saved to qr.png');
                } catch (err) {
                    console.error('Failed to save QR code:', err);
                }
            }

            if (connection === 'close') {
                const shouldReconnect =
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) startSock();
                else console.log('Connection closed. You are logged out.');
            }

            if (connection === 'open') {
                console.log('Connection opened. Starting message processing...');
                setInterval(processMessages, INTERVAL);
            }
        }

        if (events['creds.update']) {
            await saveCreds(); // Save credentials after updates
        }
    });

    return sock;
};

startSock();
