const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const INTERVAL = 1000; // Интервал для вычитывания сообщений
const BATCH_SIZE = 500; // Количество сообщений для обработки за раз
const SENDING_TIMEOUT = 60000; // Тайм-аут для обработки сообщений (в миллисекундах)

const dbConfig = {
    host: 'localhost',
    user: 'your_user',
    password: 'your_password',
    database: 'your_database',
};

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');
    const sock = makeWASocket({
        printQRInTerminal: false,
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

        // Обновляем статусы в базе данных
        if (successfulIds.length > 0) {
            await db.execute(
                `UPDATE messages SET status = 'sent', updated_at = NOW() WHERE id IN (?)`,
                [successfulIds]
            );
        }

        if (failedIds.length > 0) {
            await db.execute(
                `UPDATE messages SET status = 'pending', updated_at = NOW() WHERE id IN (?)`,
                [failedIds]
            );
        }
    };

    const processMessages = async () => {
        try {
            await db.beginTransaction();

            // Переводим зависшие сообщения обратно в 'pending'
            await db.execute(
                `UPDATE messages SET status = 'pending' WHERE status = 'sending' AND TIMESTAMPDIFF(SECOND, updated_at, NOW()) > ?`,
                [SENDING_TIMEOUT / 1000]
            );

            // Выбираем сообщения для обработки
            const [rows] = await db.execute(
                `SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT ? FOR UPDATE`,
                [BATCH_SIZE]
            );

            if (rows.length === 0) {
                await db.commit();
                return;
            }

            const messageIds = rows.map((row) => row.id);
            await db.execute(
                `UPDATE messages SET status = 'sending', updated_at = NOW() WHERE id IN (?)`,
                [messageIds]
            );

            await db.commit();

            // Отправляем сообщения батчем
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
                    await QRCode.toFile('./qr.png', qr);
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
            await saveCreds();
        }
    });

    return sock;
};

startSock();
