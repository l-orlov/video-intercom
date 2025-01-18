const mysql = require('mysql2/promise');
const { v4: uuidv4 } = require('uuid');

const dbConfig = {
    host: 'localhost',
    port: 3306,
    user: 'user',
    password: 'password',
    database: 'db',
};

// Function to add a message to the database
const addMessage = async (recipient, content) => {
    const id = uuidv4(); // Generate a unique UUID for the message
    const connection = await mysql.createConnection(dbConfig);

    try {
        await connection.execute(
            'INSERT INTO messages (id, content, recipient, status) VALUES (?, ?, ?, ?)',
            [id, content, recipient, 'pending']
        );
        console.log(`Message added successfully: ID=${id}, Recipient=${recipient}, Content="${content}"`);
    } catch (err) {
        console.error('Failed to add message:', err);
    } finally {
        await connection.end();
    }
};

// Get arguments from the command line
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node addMessage.js <recipient> <content>');
    process.exit(1);
}

const [recipient, content] = args;

// Add the message
addMessage(recipient, content);
