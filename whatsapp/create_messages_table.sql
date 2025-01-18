CREATE TABLE messages (
    id CHAR(36) NOT NULL PRIMARY KEY,                                         -- UUID
    content TEXT NOT NULL,                                                    -- Text content of the message
    recipient VARCHAR(255) NOT NULL,                                          -- Recipient of the message (e.g., WhatsApp number: '5491168271180@s.whatsapp.net')
    status ENUM('pending', 'sending', 'sent') NOT NULL DEFAULT 'pending',     -- Status of the message
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,                            -- Timestamp when the record was created
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP -- Timestamp of the last update
);

-- Composite index for querying messages with a status of 'pending'
CREATE INDEX idx_status_created_at ON messages(status, created_at) WHERE status = 'pending';

-- Composite index for updating 'sending' status to 'pending' for stuck messages
CREATE INDEX idx_status_updated_at ON messages(status, updated_at) WHERE status = 'sending';

-- To insert row:
-- INSERT INTO messages (id, content, recipient) VALUES (UUID(), 'Hello, world!', '5491168271180@s.whatsapp.net');

-- To select row:
-- SELECT id, content, recipient FROM messages;
