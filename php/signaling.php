<?php
session_start();

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: POST, GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Content-Type: application/json");

$input = json_decode(file_get_contents("php://input"), true);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $type = $input['type'] ?? '';
    $message = $input['message'] ?? '';

    if ($type === 'offer') {
        $_SESSION['offer'] = $message;
        error_log("SDP offer saved.");
    } elseif ($type === 'answer') {
        $_SESSION['answer'] = $message;
        error_log("SDP answer saved.");
    } elseif ($type === 'candidate') {
        if (!isset($_SESSION['candidates'])) {
            $_SESSION['candidates'] = [];
        }
        $_SESSION['candidates'][] = $message;
        error_log("ICE candidate saved.");
    }
    echo json_encode(['status' => 'success']);
} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $type = $_GET['type'] ?? '';

    if ($type === 'offer') {
        echo json_encode(['message' => $_SESSION['offer'] ?? null]);
        error_log("SDP offer sent.");
    } elseif ($type === 'answer') {
        echo json_encode(['message' => $_SESSION['answer'] ?? null]);
        error_log("SDP answer sent.");
    } elseif ($type === 'candidate') {
        echo json_encode(['message' => $_SESSION['candidates'] ?? []]);
        $_SESSION['candidates'] = []; // Clear candidates after sending
        error_log("ICE candidates sent.");
    }
}
