<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sender</title>
</head>
<body>
    <h1>Sender</h1>
    <video id="localVideo" autoplay playsinline></video>
    <script>
        const signalingServer = "ws://localhost:8080"; // URL вашего WebSocket сервера
        const pc = new RTCPeerConnection();

        const ws = new WebSocket(signalingServer);
        ws.onmessage = async (message) => {
            const data = JSON.parse(message.data);

            if (data.answer) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            } else if (data.iceCandidate) {
                await pc.addIceCandidate(new RTCIceCandidate(data.iceCandidate));
            }
        };

        // Захват видео с камеры
        async function startCapture() {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            document.getElementById("localVideo").srcObject = stream;
            stream.getTracks().forEach(track => pc.addTrack(track, stream));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(JSON.stringify({ offer }));
        }

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                ws.send(JSON.stringify({ iceCandidate: candidate }));
            }
        };

        startCapture();
    </script>
</body>
</html>
