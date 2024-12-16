<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Receiver</title>
</head>
<body>
    <h1>Receiver</h1>
    <video id="remoteVideo" autoplay playsinline></video>
    <script>
        const signalingServer = "ws://localhost:8080"; // URL вашего WebSocket сервера
        const pc = new RTCPeerConnection();

        const ws = new WebSocket(signalingServer);
        ws.onmessage = async (message) => {
            const data = JSON.parse(message.data);

            if (data.offer) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);

                ws.send(JSON.stringify({ answer }));
            } else if (data.iceCandidate) {
                await pc.addIceCandidate(new RTCIceCandidate(data.iceCandidate));
            }
        };

        pc.ontrack = (event) => {
            document.getElementById("remoteVideo").srcObject = event.streams[0];
        };

        pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                ws.send(JSON.stringify({ iceCandidate: candidate }));
            }
        };
    </script>
</body>
</html>
