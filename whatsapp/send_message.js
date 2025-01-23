const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const dbConfig = {
    host: 'localhost',
    port: 3306,
    user: 'user',
    password: 'password',
    database: 'db',
};

const INTERVAL = 1000; // Interval for fetching messages (in milliseconds)
const BATCH_SIZE = 100; // Number of messages to process at a time
const SENDING_TIMEOUT = 60000; // Timeout for processing stuck messages (in milliseconds)
const QUERY_TIMEOUT = 5000; // Timeout for individual queries (in milliseconds)

let intervalId = null; // Track the interval to ensure it doesn't run multiple times

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    let sock;

    const initializeSocket = () => {
        sock = makeWASocket({
            printQRInTerminal: false, // Disable QR code printing in the terminal
            auth: state,
        });

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
                    console.log(
                        'Connection closed. Should reconnect:',
                        shouldReconnect
                    );
                    if (shouldReconnect) {
                        console.log('Reconnecting...');
                        initializeSocket();
                    } else {
                        console.log('Logged out. Please restart the program.');
                    }
                }

                if (connection === 'open') {
                    console.log('Connection opened. Starting message processing...');
                    // Clear existing interval to prevent multiple instances
                    if (intervalId) {
                        clearInterval(intervalId);
                        console.log('Cleared previous interval.');
                    }
                    intervalId = setInterval(processMessages, INTERVAL);
                }
            }

            if (events['creds.update']) {
                await saveCreds(); // Save credentials after updates
            }
        });
    };

    initializeSocket();

    const db = await mysql.createConnection({ ...dbConfig, connectTimeout: QUERY_TIMEOUT });

    // Utility to wrap queries with a timeout
    const withQueryTimeout = async (queryFn, timeout = QUERY_TIMEOUT) => {
        return Promise.race([
            queryFn(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Query timed out')), timeout)
            ),
        ]);
    };

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

        if (successfulIds.length > 0) {
            const placeholders = successfulIds.map(() => '?').join(',');
            await withQueryTimeout(() =>
                db.execute(
                    `UPDATE bot_messages SET status = 'sent', updated_at = NOW() WHERE id IN (${placeholders})`,
                    successfulIds
                )
            );
        }

        if (failedIds.length > 0) {
            const placeholders = failedIds.map(() => '?').join(',');
            await withQueryTimeout(() =>
                db.execute(
                    `UPDATE bot_messages SET status = 'pending', updated_at = NOW() WHERE id IN (${placeholders})`,
                    failedIds
                )
            );
        }
    };

    const processMessages = async () => {
        try {
            await withQueryTimeout(() => db.beginTransaction());

            await withQueryTimeout(() =>
                db.execute(
                    `UPDATE bot_messages SET status = 'pending' WHERE status = 'sending' AND TIMESTAMPDIFF(SECOND, updated_at, NOW()) > ?`,
                    [SENDING_TIMEOUT / 1000]
                )
            );

            const [rows] = await withQueryTimeout(() =>
                db.execute(
                    `SELECT * FROM bot_messages WHERE status = 'pending' ORDER BY created_at LIMIT ${BATCH_SIZE} FOR UPDATE`
                )
            );

            if (rows.length === 0) {
                await db.commit();
                return;
            }

            const messageIds = rows.map((row) => row.id);
            const placeholders = messageIds.map(() => '?').join(',');

            await withQueryTimeout(() =>
                db.execute(
                    `UPDATE bot_messages SET status = 'sending', updated_at = NOW() WHERE id IN (${placeholders})`,
                    messageIds
                )
            );

            await db.commit();

            await sendMessagesBatch(rows);
        } catch (err) {
            console.error('Error processing messages:', err);
            try {
                await db.rollback();
            } catch (rollbackErr) {
                console.error('Failed to rollback transaction:', rollbackErr);
            }
        }
    };
};

startSock();
