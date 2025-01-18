CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY, -- Уникальный идентификатор сообщения
    content TEXT NOT NULL,             -- Текст сообщения
    recipient VARCHAR(255) NOT NULL,   -- Получатель сообщения (например, номер телефона в формате WhatsApp: '5491168271180@s.whatsapp.net')
    status ENUM('pending', 'sending', 'sent') NOT NULL DEFAULT 'pending', -- Статус сообщения
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Время создания записи
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP -- Время последнего обновления
);