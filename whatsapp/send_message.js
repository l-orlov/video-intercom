const mysql = require('mysql2/promise');
const QRCode = require('qrcode');
const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const INTERVAL = 1000; // Интервал в миллисекундах для вычитывания сообщений
const SENDING_TIMEOUT = 60000; // Тайм-аут для обработки сообщений (в миллисекундах)

// Настройки подключения к MySQL
const dbConfig = {
    host: 'localhost',
    user: 'your_user',
    password: 'your_password',
    database: 'your_database',
};

/*
CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY, -- Уникальный идентификатор сообщения
    content TEXT NOT NULL,             -- Текст сообщения
    recipient VARCHAR(255) NOT NULL,   -- Получатель сообщения (например, номер телефона в формате WhatsApp: '5491168271180@s.whatsapp.net')
    status ENUM('pending', 'sending', 'sent') NOT NULL DEFAULT 'pending', -- Статус сообщения
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Время создания записи
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP -- Время последнего обновления
);
*/

const startSock = async () => {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info');

    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
    });

    // Подключение к MySQL
    const db = await mysql.createConnection(dbConfig);

    const sendMessage = async (msg, jid, msgId) => {
        try {
            await sock.sendMessage(jid, { text: msg });
            console.log(`Sent message: "${msg}" to ${jid}`);
            // Обновляем статус сообщения на 'sent'
            await db.execute('UPDATE messages SET status = ? WHERE id = ?', ['sent', msgId]);
        } catch (err) {
            console.error(`Failed to send message "${msg}" to ${jid}:`, err);
            // Если отправка не удалась, возвращаем статус на 'pending'
            await db.execute('UPDATE messages SET status = ? WHERE id = ?', ['pending', msgId]);
        }
    };

    const processMessages = async () => {
        try {
            // Начинаем транзакцию
            await db.beginTransaction();

            // Переводим зависшие сообщения обратно в 'pending'
            await db.execute(
                `UPDATE messages SET status = 'pending' WHERE status = 'sending' AND TIMESTAMPDIFF(SECOND, updated_at, NOW()) > ?`,
                [SENDING_TIMEOUT / 1000]
            );

            // Выбираем сообщения со статусом 'pending'
            const [rows] = await db.execute(
                `SELECT * FROM messages WHERE status = 'pending' ORDER BY created_at LIMIT 10 FOR UPDATE`
            );

            if (rows.length === 0) {
                await db.commit(); // Завершаем транзакцию
                return;
            }

            // Обновляем статус сообщений на 'sending'
            const messageIds = rows.map((row) => row.id);
            await db.execute(
                `UPDATE messages SET status = 'sending', updated_at = NOW() WHERE id IN (?)`,
                [messageIds]
            );

            await db.commit(); // Завершаем транзакцию

            // Отправляем сообщения
            for (const msg of rows) {
                await sendMessage(msg.content, msg.recipient, msg.id);
            }
        } catch (err) {
            console.error('Error processing messages:', err);
            await db.rollback(); // Откатываем транзакцию в случае ошибки
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
                setInterval(processMessages, INTERVAL); // Запускаем обработку сообщений каждые INTERVAL миллисекунд
            }
        }

        if (events['creds.update']) {
            await saveCreds();
        }
    });

    return sock;
};

startSock();
